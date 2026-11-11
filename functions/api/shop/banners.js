// PUT /api/shop/banners  { keys: ["shops/<id>/b_<uuid>.webp", ...] }
// Tetapkan senarai dan susunan banner (menggantikan senarai sedia ada). Gambar baharu mesti dimuat naik dahulu
// melalui /api/upload?kind=banner. Gambar yang dibuang daripada senarai dipadam daripada R2.

import { fail, json, readJson } from '../../../lib/http.js';
import { bannersToApi, getBanners, ownerShop } from '../../../lib/shop.js';
import { formatMb } from '../../../lib/plan.js';
import { deleteObjects, isBannerKeyOf, objectSize } from '../../../lib/media.js';
import { CATALOG_FAIL, publishSnapshot } from '../../../lib/catalog.js';

const MAX_KEYS_INPUT = 20; // had kasar input; had sebenar ialah plans.max_banners

export async function onRequestPut({ request, env, data }) {
  const parsed = await readJson(request);
  const keys = parsed.value && parsed.value.keys;
  if (parsed.error || !Array.isArray(keys) || keys.length > MAX_KEYS_INPUT || keys.some((k) => typeof k !== 'string')) {
    return fail(400, 'badan-tidak-sah', 'Format permintaan tidak sah.');
  }
  if (new Set(keys).size !== keys.length) return fail(400, 'banner-berganda', 'Gambar yang sama disenaraikan dua kali.');

  const { shop, plan, error } = await ownerShop(env, data.user, { writable: true });
  if (error) return error;

  // Pemilikan: hanya objek banner di bawah awalan kedai sendiri.
  if (!keys.every((k) => isBannerKeyOf(shop.id, k))) return fail(400, 'gambar-tak-sah', 'Gambar banner tak sah.');

  if (keys.length > plan.max_banners) {
    const upsell = plan.code === 'free' ? ' Naik taraf ke Pro untuk lebih banyak banner.' : '';
    return fail(409, 'had-banner', `Had ${plan.max_banners} banner pelan ${plan.name} dicapai.${upsell}`);
  }

  const existing = await getBanners(env.DB, shop.id);
  const existingKeys = new Set(existing.map((b) => b.image_key));
  const added = keys.filter((k) => !existingKeys.has(k));
  const removed = existing.filter((b) => !keys.includes(b.image_key));

  // Saiz sebenar daripada R2, bukan daripada client.
  const addedSizes = new Map();
  for (const key of added) {
    const size = await objectSize(env, key);
    if (size === null) return fail(400, 'gambar-tiada', 'Gambar belum dimuat naik. Cuba muat naik semula.');
    addedSizes.set(key, size);
  }

  const addedBytes = [...addedSizes.values()].reduce((a, b) => a + b, 0);
  const removedBytes = removed.reduce((a, b) => a + b.bytes, 0);
  if (addedBytes > 0 && shop.storage_bytes - removedBytes + addedBytes > plan.max_storage_bytes) {
    return fail(409, 'had-storage', `Had storage gambar ${formatMb(plan.max_storage_bytes)} pelan ${plan.name} dicapai.`);
  }

  const db = env.DB;
  const statements = [];
  for (const b of removed) statements.push(db.prepare('DELETE FROM shop_banners WHERE id = ?1 AND shop_id = ?2').bind(b.id, shop.id));
  keys.forEach((key, index) => {
    if (addedSizes.has(key)) {
      statements.push(
        db
          .prepare('INSERT INTO shop_banners (id, shop_id, image_key, bytes, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)')
          .bind(crypto.randomUUID(), shop.id, key, addedSizes.get(key), index),
      );
    } else {
      statements.push(
        db.prepare('UPDATE shop_banners SET sort_order = ?1 WHERE shop_id = ?2 AND image_key = ?3').bind(index, shop.id, key),
      );
    }
  });
  // Relatif (bukan nilai mutlak) supaya tak menimpa perubahan serentak.
  statements.push(
    db
      .prepare("UPDATE shops SET storage_bytes = MAX(0, storage_bytes + ?1), updated_at = datetime('now') WHERE id = ?2")
      .bind(addedBytes - removedBytes, shop.id),
  );
  await db.batch(statements);

  await deleteObjects(env, removed.map((b) => b.image_key));
  if (!(await publishSnapshot(env, shop.id))) return fail(500, CATALOG_FAIL.code, CATALOG_FAIL.message);

  const [banners, fresh] = await Promise.all([
    getBanners(db, shop.id),
    db.prepare('SELECT storage_bytes FROM shops WHERE id = ?1').bind(shop.id).first(),
  ]);
  return json({ ok: true, banners: bannersToApi(banners), storageBytes: fresh.storage_bytes });
}
