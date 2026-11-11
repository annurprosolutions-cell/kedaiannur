import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser, SHOP_BODY } from './helpers/seed.js';
import { fakeWebp } from './helpers/r2.js';
import { isReservedLocally } from '../public/assets/js/rules.js';

let env;
let a;

beforeEach(async () => {
  env = makeEnv({ MEDIA_BASE_URL: 'https://media.test' });
  a = await makeUser(env, 'a', { email: 'peniaga@ujian.test' });
});

const req = (user, method, path, body) => callApi(env, method, path, { headers: { ...user.headers, 'Content-Type': 'application/json' }, body });
const upload = async (user, kind) =>
  (await callApi(env, 'POST', `/api/upload?kind=${kind}`, { headers: { ...user.headers, 'Content-Type': 'image/webp' }, body: fakeWebp(2000) })).json.key;

async function fullShop(user, slug = 'wakanda') {
  await req(user, 'POST', '/api/shop', { ...SHOP_BODY, slug });
  const cat = (await req(user, 'POST', '/api/categories', { name: 'Kuih' })).json.category;
  const imageKey = await upload(user, 'product');
  const thumbKey = await upload(user, 'thumb');
  await req(user, 'POST', '/api/products', { name: 'Karipap', priceSen: 100, categoryId: cat.id, imageKey, thumbKey });
  const banner = await upload(user, 'banner');
  await req(user, 'PUT', '/api/shop/banners', { keys: [banner] });
  await upload(user, 'product'); // objek yatim
  return env.DB.rows('SELECT id FROM shops WHERE slug = ?', slug)[0].id;
}

test('IPD "Padam kedai": baris D1 dan semua objek R2 hilang; slug boleh digunakan semula; bayaran kekal tanpa kedai', async () => {
  const id = await fullShop(a);
  env.DB.sqlite.prepare("INSERT INTO payments (id, order_no, shop_id, amount_sen, status) VALUES ('p1', 'BCL-1', ?, 2900, 'applied')").run(id);
  assert.ok(env.MEDIA.keys().filter((k) => k.startsWith(`shops/${id}/`)).length >= 4);
  assert.ok(env.MEDIA.objects.has('catalog/wakanda.json'));

  const res = await req(a, 'DELETE', '/api/shop', { confirmSlug: 'WAKANDA' });
  assert.equal(res.status, 200);
  assert.equal(res.json.removedObjects, 4);
  assert.deepEqual(env.MEDIA.keys(), [], 'tiada fail tinggal di storage');
  for (const t of ['shops', 'products', 'categories', 'shop_banners']) {
    assert.equal(env.DB.rows(`SELECT count(*) n FROM ${t}`)[0].n, 0, t);
  }
  const pay = env.DB.rows('SELECT shop_id, order_no FROM payments')[0];
  assert.deepEqual(pay, { shop_id: null, order_no: 'BCL-1' }, 'rekod bayaran kekal untuk perakaunan');
  const log = env.DB.rows("SELECT * FROM audit_log WHERE action = 'delete_shop'")[0];
  assert.equal(log.actor_email, 'peniaga@ujian.test');

  assert.equal((await req(a, 'GET', '/api/me')).json.shop, null, 'akaun kekal, kembali ke setup');
  const b = await makeUser(env, 'b');
  assert.equal((await req(b, 'POST', '/api/shop', SHOP_BODY)).status, 201, 'slug boleh digunakan semula');
  assert.equal(env.MEDIA.json('catalog/wakanda.json').shop.name, 'Kedai Wakanda', 'snapshot kini milik kedai baharu B');
});

test('padam kedai perlukan pengesahan slug yang tepat', async () => {
  await fullShop(a);
  for (const body of [{}, { confirmSlug: '' }, { confirmSlug: 'lain' }]) {
    assert.equal((await req(a, 'DELETE', '/api/shop', body)).status, 400, JSON.stringify(body));
  }
  assert.equal(env.DB.rows('SELECT count(*) n FROM shops')[0].n, 1);
});

