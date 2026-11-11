// Pelan efektif kedai. Had dan harga hidup dalam jadual `plans` (boleh diubah tanpa deploy).
// Peraturan BSD 1: pelan berbayar hanya berkuat kuasa jika ada tarikh tamat dan
// date(plan_expires_at, '+GRACE_DAYS days') >= hari ini (UTC, sama seperti date('now') dalam SQL).

export function graceDays(env) {
  const n = parseInt(env && env.GRACE_DAYS, 10);
  return Number.isFinite(n) && n >= 0 && n <= 60 ? n : 7;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function effectivePlanCode(shop, env, now = new Date()) {
  if (!shop || shop.plan_code === 'free') return 'free';
  const exp = shop.plan_expires_at;
  if (typeof exp !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(exp) || Number.isNaN(Date.parse(exp))) return 'free';
  const today = now.toISOString().slice(0, 10);
  return addDays(exp, graceDays(env)) >= today ? shop.plan_code : 'free';
}

function diffDays(fromStr, toStr) {
  return Math.round((Date.parse(`${toStr}T00:00:00Z`) - Date.parse(`${fromStr}T00:00:00Z`)) / 86400000);
}

/**
 * Keadaan langganan untuk notis (IPD 5.3), dikira di server supaya logik tarikh hanya di satu tempat (UTC):
 *   free     tiada langganan berbayar
 *   active   berbayar, lebih 14 hari lagi
 *   ending   berbayar, 14 hari atau kurang sebelum tamat (daysLeft 0 = tamat hari ini)
 *   grace    sudah tamat tetapi dalam tempoh toleransi; daysLeft = hari sebelum turun ke Percuma
 *   expired  toleransi sudah lepas; kedai kini mengikut had Percuma (data tak dipadam)
 */
export function planStatus(shop, env, now = new Date()) {
  const exp = shop && shop.plan_expires_at;
  const valid = typeof exp === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(exp) && !Number.isNaN(Date.parse(exp));
  if (!shop || shop.plan_code === 'free' || !valid) {
    return { state: 'free', daysLeft: null, expiresAt: null, graceEndsAt: null };
  }
  const today = now.toISOString().slice(0, 10);
  const graceEndsAt = addDays(exp, graceDays(env));
  if (exp >= today) {
    const daysLeft = diffDays(today, exp);
    return { state: daysLeft <= 14 ? 'ending' : 'active', daysLeft, expiresAt: exp, graceEndsAt };
  }
  if (graceEndsAt >= today) return { state: 'grace', daysLeft: diffDays(today, graceEndsAt), expiresAt: exp, graceEndsAt };
  return { state: 'expired', daysLeft: null, expiresAt: exp, graceEndsAt };
}

export async function loadPlan(db, code) {
  const plan = await db.prepare('SELECT * FROM plans WHERE code = ?1').bind(code).first();
  if (plan) return plan;
  if (code !== 'free') return loadPlan(db, 'free');
  throw new Error('Pelan "free" tiada dalam jadual plans. Jalankan db/0001_init.sql.');
}

export function planToApi(plan) {
  return {
    code: plan.code,
    name: plan.name,
    maxProducts: plan.max_products,
    maxCategories: plan.max_categories,
    maxBanners: plan.max_banners,
    maxStorageBytes: plan.max_storage_bytes,
    customTemplate: plan.custom_template === 1,
    hideBranding: plan.hide_branding === 1,
  };
}

export function formatMb(bytes) {
  const mb = bytes / 1048576;
  return Number.isInteger(mb) ? `${mb} MB` : `${mb.toFixed(1)} MB`;
}
