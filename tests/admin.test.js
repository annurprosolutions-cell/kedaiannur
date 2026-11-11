import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser, insertShop, SHOP_BODY } from './helpers/seed.js';

let env;
let admin;
let a;
let b;

beforeEach(async () => {
  env = makeEnv({ SUPERADMIN_EMAILS: 'boss@annurpro.test' });
  admin = await makeUser(env, 'boss', { email: 'boss@annurpro.test' });
  a = await makeUser(env, 'a', { email: 'kuih@ujian.test' });
  b = await makeUser(env, 'b', { email: 'kopi@ujian.test' });
});

const req = (user, method, path, body) => callApi(env, method, path, { headers: { ...user.headers, 'Content-Type': 'application/json' }, body });
const adm = (method, path, body) => req(admin, method, path, body);
const shopRow = (id) => env.DB.rows('SELECT * FROM shops WHERE id = ?', id)[0];
const auditRows = () => env.DB.rows('SELECT * FROM audit_log ORDER BY id');

test('IPD "Peniaga cuba jadi admin": semua /api/admin/* 403 untuk peniaga, 401 tanpa sesi', async () => {
  const shopA = insertShop(env, a, { slug: 'kedai-a' });
  const calls = [
    ['GET', '/api/admin/shops'], ['GET', `/api/admin/shops/${shopA}`], ['PATCH', `/api/admin/shops/${shopA}`, { action: 'add_months', months: 12 }],
    ['GET', '/api/admin/payments'], ['PATCH', '/api/admin/payments/x', { shopId: shopA }], ['POST', '/api/admin/rebuild-catalogs', {}],
    ['GET', '/api/admin/reserved-slugs'], ['POST', '/api/admin/reserved-slugs', { slug: 'x' }], ['DELETE', '/api/admin/reserved-slugs/admin'],
  ];
  for (const [m, p, body] of calls) {
    assert.equal((await req(a, m, p, body)).status, 403, `${m} ${p}`);
    assert.equal((await callApi(env, m, p, { body: body ?? (m === 'GET' ? undefined : {}) })).status, 401, `${m} ${p} tanpa sesi`);
  }
  assert.equal(shopRow(shopA).plan_code, 'free', 'tiada perubahan');
  assert.equal(env.DB.rows("SELECT count(*) n FROM reserved_slugs WHERE slug = 'x'")[0].n, 0);
});

test('S-16: senarai, ringkasan kiraan, carian slug/nama/e-mel, tapisan dan paginasi', async () => {
  insertShop(env, a, { slug: 'kuih-mak', plan: 'pro', expires: '2099-01-01' });
  insertShop(env, b, { slug: 'kopi-o', status: 'suspended' });
  for (let i = 0; i < 30; i++) {
    const u = await makeUser(env, `x${i}`);
    insertShop(env, u, { slug: `kedai-${String(i).padStart(2, '0')}` });
  }
  await makeUser(env, 'tanpa-kedai');
  const res = await adm('GET', '/api/admin/shops');
  assert.equal(res.status, 200);
  assert.equal(res.json.total, 32);
  assert.equal(res.json.shops.length, 25);
  assert.deepEqual(res.json.summary, {
    shops: 32, paid: 1, grace: 0, ending: 0, free: 31, suspended: 1, newLast7Days: 32, users: 34, usersWithoutShop: 2,
  });
  assert.equal((await adm('GET', '/api/admin/shops?page=2')).json.shops.length, 7);

  assert.deepEqual((await adm('GET', '/api/admin/shops?q=KOPI')).json.shops.map((s) => s.slug), ['kopi-o'], 'slug, tak sensitif huruf');
  assert.deepEqual((await adm('GET', '/api/admin/shops?q=kuih%40ujian')).json.shops.map((s) => s.slug), ['kuih-mak'], 'e-mel pemilik');
  assert.equal((await adm('GET', '/api/admin/shops?q=Kedai%20Ujian')).json.total, 32, 'nama');
  assert.equal((await adm('GET', '/api/admin/shops?q=%25')).json.total, 0, '% dilarikan, bukan wildcard');
  assert.deepEqual((await adm('GET', '/api/admin/shops?plan=pro')).json.shops.map((s) => s.slug), ['kuih-mak']);
  assert.deepEqual((await adm('GET', '/api/admin/shops?status=suspended')).json.shops.map((s) => s.slug), ['kopi-o']);
  const pro = (await adm('GET', '/api/admin/shops?plan=pro')).json.shops[0];
  assert.equal(pro.ownerEmail, 'kuih@ujian.test');
  assert.equal(pro.effectivePlan, 'pro');
  assert.equal(pro.planStatus.state, 'active');
});

