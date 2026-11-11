// Sesi peniaga dan superadmin. Token asal hanya dalam cookie; D1 simpan hash SHA-256.

import { randomToken, sha256Hex } from './crypto.js';
import { parseCookies, SESSION_COOKIE } from './http.js';
import { getShopByOwner, loadUsage, shopSummary } from './shop.js';
import { effectivePlanCode, loadPlan } from './plan.js';

export function sessionDays(env) {
  const n = parseInt(env.SESSION_DAYS, 10);
  return Number.isFinite(n) && n >= 1 && n <= 90 ? n : 30;
}

export function isSuperadmin(env, email) {
  if (!email) return false;
  const list = String(env.SUPERADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(String(email).toLowerCase());
}

/**
 * Cipta atau kemas kini pengguna daripada profil Google, padam sesi tamat milik
 * pengguna itu dan cipta sesi baharu. Satu batch D1 = satu transaksi, satu round trip.
 */
export async function loginWithGoogleProfile(db, env, profile) {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const days = sessionDays(env);

  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, google_sub, email, name, last_login_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(google_sub) DO UPDATE SET
           email = excluded.email,
           name = excluded.name,
           last_login_at = excluded.last_login_at
         RETURNING id, email, name`,
      )
      .bind(crypto.randomUUID(), profile.sub, profile.email, profile.name),
    db
      .prepare(
        `DELETE FROM sessions
         WHERE user_id = (SELECT id FROM users WHERE google_sub = ?1)
           AND expires_at <= datetime('now')`,
      )
      .bind(profile.sub),
    db
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, expires_at)
         SELECT ?1, id, datetime('now', ?2) FROM users WHERE google_sub = ?3`,
      )
      .bind(tokenHash, `+${days} days`, profile.sub),
  ]);

  const user = results[0].results[0];
  return { token, maxAge: days * 86400, user };
}

export function tokenFromRequest(request) {
  const value = parseCookies(request.headers.get('Cookie'))[SESSION_COOKIE];
  // Token sah: 43 aksara base64url (32 bait). Tolak awal tanpa sentuh D1.
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export async function userFromRequest(db, request) {
  const token = tokenFromRequest(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.name
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?1 AND s.expires_at > datetime('now')`,
    )
    .bind(tokenHash)
    .first();
  return row ? { ...row, tokenHash } : null;
}

export async function deleteSession(db, request) {
  const token = tokenFromRequest(request);
  if (!token) return;
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256Hex(token)).run();
}

// Data untuk /api/me: pengguna, kedai, pelan efektif dan penggunaan had (TRD seksyen 10).
// Kiraan produk membaca entri index sebanyak bilangan produk kedai itu (maksimum 500), sekali setiap app dibuka.
export async function buildMe(db, env, user) {
  const shop = await getShopByOwner(db, user.id);
  const [plan, usage] = shop ? await Promise.all([loadPlan(db, effectivePlanCode(shop, env)), loadUsage(db, shop.id)]) : [null, null];

  return {
    ok: true,
    user: { id: user.id, email: user.email, name: user.name },
    isAdmin: isSuperadmin(env, user.email),
    shop: shop ? shopSummary(shop, plan, usage) : null,
  };
}
