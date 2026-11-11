// /api/shop
//   GET    tetapan kedai sendiri (S-13)
//   POST   cipta kedai (S-08), satu pengguna satu kedai
//   PATCH  ubah tetapan (medan dalam senarai putih sahaja)
//   DELETE padam kedai, semua baris D1 dan objek R2 (F-15, PDPA); body { confirmSlug }

import { fail, failFields, json, readJson } from '../../lib/http.js';
import { columnFor, validateShopInput } from '../../lib/validate.js';
import { getShopByOwner, ownerShop, shopResponseData } from '../../lib/shop.js';
import { CATALOG_FAIL, publishSnapshot, snapshotKey } from '../../lib/catalog.js';
import { deleteShopObjects } from '../../lib/media.js';
import { DEFAULT_THEME, LIMITS, MSG as RULE_MSG, isReservedLocally, validateTemplate } from '../../public/assets/js/rules.js';

const BODY_ERROR = 'Format permintaan tidak sah.';

function slugTaken() {
  return failFields({ slug: RULE_MSG.slugTakBoleh }, 409, 'slug-diambil');
}

export async function onRequestGet({ env, data }) {
  const r = await shopResponseData(env, data.user);
  return r.error || json(r.body);
}

export async function onRequestPost({ request, env, data }) {
  const parsed = await readJson(request);
  if (parsed.error) return fail(400, 'badan-tidak-sah', BODY_ERROR);

  const { values, errors } = validateShopInput(parsed.value, { partial: false });
  if (errors) return failFields(errors);
  if (isReservedLocally(values.slug)) return slugTaken();

  const id = crypto.randomUUID();
  let result;
  try {
    // Semakan reserved dan INSERT dalam satu pernyataan: tiada ruang untuk perlumbaan.
    result = await env.DB
      .prepare(
        `INSERT INTO shops (id, owner_user_id, slug, name, description, whatsapp, theme_color, is_open, ask_name, ask_address)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
         WHERE NOT EXISTS (SELECT 1 FROM reserved_slugs WHERE slug = ?3)`,
      )
      .bind(
        id,
        data.user.id,
        values.slug,
        values.name,
        values.description ?? '',
        values.whatsapp,
        values.themeColor ?? DEFAULT_THEME,
        values.isOpen ?? 1,
        values.askName ?? 1,
        values.askAddress ?? 0,
      )
      .run();
  } catch (err) {
    const msg = String(err && err.message);
    if (/UNIQUE constraint failed: shops\.slug/i.test(msg)) return slugTaken();
    if (/UNIQUE constraint failed: shops\.owner_user_id/i.test(msg)) {
      return fail(409, 'ada-kedai', 'Anda sudah mempunyai kedai. Satu akaun satu kedai.');
    }
    throw err;
  }
  if (result.meta.changes === 0) return slugTaken();

  // Snapshot awal (katalog kosong). Jika gagal, catalog_dirty ditanda dan tulisan seterusnya cuba lagi;
  // kedai tetap dicipta supaya wizard tak diulang.
  await publishSnapshot(env, id);

  const r = await shopResponseData(env, data.user);
  return r.error || json(r.body, 201);
}