test('ringkasan: toleransi dan hampir tamat dikira betul', async () => {
  const s1 = insertShop(env, a, { slug: 'grace-a', plan: 'pro' });
  const s2 = insertShop(env, b, { slug: 'ending-b', plan: 'pro' });
  env.DB.sqlite.prepare("UPDATE shops SET plan_expires_at = date('now', '-3 days') WHERE id = ?").run(s1);
  env.DB.sqlite.prepare("UPDATE shops SET plan_expires_at = date('now', '+5 days') WHERE id = ?").run(s2);
  const s = (await adm('GET', '/api/admin/shops')).json.summary;
  assert.deepEqual([s.paid, s.grace, s.ending, s.free], [1, 1, 1, 0]);
});

test('S-17 butiran: pemilik, penggunaan, bayaran, audit', async () => {
  const id = insertShop(env, a, { slug: 'kedai-a' });
  await req(a, 'POST', '/api/products', { name: 'Teh' });
  const res = await adm('GET', `/api/admin/shops/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.shop.ownerEmail, 'kuih@ujian.test');
  assert.equal(res.json.shop.products, 1);
  assert.deepEqual(res.json.payments, []);
  assert.equal((await adm('GET', '/api/admin/shops/tiada')).status, 404);
});

test('set_plan Pro dengan tarikh: pelan efektif berubah, snapshot ikut, audit direkod', async () => {
  const id = insertShop(env, a, { slug: 'kedai-a' });
  const res = await adm('PATCH', `/api/admin/shops/${id}`, { action: 'set_plan', planCode: 'pro', expiresAt: '2099-01-31' });
  assert.equal(res.status, 200);
  assert.equal(res.json.shop.effectivePlan, 'pro');
  const row = shopRow(id);
  assert.deepEqual([row.plan_code, row.plan_expires_at, row.plan_anchor_day], ['pro', '2099-01-31', 31]);
  assert.equal(env.MEDIA.json('catalog/kedai-a.json').shop.branding, false, 'snapshot dibina semula dengan pelan baharu');
  const log = auditRows().at(-1);
  assert.equal(log.action, 'set_plan');
  assert.equal(log.actor_email, 'boss@annurpro.test');
  assert.deepEqual(JSON.parse(log.meta).after, { planCode: 'pro', planExpiresAt: '2099-01-31' });

  assert.equal((await adm('PATCH', `/api/admin/shops/${id}`, { action: 'set_plan', planCode: 'free' })).status, 200);
  assert.deepEqual([shopRow(id).plan_code, shopRow(id).plan_expires_at], ['free', null]);
});

test('set_plan validasi: pelan tak wujud, tarikh tak sah atau tiada', async () => {
  const id = insertShop(env, a, { slug: 'kedai-a' });
  for (const body of [
    { action: 'set_plan', planCode: 'gold', expiresAt: '2099-01-01' },
    { action: 'set_plan', planCode: 'pro' },
    { action: 'set_plan', planCode: 'pro', expiresAt: '2026-02-30' },
    { action: 'set_plan', planCode: 'pro', expiresAt: '31/12/2026' },
    { action: 'hapus-semua' },
    {},
  ]) {
    assert.equal((await adm('PATCH', `/api/admin/shops/${id}`, body)).status, 400, JSON.stringify(body));
  }
  assert.equal(shopRow(id).plan_code, 'free');
  assert.equal(auditRows().length, 0);
});

test('add_months: Percuma menjadi Pro dari hari ini; aktif ditambah dari tarikh tamat', async () => {
  const id = insertShop(env, a, { slug: 'kedai-a' });
  const today = new Date().toISOString().slice(0, 10);
  const r1 = await adm('PATCH', `/api/admin/shops/${id}`, { action: 'add_months', months: 1 });
  assert.equal(r1.status, 200);
  const first = shopRow(id).plan_expires_at;
  assert.equal(shopRow(id).plan_code, 'pro');
  assert.ok(first > today);
  await adm('PATCH', `/api/admin/shops/${id}`, { action: 'add_months', months: 12 });
  const second = shopRow(id).plan_expires_at;
  assert.equal(Number(second.slice(0, 4)) - Number(first.slice(0, 4)), 1, 'tambah 12 bulan dari tarikh tamat sebelum ini');
  for (const months of [0, 121, 1.5, '3', null]) {
    assert.equal((await adm('PATCH', `/api/admin/shops/${id}`, { action: 'add_months', months })).status, 400, String(months));
  }
});

test('gantung: sebab wajib, snapshot dipadam, halaman awam 404, peniaga tak boleh tulis; buka gantung memulihkan', async () => {
  const id = insertShop(env, a, { slug: 'kedai-a' });
  await req(a, 'POST', '/api/products', { name: 'Teh' });
  assert.ok(env.MEDIA.json('catalog/kedai-a.json'));
  assert.equal((await adm('PATCH', `/api/admin/shops/${id}`, { action: 'suspend', reason: '' })).status, 400);
  const res = await adm('PATCH', `/api/admin/shops/${id}`, { action: 'suspend', reason: 'Meniru jenama bank' });
  assert.equal(res.status, 200);
  assert.equal(res.json.shop.status, 'suspended');
  assert.equal(res.json.shop.suspendedReason, 'Meniru jenama bank');
  assert.equal(env.MEDIA.json('catalog/kedai-a.json'), null);
  assert.equal((await req(a, 'POST', '/api/products', { name: 'Kopi' })).status, 403);
  const me = await req(a, 'GET', '/api/me');
  assert.equal(me.json.shop.status, 'suspended', 'peniaga masih boleh login dan nampak notis');
  assert.equal(me.json.shop.suspendedReason, 'Meniru jenama bank');

  await adm('PATCH', `/api/admin/shops/${id}`, { action: 'unsuspend' });
  assert.equal(shopRow(id).status, 'active');
  assert.equal(shopRow(id).suspended_reason, null);
  assert.equal(env.MEDIA.json('catalog/kedai-a.json').items.length, 1, 'snapshot dipulihkan');
  assert.deepEqual(auditRows().map((r) => r.action), ['suspend', 'unsuspend']);
});

test('S-18 padankan bayaran unmatched: Pro ditambah ikut tempoh x kuantiti, sekali sahaja', async () => {
  const id = insertShop(env, a, { slug: 'kedai-a' });
  env.DB.sqlite.exec(`INSERT INTO payments (id, order_no, payer_email, amount_sen, period, quantity, status)
    VALUES ('pay1', 'BCL-1', 'salah@ejaan.test', 58000, 'yearly', 2, 'unmatched'),
           ('pay2', 'BCL-2', 'x@y.test', 2900, NULL, 1, 'unmatched'),
           ('pay3', 'BCL-3', 'kuih@ujian.test', 2900, 'monthly', 1, 'applied')`);
  const list = await adm('GET', '/api/admin/payments?status=unmatched');
  assert.deepEqual(list.json.payments.map((p) => p.orderNo).sort(), ['BCL-1', 'BCL-2']);

  const res = await adm('PATCH', '/api/admin/payments/pay1', { shopId: id });
  assert.equal(res.status, 200);
  assert.equal(res.json.payment.status, 'applied');
  assert.equal(res.json.payment.shopSlug, 'kedai-a');
  assert.equal(res.json.payment.monthsAdded, 24);
  const exp = shopRow(id).plan_expires_at;
  assert.equal(Number(exp.slice(0, 4)) - new Date().getUTCFullYear(), 2);
  assert.equal(shopRow(id).plan_code, 'pro');

  assert.equal((await adm('PATCH', '/api/admin/payments/pay1', { shopId: id })).status, 409, 'tak boleh dipadankan dua kali');
  assert.equal(shopRow(id).plan_expires_at, exp, 'tiada masa ditambah dua kali');
  assert.equal((await adm('PATCH', '/api/admin/payments/pay3', { shopId: id })).status, 409);
  assert.equal((await adm('PATCH', '/api/admin/payments/pay2', { shopId: id })).status, 400, 'tempoh tak diketahui: mesti nyatakan bulan');
  assert.equal((await adm('PATCH', '/api/admin/payments/pay2', { shopId: id, months: 1 })).status, 200);
  assert.equal((await adm('PATCH', '/api/admin/payments/tiada', { shopId: id })).status, 404);
  assert.ok(auditRows().some((r) => r.action === 'match_payment'));
});

test('membuka S-18 membersihkan audit_log lebih 12 bulan', async () => {
  env.DB.sqlite.exec(`INSERT INTO audit_log (actor_email, action, created_at) VALUES
    ('x', 'lama', datetime('now', '-13 months')), ('x', 'baru', datetime('now', '-11 months'))`);
  await adm('GET', '/api/admin/payments');
  assert.deepEqual(auditRows().map((r) => r.action), ['baru']);
});

test('slug reserved: tambah menyekat pendaftaran baharu; kedai sedia ada diberi amaran tapi tak terjejas; buang membenarkan semula', async () => {
  insertShop(env, a, { slug: 'maybank-kuih' });
  const add = await adm('POST', '/api/admin/reserved-slugs', { slug: 'CIMB' });
  assert.equal(add.status, 200);
  assert.equal(add.json.added, true);
  const c = await makeUser(env, 'c');
  assert.equal((await req(c, 'POST', '/api/shop', { ...SHOP_BODY, slug: 'cimb' })).status, 409);
  const warn = await adm('POST', '/api/admin/reserved-slugs', { slug: 'maybank-kuih' });
  assert.match(warn.json.warning, /sedang digunakan/);
  assert.equal(shopRow(env.DB.rows("SELECT id FROM shops WHERE slug='maybank-kuih'")[0].id).status, 'active');
  assert.ok((await adm('GET', '/api/admin/reserved-slugs')).json.slugs.includes('cimb'));
  assert.equal((await adm('DELETE', '/api/admin/reserved-slugs/cimb')).json.removed, true);
  assert.equal((await req(c, 'POST', '/api/shop', { ...SHOP_BODY, slug: 'cimb' })).status, 201);
  assert.equal((await adm('POST', '/api/admin/reserved-slugs', { slug: 'ada ruang' })).status, 400);
});

test('bina semula snapshot dalam kumpulan 8, dan hanya yang dirty', async () => {
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const u = await makeUser(env, `r${i}`);
    ids.push(insertShop(env, u, { slug: `kedai-r${i}` }));
  }
  const first = await adm('POST', '/api/admin/rebuild-catalogs', {});
  assert.equal(first.json.processed, 8);
  assert.ok(first.json.next);
  const second = await adm('POST', '/api/admin/rebuild-catalogs', { after: first.json.next });
  assert.equal(second.json.processed, 2);
  assert.equal(second.json.next, null);
  for (let i = 0; i < 10; i++) assert.ok(env.MEDIA.json(`catalog/kedai-r${i}.json`), `kedai-r${i}`);

  env.DB.sqlite.prepare('UPDATE shops SET catalog_dirty = 1 WHERE id = ?').run(ids[3]);
  await env.MEDIA.delete('catalog/kedai-r3.json');
  const dirty = await adm('POST', '/api/admin/rebuild-catalogs', { onlyDirty: true });
  assert.equal(dirty.json.processed, 1);
  assert.ok(env.MEDIA.json('catalog/kedai-r3.json'));
  assert.equal(shopRow(ids[3]).catalog_dirty, 0);
  assert.equal(auditRows().filter((r) => r.action === 'rebuild_catalogs').length, 2, 'satu rekod setiap larian, bukan setiap kumpulan');
});
