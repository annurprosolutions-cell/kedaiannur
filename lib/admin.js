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
