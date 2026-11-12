// Panel superadmin (F-13). Akses disemak oleh functions/api/_middleware.js (SUPERADMIN_EMAILS setiap request).
// Setiap tindakan yang mengubah data ditulis ke audit_log.

import { effectivePlanCode, graceDays, planStatus } from './plan.js';

export const PAGE_SIZE = 25;

export async function audit(db, actorEmail, action, shopId, meta) {
  await db
    .prepare('INSERT INTO audit_log (actor_email, action, shop_id, meta) VALUES (?1, ?2, ?3, ?4)')
    .bind(actorEmail, action, shopId ?? null, meta ? JSON.stringify(meta) : null)
    .run();
}

function likeEscape(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Ringkasan untuk kad di atas S-16. Satu imbasan jadual shops (kira-kira 1,000 baris pada skala sasaran).
export async function summary(db, env) {
  const g = `+${graceDays(env)} days`;
  const row = await db
    .prepare(
      `SELECT count(*) AS total,
              coalesce(sum(status = 'suspended'), 0) AS suspended,
              coalesce(sum(created_at >= datetime('now', '-7 days')), 0) AS new7,
              coalesce(sum(plan_code != 'free' AND plan_expires_at >= date('now')), 0) AS paid,
              coalesce(sum(plan_code != 'free' AND plan_expires_at < date('now') AND date(plan_expires_at, ?1) >= date('now')), 0) AS grace,
              coalesce(sum(plan_code != 'free' AND plan_expires_at >= date('now') AND plan_expires_at <= date('now', '+14 days')), 0) AS ending
       FROM shops`,
    )
    .bind(g)
    .first();
  const users = await db
    .prepare('SELECT count(*) AS users, coalesce(sum(NOT EXISTS (SELECT 1 FROM shops s WHERE s.owner_user_id = u.id)), 0) AS noShop FROM users u')
    .first();
  return {
    shops: row.total,
    paid: row.paid,
    grace: row.grace,
    ending: row.ending,
    free: row.total - row.paid - row.grace,
    suspended: row.suspended,
    newLast7Days: row.new7,
    users: users.users,
    usersWithoutShop: users.noShop,
  };
}

export function shopRow(s, env) {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    ownerEmail: s.owner_email,
    planCode: s.plan_code,
    effectivePlan: effectivePlanCode(s, env),
    planExpiresAt: s.plan_expires_at,
    planStatus: planStatus(s, env),
    status: s.status,
    products: s.products,
    catalogDirty: s.catalog_dirty === 1,
    createdAt: s.created_at,
  };
}

/** Senarai dengan carian (slug, nama, e-mel pemilik) dan tapisan; 25 baris setiap halaman. */
export async function listShops(db, env, { q = '', plan = '', status = '', page = 1 }) {
  const where = [];
  const binds = [];
  if (q) {
    binds.push(`%${likeEscape(q.toLowerCase())}%`);
    const n = binds.length;
    where.push(`(lower(s.slug) LIKE ?${n} ESCAPE '\\' OR lower(s.name) LIKE ?${n} ESCAPE '\\' OR lower(u.email) LIKE ?${n} ESCAPE '\\')`);
  }
  if (plan === 'free' || plan === 'pro') {
    binds.push(plan);
    where.push(`s.plan_code = ?${binds.length}`);
  }
  if (status === 'active' || status === 'suspended') {
    binds.push(status);
    where.push(`s.status = ?${binds.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;

  const [rows, count] = await Promise.all([
    db
      .prepare(
        `SELECT s.*, u.email AS owner_email,
                (SELECT count(*) FROM products p WHERE p.shop_id = s.id) AS products
         FROM shops s JOIN users u ON u.id = s.owner_user_id
         ${clause}
         ORDER BY s.created_at DESC, s.id
         LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      )
      .bind(...binds)
      .all(),
    db.prepare(`SELECT count(*) AS n FROM shops s JOIN users u ON u.id = s.owner_user_id ${clause}`).bind(...binds).first(),
  ]);
  return { shops: rows.results.map((s) => shopRow(s, env)), total: count.n, page: Math.max(1, page), pageSize: PAGE_SIZE };
}

