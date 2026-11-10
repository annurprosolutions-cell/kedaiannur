import { randomToken, sha256Hex } from '../../lib/crypto.js';
import { FakeD1 } from './d1.js';
import { FakeR2 } from './r2.js';

export function makeEnv(extra = {}) {
  return { DB: new FakeD1(), MEDIA: new FakeR2(), GOOGLE_CLIENT_ID: 'x', SUPERADMIN_EMAILS: 'admin@annurpro.test', SESSION_DAYS: '30', GRACE_DAYS: '7', ...extra };
}

// Cipta pengguna dan sesi terus dalam D1 (tanpa melalui Google).
export async function makeUser(env, n, { email } = {}) {
  const id = `u-${n}`;
  email ||= `user${n}@ujian.test`;
  env.DB.sqlite.prepare('INSERT INTO users (id, google_sub, email, name) VALUES (?, ?, ?, ?)').run(id, `sub-${n}`, email, `Pengguna ${n}`);
  const token = randomToken(32);
  env.DB.sqlite
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))")
    .run(await sha256Hex(token), id);
  return { id, email, headers: { Cookie: `__Host-sid=${token}` } };
}

export const SHOP_BODY = { name: 'Kedai Wakanda', slug: 'wakanda', whatsapp: '0123456789' };

export function insertShop(env, user, { slug = 'wakanda', plan = 'free', expires = null, status = 'active', storage = 0 } = {}) {
  const id = `shop-${user.id}`;
  env.DB.sqlite
    .prepare(
      `INSERT INTO shops (id, owner_user_id, slug, name, whatsapp, plan_code, plan_expires_at, status, storage_bytes)
       VALUES (?, ?, ?, 'Kedai Ujian', '60123456789', ?, ?, ?, ?)`,
    )
    .run(id, user.id, slug, plan, expires, status, storage);
  return id;
}
