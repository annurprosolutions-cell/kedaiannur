// Langganan Pro melalui BCL (Fasa 6, F-11). Diadaptasi daripada pengendali webhook Annur Time Table yang sudah berjalan.
//
// Aliran: BCL POST /api/webhooks/bcl/<BCL_WEBHOOK_KEY> (acara payment-success) -> sahkan transaksi melalui API BCL
// (webhook BCL tak ditandatangan, jadi body tak pernah dipercayai) -> rekod dalam `payments` (order_no UNIQUE = idempotent)
// -> lanjutkan Pro kedai yang e-mel Google pemiliknya sama dengan medan tersuai borang. Jika tiada kedai, bayaran disimpan
// `unmatched` dan digunakan automatik bila kedai dengan e-mel itu dicipta (atau dipadankan oleh superadmin di S-18).
//
// Pemboleh ubah: BCL_API_TOKEN (secret, token "API Read"), BCL_WEBHOOK_KEY (secret), BCL_FORM_ID, BCL_FORM_URL,
// BCL_ACCEPT_TEST ("1" hanya semasa ujian), BCL_API_URL (lalai https://api.bcl.my/v1).

import { extendExpiry } from './subscription.js';
import { publishSnapshot } from './catalog.js';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ACTOR = 'webhook-bcl';

/** Banding rentetan tanpa bocor masa (kunci webhook). */
export function safeEqual(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0 && x.length > 0;
}

/** E-mel log masuk Google: medan tersuai yang namanya menyebut google/e-mel/log masuk; jika tiada, e-mel pembayar. */
export function pickEmail(custom, fallback) {
  const entries = Object.entries(custom || {})
    .map(([k, v]) => [k, String(v ?? '').trim().toLowerCase()])
    .filter(([, v]) => EMAIL.test(v));
  const hit = entries.find(([k]) => /google|login|log ?masuk|akaun|e[-_ ]?mel|email/i.test(k)) || entries[0];
  const v = hit ? hit[1] : String(fallback || '').trim().toLowerCase();
  return EMAIL.test(v) ? v : '';
}

const toSen = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/**
 * Bulan daripada item yang dibeli. Item mesti item borang Kedai Pro (nama mengandungi "kedai pro" dan "bulan" atau
 * "tahun"), supaya transaksi berbayar daripada borang lain (contoh kursus RM200) tak boleh digunakan untuk Pro.
 * Pulangkan { months, period, quantity } atau null jika tiada item yang dikenali.
 */
export function monthsFromItems(items) {
  let months = 0;
  let quantity = 0;
  let yearly = false;
  for (const it of Array.isArray(items) ? items : []) {
    const text = [it && it.item, it && it.name, it && it.option, it && it.sku].filter(Boolean).join(' ');
    if (!/kedai\s*pro/i.test(text)) continue;
    const unit = /tahun|year|annual/i.test(text) ? 12 : /bulan|month/i.test(text) ? 1 : 0;
    if (!unit) continue;
    const q = Math.min(120, Math.max(1, parseInt(it.quantity, 10) || 1));
    months += unit * q;
    quantity += q;
    if (unit === 12) yearly = true;
  }
  return months ? { months: Math.min(months, 1200), period: yearly ? 'yearly' : 'monthly', quantity } : null;
}

/** Sahkan transaksi melalui API BCL. Pulangkan { paid, amountSen, subtotalSen, items, payerEmail, custom, test } atau { paid:false, reason }. */
export async function verifyOrder(env, order, fetchFn = fetch) {
  if (!env.BCL_API_TOKEN) return { paid: false, reason: 'tiada-token-api' };
  const base = String(env.BCL_API_URL || 'https://api.bcl.my/v1').replace(/\/$/, '');
  let res;
  try {
    res = await fetchFn(`${base}/transactions/${encodeURIComponent(order)}`, {
      headers: { authorization: `Bearer ${env.BCL_API_TOKEN}`, accept: 'application/json', 'user-agent': 'KedaiAnnurPro-Langganan/1.0' },
    });
  } catch {
    return { paid: false, reason: 'api-tak-dapat-dihubungi' };
  }
  if (!res.ok) return { paid: false, reason: `api-${res.status}` };
  let j;
  try {
    j = await res.json();
  } catch {
    return { paid: false, reason: 'api-bukan-json' };
  }
  // GET /transactions/{order}: { success, data: { record_id, main_data: { status, is_paid, amount, items, ... }, custom_fields_data } }
  const d = (j && j.data) || j || {};
  const t = d.main_data || d;
  if (String(t.order_number || d.record_id || '') !== String(order)) return { paid: false, reason: 'pesanan-tidak-sepadan' };
  const code = Number(t.status_code != null ? t.status_code : t.status);
  const paid = code === 3 || t.is_paid === true || Number(t.is_paid) === 1 || /^(success|successful|approved|completed)$/i.test(String(t.status || ''));
  return {
    paid,
    reason: paid ? undefined : 'belum-dibayar',
    amountSen: toSen(t.amount),
    subtotalSen: toSen(t.subtotal_amount),
    items: t.items,
    payerEmail: t.payer_email,
    custom: d.custom_fields_data || t.custom_fields_data || null,
    test: t.transaction_type === 'test',
  };
}