export async function getShopForAdmin(db, id) {
  if (typeof id !== 'string' || id.length > 64) return null;
  return db
    .prepare(
      `SELECT s.*, u.email AS owner_email, u.name AS owner_name, u.last_login_at AS owner_last_login,
              (SELECT count(*) FROM products p WHERE p.shop_id = s.id) AS products,
              (SELECT count(*) FROM categories c WHERE c.shop_id = s.id) AS categories,
              (SELECT count(*) FROM shop_banners b WHERE b.shop_id = s.id) AS banners
       FROM shops s JOIN users u ON u.id = s.owner_user_id WHERE s.id = ?1`,
    )
    .bind(id)
    .first();
}

export function paymentToApi(p) {
  return {
    id: p.id,
    orderNo: p.order_no,
    provider: p.provider,
    shopId: p.shop_id,
    shopSlug: p.shop_slug ?? null,
    payerEmail: p.payer_email,
    amountSen: p.amount_sen,
    period: p.period,
    quantity: p.quantity,
    monthsAdded: p.months_added,
    status: p.status,
    createdAt: p.created_at,
  };
}

// ---------------------------------------------------------------- statistik (S-16b) dan peringatan tamat

export const STATS_DAYS = 30;
// Hari dikira mengikut waktu Malaysia (UTC+8); created_at dalam D1 ialah UTC.
const MYT = '+8 hours';

function lastDays(n, now = new Date()) {
  const base = new Date(now.getTime() + 8 * 3600 * 1000); // tarikh MYT
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(base.getTime() - i * 86400000).toISOString().slice(0, 10));
  return out;
}

/** Siri harian 30 hari (pendaftaran, kedai baharu, bayaran) dan senarai Pro yang hampir tamat atau dalam toleransi. */
export async function stats(db, env, now = new Date()) {
  const since = `-${STATS_DAYS + 1} days`;
  const g = `+${graceDays(env)} days`;
  const daily = (table, extra = '') =>
    db
      .prepare(
        `SELECT date(created_at, '${MYT}') AS d, count(*) AS n${table === 'payments' ? ', coalesce(sum(amount_sen), 0) AS sen' : ''}
         FROM ${table} WHERE created_at >= datetime('now', ?1) ${extra} GROUP BY d`,
      )
      .bind(since)
      .all();
  const [users, shops, pays, totals, ending, base] = await Promise.all([
    daily('users'),
    daily('shops'),
    daily('payments', "AND status = 'applied'"),
    db
      .prepare(
        `SELECT coalesce(sum(amount_sen), 0) AS allSen, coalesce(sum(CASE WHEN created_at >= datetime('now', '-30 days') THEN amount_sen END), 0) AS sen30,
                count(*) AS n FROM payments WHERE status = 'applied'`,
      )
      .first(),
    db
      .prepare(
        `SELECT s.id, s.slug, s.name, s.whatsapp, s.plan_expires_at, s.plan_code, s.plan_anchor_day, s.status,
                (SELECT max(a.created_at) FROM audit_log a WHERE a.shop_id = s.id AND a.action = 'remind') AS reminded_at
         FROM shops s
         WHERE s.plan_code != 'free' AND s.plan_expires_at <= date('now', '+14 days') AND date(s.plan_expires_at, ?1) >= date('now')
         ORDER BY s.plan_expires_at, s.id LIMIT 100`,
      )
      .bind(g)
      .all(),
    summary(db, env),
  ]);
  const by = (rows) => Object.fromEntries(rows.results.map((r) => [r.d, r]));
  const u = by(users);
  const s = by(shops);
  const p = by(pays);
  const days = lastDays(STATS_DAYS, now).map((d) => ({
    date: d,
    users: u[d] ? u[d].n : 0,
    shops: s[d] ? s[d].n : 0,
    payments: p[d] ? p[d].n : 0,
    revenueSen: p[d] ? p[d].sen : 0,
  }));
  return {
    days,
    totals: {
      shops: base.shops,
      paid: base.paid,
      grace: base.grace,
      conversionPct: base.shops ? Math.round((base.paid / base.shops) * 1000) / 10 : 0,
      revenue30Sen: totals.sen30,
      revenueAllSen: totals.allSen,
      paymentsAll: totals.n,
    },
    ending: ending.results.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      whatsapp: r.whatsapp,
      expiresAt: r.plan_expires_at,
      state: planStatus(r, env, now).state,
      suspended: r.status === 'suspended',
      remindedAt: r.reminded_at,
    })),
  };
}
