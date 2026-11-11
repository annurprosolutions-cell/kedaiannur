import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1 } from './helpers/d1.js';
import { createFakeGoogle, CLIENT_ID } from './helpers/google.js';
import { callApi, cookieFrom, routePaths } from './helpers/pages.js';
import { sha256Hex } from '../lib/crypto.js';

let g;
let db;
let env;

before(async () => {
  g = await createFakeGoogle();
  g.install();
});
after(() => g.restore());

beforeEach(() => {
  db = new FakeD1();
  env = { DB: db, GOOGLE_CLIENT_ID: CLIENT_ID, SUPERADMIN_EMAILS: 'Admin@AnnurPro.test, kedua@annurpro.test', SESSION_DAYS: '30' };
});

async function login(overrides = {}) {
  const credential = await g.sign(overrides);
  return callApi(env, 'POST', '/api/auth/google', { body: { credential } });
}

const withCookie = (sid) => ({ headers: { Cookie: `__Host-sid=${sid}` } });

test('laluan Functions yang dijangka wujud', () => {
  for (const p of ['/api/ping', '/api/config', '/api/me', '/api/auth/google', '/api/auth/logout']) {
    assert.ok(routePaths.includes(p), `tiada ${p}`);
  }
});

test('GET /api/ping tanpa sesi dan tanpa D1', async () => {
  const res = await callApi({}, 'GET', '/api/ping');
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('GET /api/config pulangkan client id awam sahaja', async () => {
  const res = await callApi(env, 'GET', '/api/config');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json).sort(), ['googleClientId', 'mediaBaseUrl', 'ok', 'supportEmail']);
  assert.equal(res.json.googleClientId, CLIENT_ID);
  assert.ok(!res.text.includes('Admin@'), 'senarai superadmin tak boleh bocor');
});

test('API tanpa sesi ditolak 401 (IPD ujian "API tanpa sesi")', async () => {
  for (const path of ['/api/me', '/api/products', '/api/shop', '/api/admin/shops']) {
    const res = await callApi(env, 'GET', path);
    assert.equal(res.status, 401, path);
    assert.deepEqual(res.json, { ok: false, code: 'perlu-login', message: 'Sila log masuk semula.' });
  }
});

test('cookie bentuk salah ditolak tanpa query D1', async () => {
  const res = await callApi(env, 'GET', '/api/me', withCookie('pendek'));
  assert.equal(res.status, 401);
  assert.equal(db.queries.length, 0);
});

test('login berjaya: cipta pengguna, sesi (hash sahaja) dan cookie selamat', async () => {
  const res = await login();
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.user.email, 'peniaga@gmail.com');
  assert.equal(res.json.user.name, 'Peniaga Ujian');
  assert.equal(res.json.shop, null);
  assert.equal(res.json.isAdmin, false);

  const set = res.headers.get('set-cookie');
  assert.match(set, /^__Host-sid=[A-Za-z0-9_-]{43}; /);
  for (const attr of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=2592000']) {
    assert.ok(set.includes(attr), `cookie tiada ${attr}`);
  }
  assert.ok(!/Domain=/i.test(set));

  const token = cookieFrom(res);
  const users = db.rows('SELECT * FROM users');
  assert.equal(users.length, 1);
  assert.equal(users[0].google_sub, '1234567890');
  assert.ok(users[0].last_login_at);

  const sessions = db.rows('SELECT * FROM sessions');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].token_hash, await sha256Hex(token));
  assert.notEqual(sessions[0].token_hash, token);
  const days = (Date.parse(sessions[0].expires_at + 'Z') - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30, `tamat dalam ${days} hari`);
});

test('GET /api/me dengan cookie sah', async () => {
  const sid = cookieFrom(await login());
  const res = await callApi(env, 'GET', '/api/me', withCookie(sid));
  assert.equal(res.status, 200);
  assert.equal(res.json.user.email, 'peniaga@gmail.com');
  assert.equal(res.json.shop, null);
});

test('login semula: pengguna sama dikemas kini, bukan dicipta semula', async () => {
  const first = await login();
  const second = await login({ email: 'baharu@gmail.com', name: 'Nama Baharu' });
  assert.equal(second.status, 200);
  assert.equal(second.json.user.id, first.json.user.id);
  assert.equal(second.json.user.email, 'baharu@gmail.com');
  assert.equal(db.rows('SELECT * FROM users').length, 1);
  assert.equal(db.rows('SELECT * FROM sessions').length, 2);
});

test('sesi tamat ditolak dan dibersihkan semasa login seterusnya', async () => {
  const sid = cookieFrom(await login());
  db.sqlite.exec("UPDATE sessions SET expires_at = datetime('now', '-1 minute')");
  const res = await callApi(env, 'GET', '/api/me', withCookie(sid));
  assert.equal(res.status, 401);

  await login();
  const sessions = db.rows('SELECT * FROM sessions');
  assert.equal(sessions.length, 1, 'sesi tamat dipadam secara oportunistik');
  assert.notEqual(sessions[0].token_hash, await sha256Hex(sid));
});

test('logout padam sesi dan kosongkan cookie; cookie lama tak boleh guna', async () => {
  const sid = cookieFrom(await login());
  const res = await callApi(env, 'POST', '/api/auth/logout', { ...withCookie(sid), body: {} });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /__Host-sid=; .*Max-Age=0/);
  assert.equal(db.rows('SELECT * FROM sessions').length, 0);
  assert.equal((await callApi(env, 'GET', '/api/me', withCookie(sid))).status, 401);
});

