// Snapshot katalog awam: catalog/<slug>.json dalam R2 (BSD seksyen 5). Halaman kedai (Fasa 4) membaca fail ini,
// bukan D1, supaya had D1 tak menjatuhkan kedai yang sedang dilayari.
// Snapshot dibina daripada pelan efektif: produk, kategori dan banner melebihi had tak dimasukkan
// (data tak dipadam, BSD peraturan 3). Ia tak mengandungi e-mel, owner_user_id atau data pelan lain.

import { effectivePlanCode, loadPlan } from './plan.js';

export const SNAPSHOT_CACHE = 'public, max-age=60';

export function snapshotKey(slug) {
  return `catalog/${String(slug).toLowerCase()}.json`;
}

export async function buildSnapshotData(db, env, shop, now = new Date()) {
  const plan = await loadPlan(db, effectivePlanCode(shop, env, now));
  const [banners, cats, items] = await Promise.all([
    db
      .prepare('SELECT image_key FROM shop_banners WHERE shop_id = ?1 ORDER BY sort_order, id LIMIT ?2')
      .bind(shop.id, plan.max_banners)
      .all(),
    db
      .prepare('SELECT id, name FROM categories WHERE shop_id = ?1 ORDER BY sort_order, id LIMIT ?2')
      .bind(shop.id, plan.max_categories)
      .all(),
    db
      .prepare(
        `SELECT id, category_id, name, description, price_sen, image_key, thumb_key, is_available
         FROM products WHERE shop_id = ?1 ORDER BY sort_order, id LIMIT ?2`,
      )
      .bind(shop.id, plan.max_products)
      .all(),
  ]);

  const catIds = new Set(cats.results.map((c) => c.id));
  return {
    v: 1,
    updated: now.toISOString(),
    shop: {
      name: shop.name,
      slug: shop.slug,
      desc: shop.description,
      wa: shop.whatsapp,
      theme: shop.theme_color,
      open: shop.is_open === 1,
      askName: shop.ask_name === 1,
      askAddr: shop.ask_address === 1,
      tpl: plan.custom_template === 1 ? shop.message_template : null,
      branding: plan.hide_branding !== 1,
    },
    banners: banners.results.map((b) => ({ k: b.image_key })),
    cats: cats.results.map((c) => ({ id: c.id, n: c.name })),
    items: items.results.map((p) => ({
      id: p.id,
      // Kategori di luar had pelan tak diterbitkan; produknya kekal kelihatan di bawah "Semua".
      c: p.category_id && catIds.has(p.category_id) ? p.category_id : null,
      n: p.name,
      d: p.description,
      p: p.price_sen,
      t: p.thumb_key,
      i: p.image_key,
      a: p.is_available === 1,
    })),
  };
}

/**
 * Bina dan tulis snapshot selepas setiap perubahan. Pulangkan true jika berjaya.
 * Jika gagal: shops.catalog_dirty = 1 (superadmin boleh bina semula, dan tulisan seterusnya cuba lagi).
 * oldSlug: padam snapshot lama selepas tukar slug. Kedai digantung: snapshot dipadam (BSD seksyen 4).
 */
export async function publishSnapshot(env, shopId, { oldSlug = null } = {}) {
  const shop = await env.DB.prepare('SELECT * FROM shops WHERE id = ?1').bind(shopId).first();
  if (!shop) return true;
  try {
    if (oldSlug && oldSlug.toLowerCase() !== shop.slug.toLowerCase()) await env.MEDIA.delete(snapshotKey(oldSlug));
    if (shop.status === 'suspended') {
      await env.MEDIA.delete(snapshotKey(shop.slug));
    } else {
      const data = await buildSnapshotData(env.DB, env, shop);
      await env.MEDIA.put(snapshotKey(shop.slug), JSON.stringify(data), {
        httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: SNAPSHOT_CACHE },
      });
    }
    if (shop.catalog_dirty) {
      await env.DB.prepare('UPDATE shops SET catalog_dirty = 0 WHERE id = ?1').bind(shopId).run();
    }
    return true;
  } catch (err) {
    console.error('Bina snapshot gagal', shopId, err && err.stack ? err.stack : err);
    try {
      await env.DB.prepare('UPDATE shops SET catalog_dirty = 1 WHERE id = ?1').bind(shopId).run();
    } catch {
      /* D1 pun gagal; tiada apa lagi boleh dibuat */
    }
    return false;
  }
}

export const CATALOG_FAIL = {
  code: 'katalog-gagal',
  message: 'Perubahan disimpan, tetapi katalog awam belum dikemas kini. Cuba simpan sekali lagi sebentar nanti.',
};