test('padam kedai: tanpa sesi 401, tanpa Origin 403, kedai orang lain tak terjejas, tiada kedai 404', async () => {
  await fullShop(a);
  const b = await makeUser(env, 'b');
  const idB = await fullShop(b, 'kedai-b');
  assert.equal((await callApi(env, 'DELETE', '/api/shop', { body: { confirmSlug: 'wakanda' } })).status, 401);
  assert.equal((await callApi(env, 'DELETE', '/api/shop', { headers: a.headers, body: { confirmSlug: 'wakanda' }, origin: 'https://evil.test' })).status, 403);
  assert.equal((await req(b, 'DELETE', '/api/shop', { confirmSlug: 'wakanda' })).status, 400, 'B tak boleh padam A walaupun tahu slug A');
  await req(a, 'DELETE', '/api/shop', { confirmSlug: 'wakanda' });
  assert.ok(env.MEDIA.keys().some((k) => k.startsWith(`shops/${idB}/`)), 'gambar B kekal');
  assert.ok(env.MEDIA.objects.has('catalog/kedai-b.json'));
  assert.equal((await req(a, 'DELETE', '/api/shop', { confirmSlug: 'wakanda' })).status, 404);
});

test('kedai digantung masih boleh dipadam oleh pemilik (hak PDPA)', async () => {
  await fullShop(a);
  env.DB.sqlite.exec("UPDATE shops SET status = 'suspended'");
  assert.equal((await req(a, 'DELETE', '/api/shop', { confirmSlug: 'wakanda' })).status, 200);
});

test('padam lebih 1,000 objek melalui berbilang halaman', async () => {
  const id = await fullShop(a);
  for (let i = 0; i < 1500; i++) await env.MEDIA.put(`shops/${id}/x-${String(i).padStart(4, '0')}.webp`, fakeWebp(20));
  const res = await req(a, 'DELETE', '/api/shop', { confirmSlug: 'wakanda' });
  assert.equal(res.json.removedObjects, 1504);
  assert.equal(env.MEDIA.keys().length, 0);
});

test('IPD F-15 eksport JSON: akaun, kedai, kategori, produk, banner, bayaran; tiada data sesi', async () => {
  const id = await fullShop(a);
  env.DB.sqlite.prepare("INSERT INTO payments (id, order_no, shop_id, amount_sen, period, status) VALUES ('p1', 'BCL-9', ?, 2900, 'monthly', 'applied')").run(id);
  const res = await callApi(env, 'GET', '/api/account/export', { headers: a.headers });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="kedai-wakanda-\d{4}-\d{2}-\d{2}\.json"/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const d = res.json;
  assert.equal(d.akaun.email, 'peniaga@ujian.test');
  assert.equal(d.kedai.slug, 'wakanda');
  assert.equal(d.kedai.whatsapp, '60123456789');
  assert.equal(d.kedai.kategori[0].nama, 'Kuih');
  assert.equal(d.kedai.produk[0].nama, 'Karipap');
  assert.equal(d.kedai.produk[0].harga_sen, 100);
  assert.match(d.kedai.produk[0].gambar, /^https:\/\/media\.test\/shops\//);
  assert.equal(d.kedai.banner.length, 1);
  assert.equal(d.kedai.bayaran[0].order_no, 'BCL-9');
  for (const secret of ['token_hash', 'google_sub', 'owner_user_id', 'sessions']) assert.ok(!res.text.includes(secret), secret);
  assert.equal(env.MEDIA.keys().filter((k) => k.includes('eksport') || k.includes('export')).length, 0, 'tak disimpan dalam bucket');
});

test('eksport tanpa kedai: akaun sahaja; tanpa sesi 401', async () => {
  const res = await callApi(env, 'GET', '/api/account/export', { headers: a.headers });
  assert.equal(res.json.kedai, null);
  assert.equal(res.json.akaun.email, 'peniaga@ujian.test');
  assert.equal((await callApi(env, 'GET', '/api/account/export')).status, 401);
});

test('GET /api/plans awam: harga dan had dari jadual plans', async () => {
  const res = await callApi(env, 'GET', '/api/plans');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
  assert.deepEqual(res.json.plans.map((p) => [p.code, p.maxProducts, p.priceMonthSen, p.priceYearSen]), [['free', 20, 0, 0], ['pro', 500, 2900, 29000]]);
});

test('slug "terma" disekat kerana bertembung dengan halaman terma', async () => {
  assert.ok(isReservedLocally('terma'));
  assert.ok(isReservedLocally('offline'));
  assert.equal((await req(a, 'POST', '/api/shop', { ...SHOP_BODY, slug: 'terma' })).status, 409);
});