test('logout tanpa sesi tetap OK (bersihkan cookie lama)', async () => {
  const res = await callApi(env, 'POST', '/api/auth/logout', { body: {} });
  assert.equal(res.status, 200);
});

test('token Google tak sah: 401 login-gagal dan tiada pengguna dicipta', async () => {
  const res = await login({ aud: 'lain' });
  assert.equal(res.status, 401);
  assert.equal(res.json.code, 'login-gagal');
  assert.equal(db.rows('SELECT * FROM users').length, 0);
});

test('badan login rosak ditolak', async () => {
  for (const body of ['{rosak', '[]', '{}', JSON.stringify({ credential: 123 })]) {
    const res = await callApi(env, 'POST', '/api/auth/google', { body });
    assert.equal(res.status, 400, body);
  }
});

test('e-mel sama dengan akaun Google lain: 409, data asal kekal', async () => {
  await login();
  const res = await login({ sub: '999', email: 'peniaga@gmail.com' });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'emel-konflik');
  assert.equal(db.rows('SELECT * FROM users').length, 1);
  assert.equal(db.rows('SELECT * FROM sessions').length, 1, 'batch dirollback, tiada sesi tambahan');
});

test('CSRF: mutasi tanpa Origin atau Origin lain ditolak 403', async () => {
  const credential = await g.sign();
  const none = await callApi(env, 'POST', '/api/auth/google', { body: { credential }, origin: null });
  assert.equal(none.status, 403);
  const evil = await callApi(env, 'POST', '/api/auth/google', { body: { credential }, origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  assert.equal(evil.json.code, 'origin-ditolak');
  assert.equal(db.rows('SELECT * FROM users').length, 0);
});

test('CSRF: mutasi bukan application/json ditolak 415', async () => {
  const credential = await g.sign();
  const res = await callApi(env, 'POST', '/api/auth/google', {
    body: `credential=${credential}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(res.status, 415);
  const plain = await callApi(env, 'POST', '/api/auth/logout', { body: '{}', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(plain.status, 415);
});

test('webhook dikecualikan daripada semakan Origin dan sesi (server ke server)', async () => {
  const res = await callApi(env, 'POST', '/api/webhooks/bcl/kunci', { body: {}, origin: null });
  assert.equal(res.status, 404, 'sampai ke catch-all, bukan 401/403');
});

test('superadmin: isAdmin ikut SUPERADMIN_EMAILS (tak sensitif huruf); peniaga biasa 403 di /api/admin/*', async () => {
  const peniaga = cookieFrom(await login());
  const res = await callApi(env, 'GET', '/api/admin/shops', withCookie(peniaga));
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'bukan-admin');

  const adminLogin = await login({ sub: 'admin-sub', email: 'admin@annurpro.test' });
  assert.equal(adminLogin.json.isAdmin, true);
  const adminRes = await callApi(env, 'GET', '/api/admin/shops', withCookie(cookieFrom(adminLogin)));
  assert.equal(adminRes.status, 200, 'lepas semakan admin');
});

test('laluan /api tak wujud pulangkan JSON 404', async () => {
  const sid = cookieFrom(await login());
  const res = await callApi(env, 'GET', '/api/tiada-langsung', withCookie(sid));
  assert.equal(res.status, 404);
  assert.equal(res.json.code, 'tiada');
});

test('kedai sedia ada dipulangkan dalam /api/me', async () => {
  const me = await login();
  db.sqlite
    .prepare("INSERT INTO shops (id, owner_user_id, slug, name, whatsapp) VALUES ('s1', ?, 'wakanda', 'Kedai Wakanda', '60123456789')")
    .run(me.json.user.id);
  const res = await callApi(env, 'GET', '/api/me', withCookie(cookieFrom(me)));
  assert.deepEqual(res.json.shop, {
    id: 's1', slug: 'wakanda', name: 'Kedai Wakanda', status: 'active', suspendedReason: null,
    isOpen: true, planCode: 'free', planExpiresAt: null, storageBytes: 0, catalogDirty: false,
    planStatus: { state: 'free', daysLeft: null, expiresAt: null, graceEndsAt: null },
    usage: { products: 0, categories: 0, banners: 0 },
    plan: {
      code: 'free', name: 'Percuma', maxProducts: 20, maxCategories: 5, maxBanners: 1,
      maxStorageBytes: 10485760, customTemplate: false, hideBranding: false,
    },
  });
});

test('D1 gagal (contoh had harian): 500 sistem-sibuk tanpa butiran dalaman', async () => {
  const broken = {
    prepare() {
      throw new Error('D1_ERROR: daily limit exceeded');
    },
    batch() {
      throw new Error('D1_ERROR: daily limit exceeded');
    },
  };
  const origError = console.error;
  console.error = () => {};
  try {
    const res = await callApi({ ...env, DB: broken }, 'POST', '/api/auth/google', { body: { credential: await g.sign() } });
    assert.equal(res.status, 500);
    assert.deepEqual(res.json, { ok: false, code: 'sistem-sibuk', message: 'Sistem sibuk, cuba sebentar lagi.' });
    assert.ok(!res.text.includes('D1_ERROR'));
  } finally {
    console.error = origError;
  }
});

test('GOOGLE_CLIENT_ID kosong: login pulang ralat konfigurasi yang jelas', async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const res = await callApi({ ...env, GOOGLE_CLIENT_ID: '' }, 'POST', '/api/auth/google', { body: { credential: await g.sign() } });
    assert.equal(res.status, 500);
    assert.equal(res.json.code, 'konfigurasi');
  } finally {
    console.error = origError;
  }
});
