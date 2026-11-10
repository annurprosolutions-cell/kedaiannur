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