export async function onRequestPatch({ request, env, data }) {
  const parsed = await readJson(request);
  if (parsed.error) return fail(400, 'badan-tidak-sah', BODY_ERROR);

  const { shop, plan, error } = await ownerShop(env, data.user, { writable: true });
  if (error) return error;

  const { values, errors } = validateShopInput(parsed.value, { partial: true });
  if (errors) return failFields(errors);

  // Templat mesej sendiri (F-12): Pro sahaja. Kosong atau null = templat lalai (dibenarkan untuk semua pelan).
  if ('messageTemplate' in parsed.value) {
    const t = validateTemplate(parsed.value.messageTemplate);
    if (t.error) return failFields({ messageTemplate: t.error });
    if (t.value !== null && plan.custom_template !== 1) {
      return fail(403, 'perlu-pro', 'Templat mesej sendiri hanya untuk pelan Pro.');
    }
    if (t.value !== shop.message_template) values.messageTemplate = t.value;
  }

  const renaming = 'slug' in values && values.slug !== String(shop.slug).toLowerCase();
  if (!renaming) delete values.slug;
  if (renaming && isReservedLocally(values.slug)) return slugTaken();

  const keys = Object.keys(values);
  if (keys.length === 0) {
    const r = await shopResponseData(env, data.user);
    return r.error || json(r.body);
  }

  const sets = [];
  const binds = [];
  for (const key of keys) {
    binds.push(values[key]);
    sets.push(`${columnFor(key)} = ?${binds.length}`);
  }
  if (renaming) sets.push('slug_changes = slug_changes + 1');
  sets.push("updated_at = datetime('now')");

  binds.push(shop.id);
  let where = `id = ?${binds.length}`;
  if (renaming) {
    binds.push(LIMITS.slugChangesMax);
    where += ` AND slug_changes < ?${binds.length}`;
    binds.push(values.slug);
    where += ` AND NOT EXISTS (SELECT 1 FROM reserved_slugs WHERE slug = ?${binds.length})`;
  }

  let result;
  try {
    result = await env.DB.prepare(`UPDATE shops SET ${sets.join(', ')} WHERE ${where}`).bind(...binds).run();
  } catch (err) {
    if (/UNIQUE constraint failed: shops\.slug/i.test(String(err && err.message))) return slugTaken();
    throw err;
  }

  if (result.meta.changes === 0) {
    const fresh = await getShopByOwner(env.DB, data.user.id);
    if (!fresh) return fail(404, 'belum-ada-kedai', 'Sila siapkan setup kedai dahulu.');
    if (renaming && fresh.slug_changes >= LIMITS.slugChangesMax) {
      return fail(
        409,
        'had-tukar-slug',
        `Nama link sudah ditukar ${LIMITS.slugChangesMax} kali, had dicapai. Hubungi sokongan jika perlu tukar lagi.`,
      );
    }
    return slugTaken(); // reserved
  }

  if (renaming) {
    // Tindakan sensitif peniaga direkod (BSD audit_log). Slug lama tak dikekalkan.
    await env.DB
      .prepare('INSERT INTO audit_log (actor_email, action, shop_id, meta) VALUES (?1, ?2, ?3, ?4)')
      .bind(data.user.email, 'rename_slug', shop.id, JSON.stringify({ from: shop.slug, to: values.slug }))
      .run();
  }

  // Snapshot baharu; jika slug ditukar, snapshot slug lama dipadam (slug lama tak dikekalkan).
  if (!(await publishSnapshot(env, shop.id, { oldSlug: renaming ? shop.slug : null }))) {
    return fail(500, CATALOG_FAIL.code, CATALOG_FAIL.message);
  }

  const r = await shopResponseData(env, data.user);
  return r.error || json(r.body);
}

export async function onRequestDelete({ request, env, data }) {
  const parsed = await readJson(request);
  if (parsed.error) return fail(400, 'badan-tidak-sah', 'Format permintaan tidak sah.');
  const { shop, error } = await ownerShop(env, data.user); // kedai digantung pun boleh dipadam oleh pemiliknya
  if (error) return error;
  if (String(parsed.value.confirmSlug || '').trim().toLowerCase() !== shop.slug.toLowerCase()) {
    return fail(400, 'pengesahan-salah', 'Taip nama link kedai dengan tepat untuk mengesahkan.');
  }

  // R2 dahulu: jika gagal, kedai masih wujud dan peniaga boleh cuba semula (tiada objek yatim tanpa rekod).
  const removed = await deleteShopObjects(env, shop.id);
  await env.MEDIA.delete(snapshotKey(shop.slug));

  // Rekod audit kekal (tiada data peribadi pelanggan); payments kekal untuk perakaunan dengan shop_id NULL.
  await env.DB.batch([
    env.DB
      .prepare('INSERT INTO audit_log (actor_email, action, shop_id, meta) VALUES (?1, ?2, ?3, ?4)')
      .bind(data.user.email, 'delete_shop', shop.id, JSON.stringify({ slug: shop.slug, name: shop.name, objects: removed })),
    env.DB.prepare('DELETE FROM shops WHERE id = ?1 AND owner_user_id = ?2').bind(shop.id, data.user.id),
  ]);
  return json({ ok: true, removedObjects: removed });
}
