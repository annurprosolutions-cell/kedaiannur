// Akses data kedai untuk peniaga. Kedai sentiasa dicari melalui owner_user_id sesi, tak pernah melalui id daripada client.

import { fail } from './http.js';
import { effectivePlanCode, loadPlan, planToApi } from './plan.js';
import { LIMITS } from '../public/assets/js/rules.js';

export async function getShopByOwner(db, userId) {
  return db.prepare('SELECT * FROM shops WHERE owner_user_id = ?1').bind(userId).first();
}

export async function getBanners(db, shopId) {
  const { results } = await db
    .prepare('SELECT id, image_key, bytes, sort_order FROM shop_banners WHERE shop_id = ?1 ORDER BY sort_order, id')
    .bind(shopId)
    .all();
  return results;
}

/**
 * Muat kedai peniaga dan pelan efektifnya. Pulangkan { shop, plan } atau { error: Response }.
 * writable: tolak jika kedai digantung (kedai digantung tak boleh diubah; snapshot awam sudah dipadam).
 */
export async function ownerShop(env, user, { writable = false } = {}) {
  const shop = await getShopByOwner(env.DB, user.id);
  if (!shop) return { error: fail(404, 'belum-ada-kedai', 'Sila siapkan setup kedai dahulu.') };
  if (writable && shop.status === 'suspended') {
    return { error: fail(403, 'digantung', 'Kedai anda sedang digantung. Hubungi sokongan.') };
  }
  const plan = await loadPlan(env.DB, effectivePlanCode(shop, env));
  return { shop, plan };
}

// Ringkasan kedai untuk /api/me.
export function shopSummary(shop, plan) {
  return {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    status: shop.status,
    suspendedReason: shop.suspended_reason,
    isOpen: shop.is_open === 1,
    planCode: shop.plan_code,
    planExpiresAt: shop.plan_expires_at,
    plan: planToApi(plan),
    storageBytes: shop.storage_bytes,
  };
}

// Tetapan penuh untuk S-13 (GET /api/shop dan respons PATCH).
export function shopDetail(shop, plan, banners) {
  return {
    ...shopSummary(shop, plan),
    description: shop.description,
    whatsapp: shop.whatsapp,
    themeColor: shop.theme_color,
    askName: shop.ask_name === 1,
    askAddress: shop.ask_address === 1,
    slugChangesLeft: Math.max(0, LIMITS.slugChangesMax - shop.slug_changes),
    createdAt: shop.created_at,
  };
}

export function bannersToApi(banners) {
  return banners.map((b) => ({ key: b.image_key, bytes: b.bytes }));
}

export async function shopResponseData(env, user) {
  const { shop, plan, error } = await ownerShop(env, user);
  if (error) return { error };
  const banners = await getBanners(env.DB, shop.id);
  return { body: { ok: true, shop: shopDetail(shop, plan), banners: bannersToApi(banners) } };
}