/** Lanjutkan Pro kedai dan rekod bayaran dalam satu batch. INSERT gagal (order_no UNIQUE) = tiada perubahan pada kedai. */
async function applyToShop(env, shop, pay) {
  const db = env.DB;
  const next = extendExpiry(shop, pay.months, env);
  await db.batch([
    db
      .prepare(
        `INSERT INTO payments (id, order_no, provider, shop_id, payer_email, amount_sen, period, quantity, months_added, status)
         VALUES (?1, ?2, 'bcl', ?3, ?4, ?5, ?6, ?7, ?8, 'applied')`,
      )
      .bind(crypto.randomUUID(), pay.orderNo, shop.id, pay.email, pay.amountSen, pay.period, pay.quantity, pay.months),
    db
      .prepare(`UPDATE shops SET plan_code = 'pro', plan_expires_at = ?1, plan_anchor_day = ?2, updated_at = datetime('now') WHERE id = ?3`)
      .bind(next.expiresAt, next.anchorDay, shop.id),
    db
      .prepare('INSERT INTO audit_log (actor_email, action, shop_id, meta) VALUES (?1, ?2, ?3, ?4)')
      .bind(ACTOR, 'bcl_payment', shop.id, JSON.stringify({ orderNo: pay.orderNo, months: pay.months, planExpiresAt: next.expiresAt })),
  ]);
  // Ciri Pro (banner berputar, buang branding) dalam snapshot awam. Gagal = catalog_dirty, dibina semula kemudian.
  await publishSnapshot(env, shop.id);
  return next.expiresAt;
}

/**
 * Proses body webhook BCL. Pulangkan objek keputusan untuk log (tiada data peribadi selain e-mel yang sudah diketahui).
 * @param {{ fetchFn?: typeof fetch }} [o]
 */
