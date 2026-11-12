// Marketplace: senarai kedai awam di /marketplace, dibaca daripada indeks R2 market/index.json (bukan D1 setiap lawatan).
//
// Siapa disenaraikan (keputusan pemilik):
//   - Pro: automatik, kecuali peniaga memilih keluar (market_opt = 0).
//   - Percuma: hanya jika peniaga memilih masuk (market_opt = 1).
//   - Semua: kedai aktif (tak digantung), tak disembunyikan admin, jenis kedai dipilih, ada logo atau banner,
//     dan sekurang-kurangnya MARKET_MIN_PRODUCTS produk yang ada stok.
// Susunan: Pilihan Admin, kemudian Pro, kemudian skor kelengkapan, kemudian kemas kini terkini.

import { effectivePlanCode, graceDays } from './plan.js';
import { MARKET_MIN_PRODUCTS, categoryName } from '../public/assets/js/rules.js';

export const MARKET_KEY = 'market/index.json';
export const MARKET_TTL_MS = 5 * 60 * 1000;
const MAX_SHOPS = 2000;

/** Syarat yang belum dipenuhi (teks untuk peniaga) dan sama ada kedai disenaraikan. */
export function marketEligibility(shop, { isPro, products, hasBanner }) {
  const wants = shop.market_opt === 1 || (shop.market_opt === null || shop.market_opt === undefined ? isPro : false);
  const issues = [];
  if (!shop.category) issues.push('Pilih jenis kedai.');
  if (!shop.logo_key && !hasBanner) issues.push('Muat naik logo atau banner.');
  if (products < MARKET_MIN_PRODUCTS) issues.push(`Sekurang-kurangnya ${MARKET_MIN_PRODUCTS} produk yang ada stok (sekarang ${products}).`);
  if (shop.status === 'suspended') issues.push('Kedai sedang digantung.');
  if (shop.market_hidden === 1) issues.push('Disembunyikan oleh pentadbir. Hubungi sokongan.');
  return { wants, listed: wants && issues.length === 0, issues, defaultOn: isPro };
}

function score(r) {
  return (r.logo_key ? 2 : 0) + (r.banner ? 2 : 0) + (r.description ? 1 : 0) + (r.contact ? 1 : 0) + Math.min(r.items, 20) / 10;
}

/** Bina indeks daripada D1 dan tulis ke R2. Pulangkan data indeks. */
export async function buildMarketIndex(env, now = new Date()) {
  const { results } = await env.DB
    .prepare(
      `SELECT s.id, s.slug, s.name, s.description, s.category, s.logo_key, s.plan_code, s.plan_expires_at, s.status, s.is_open,
              s.market_opt, s.market_hidden, s.market_featured, s.updated_at,
              (s.opening_hours != '' OR s.maps_url != '' OR s.instagram != '' OR s.tiktok != '' OR s.facebook != '') AS contact,
              (SELECT count(*) FROM products p WHERE p.shop_id = s.id AND p.is_available = 1) AS items,
              (SELECT b.image_key FROM shop_banners b WHERE b.shop_id = s.id ORDER BY b.sort_order, b.id LIMIT 1) AS banner
       FROM shops s
       WHERE s.status = 'active' AND s.market_hidden = 0 AND s.category != ''
         AND (s.market_opt = 1 OR (s.market_opt IS NULL AND s.plan_code != 'free' AND date(s.plan_expires_at, ?1) >= date('now')))
       LIMIT ?2`,
    )
    .bind(`+${graceDays(env)} days`, MAX_SHOPS)
    .all();

  const shops = results
    .map((r) => ({ ...r, pro: effectivePlanCode(r, env, now) !== 'free' }))
    .filter((r) => marketEligibility(r, { isPro: r.pro, products: r.items, hasBanner: Boolean(r.banner) }).listed)
    .sort(
      (x, y) =>
        y.market_featured - x.market_featured ||
        Number(y.pro) - Number(x.pro) ||
        score(y) - score(x) ||
        String(y.updated_at).localeCompare(String(x.updated_at)),
    )
    .map((r) => ({
      s: r.slug,
      n: r.name,
      d: String(r.description || '').replace(/\s+/g, ' ').trim().slice(0, 140),
      c: r.category,
      cn: categoryName(r.category),
      l: r.logo_key || null,
      b: r.banner || null,
      p: r.pro,
      f: r.market_featured === 1,
      o: r.is_open === 1,
      i: r.items,
      u: r.updated_at,
    }));

  const data = { v: 1, updated: now.toISOString(), shops };
  await env.MEDIA.put(MARKET_KEY, JSON.stringify(data), { httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=60' } });
  return data;
}

/**
 * Indeks semasa: dibaca daripada R2; jika tiada, dibina sekarang; jika lama (> MARKET_TTL_MS), yang lama dihidang dan
 * dibina semula di latar (waitUntil), supaya lawatan tak menunggu D1.
 */
export async function getMarketIndex(env, waitUntil, now = Date.now()) {
  const obj = await env.MEDIA.get(MARKET_KEY);
  if (!obj) return buildMarketIndex(env);
  let data;
  try {
    data = JSON.parse(await obj.text());
  } catch {
    return buildMarketIndex(env);
  }
  if (now - new Date(data.updated).getTime() > MARKET_TTL_MS) {
    const job = buildMarketIndex(env).catch((err) => console.error('Bina indeks marketplace gagal', err && err.message ? err.message : err));
    if (waitUntil) waitUntil(job);
  }
  return data;
}

/** Status Marketplace untuk dashboard peniaga (GET /api/shop). */
export async function marketStatusFor(env, shop, isPro) {
  const row = await env.DB
    .prepare(
      `SELECT (SELECT count(*) FROM products WHERE shop_id = ?1 AND is_available = 1) AS items,
              (SELECT count(*) FROM shop_banners WHERE shop_id = ?1) AS banners`,
    )
    .bind(shop.id)
    .first();
  const e = marketEligibility(shop, { isPro, products: row.items, hasBanner: row.banners > 0 });
  return { listed: e.listed, wants: e.wants, issues: e.issues, defaultOn: e.defaultOn, featured: shop.market_featured === 1 };
}

/**
 * Selepas kandungan kedai berubah (produk, banner, logo, pelan, gantung): jika status kedai di Marketplace tak lagi
 * sepadan dengan indeks (sepatutnya tersenarai tapi tiada, atau sebaliknya), bina semula indeks serta-merta.
 * Perubahan kecil lain (nama, logo baharu) dikemas kini bila indeks luput (MARKET_TTL_MS). Kegagalan hanya dilog.
 */
export async function syncMarketForShop(env, shop) {
  try {
    const obj = await env.MEDIA.get(MARKET_KEY);
    if (!obj) return false; // belum pernah dibina: lawatan pertama ke /marketplace akan membinanya
    const index = JSON.parse(await obj.text());
    const present = (index.shops || []).some((s) => s.s === shop.slug);
    const isPro = effectivePlanCode(shop, env) !== 'free';
    const { listed } = await marketStatusFor(env, shop, isPro);
    if (listed === present) return false;
    await buildMarketIndex(env);
    return true;
  } catch (err) {
    console.error('Selaras marketplace gagal', shop && shop.id, err && err.message ? err.message : err);
    return false;
  }
}