export async function processBcl(body, env, o = {}) {
  const fetchFn = o.fetchFn || fetch;
  const event = String((body && body.event) || '');
  const d = (body && body.data) || {};
  const md = d.main_data || {};
  if (event !== 'payment-success') return { ok: true, ignored: event || 'tiada-event' };
  if (d.record_type && d.record_type !== 'Transaction') return { ok: true, ignored: `jenis-${d.record_type}` };
  const orderNo = String(md.order_number || d.record_id || '').slice(0, 100);
  if (!orderNo) return { ok: false, reason: 'tiada-nombor-order' };
  const formId = d.formable_id != null ? d.formable_id : d.form_id;
  if (env.BCL_FORM_ID && String(formId) !== String(env.BCL_FORM_ID)) return { ok: true, ignored: 'borang-lain' };
  if (md.transaction_type === 'test' && env.BCL_ACCEPT_TEST !== '1') return { ok: true, ignored: 'transaksi-ujian' };

  const db = env.DB;
  if (await db.prepare('SELECT 1 FROM payments WHERE order_no = ?1').bind(orderNo).first()) return { ok: true, duplicate: true, orderNo };

  const v = await verifyOrder(env, orderNo, fetchFn);
  if (!v.paid) return { ok: false, reason: v.reason, orderNo };
  if (v.test && env.BCL_ACCEPT_TEST !== '1') return { ok: true, ignored: 'transaksi-ujian', orderNo };
  // Jumlah dalam webhook mesti sama dengan API (webhook palsu yang guna nombor order sebenar dengan jumlah lain ditolak).
  const hookAmount = toSen(md.amount);
  const hookSubtotal = toSen(md.subtotal_amount);
  if (v.amountSen != null && hookAmount != null && v.amountSen !== hookAmount && v.amountSen !== hookSubtotal) {
    return { ok: false, reason: 'jumlah-tidak-sepadan', orderNo };
  }
  const plan = monthsFromItems(v.items);
  if (!plan) return { ok: false, reason: 'item-tidak-dikenali', orderNo };
  const email = pickEmail(v.custom || d.custom_fields_data, v.payerEmail || md.payer_email);
  if (!email) return { ok: false, reason: 'tiada-emel', orderNo };

  const pay = {
    orderNo,
    email,
    amountSen: v.subtotalSen ?? v.amountSen ?? hookSubtotal ?? hookAmount ?? 0,
    period: plan.period,
    quantity: plan.quantity,
    months: plan.months,
  };
  const shop = await db
    .prepare('SELECT s.* FROM shops s JOIN users u ON u.id = s.owner_user_id WHERE u.email = ?1 COLLATE NOCASE')
    .bind(email)
    .first();
  try {
    if (shop) {
      const expiresAt = await applyToShop(env, shop, pay);
      return { ok: true, applied: true, orderNo, shopId: shop.id, months: pay.months, expiresAt };
    }
    await db
      .prepare(
        `INSERT INTO payments (id, order_no, provider, shop_id, payer_email, amount_sen, period, quantity, months_added, status)
         VALUES (?1, ?2, 'bcl', NULL, ?3, ?4, ?5, ?6, ?7, 'unmatched')`,
      )
      .bind(crypto.randomUUID(), orderNo, email, pay.amountSen, pay.period, pay.quantity, pay.months)
      .run();
    return { ok: true, unmatched: true, orderNo, months: pay.months };
  } catch (err) {
    // Dua webhook serentak untuk order yang sama: yang kedua gagal pada order_no UNIQUE dan tiada apa-apa ditambah.
    if (/UNIQUE constraint failed: payments\.order_no/i.test(String(err && err.message))) return { ok: true, duplicate: true, orderNo };
    throw err;
  }
}

/**
 * Bila kedai dicipta: guna bayaran `unmatched` untuk e-mel pemilik (bayar dahulu, daftar kemudian).
 * Setiap bayaran ditukar status dengan syarat `status = 'unmatched'`, jadi tiada bayaran digunakan dua kali.
 */
export async function applyUnmatchedForShop(env, shopId, email) {
  const db = env.DB;
  const { results } = await db
    .prepare("SELECT * FROM payments WHERE status = 'unmatched' AND payer_email = ?1 COLLATE NOCASE AND months_added > 0 ORDER BY created_at")
    .bind(String(email || ''))
    .all();
  let applied = 0;
  for (const p of results) {
    const shop = await db.prepare('SELECT * FROM shops WHERE id = ?1').bind(shopId).first();
    if (!shop) break;
    const next = extendExpiry(shop, p.months_added, env);
    const [upd] = await db.batch([
      db.prepare("UPDATE payments SET status = 'applied', shop_id = ?1 WHERE id = ?2 AND status = 'unmatched'").bind(shopId, p.id),
      db
        .prepare(
          `UPDATE shops SET plan_code = 'pro', plan_expires_at = ?1, plan_anchor_day = ?2, updated_at = datetime('now')
           WHERE id = ?3 AND EXISTS (SELECT 1 FROM payments WHERE id = ?4 AND status = 'applied' AND shop_id = ?3)`,
        )
        .bind(next.expiresAt, next.anchorDay, shopId, p.id),
      db
        .prepare(
          `INSERT INTO audit_log (actor_email, action, shop_id, meta)
           SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM payments WHERE id = ?5 AND status = 'applied' AND shop_id = ?3)`,
        )
        .bind(ACTOR, 'apply_unmatched', shopId, JSON.stringify({ orderNo: p.order_no, months: p.months_added, planExpiresAt: next.expiresAt }), p.id),
    ]);
    if (upd.meta.changes) applied++;
  }
  if (applied) await publishSnapshot(env, shopId);
  return applied;
}

/** URL borang BCL untuk butang Bayar (awam). Hanya https. */
export function formUrl(env) {
  const u = String(env.BCL_FORM_URL || '').trim();
  return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;
}
