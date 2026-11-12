import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser, insertShop, SHOP_BODY } from './helpers/seed.js';
import { fakeWebp } from './helpers/r2.js';
import { publishSnapshot } from '../lib/catalog.js';
import { ORPHAN_GRACE_MS, sweepOrphans } from '../lib/media.js';

let env;
let a;

beforeEach(async () => {
  env = makeEnv();
  a = await makeUser(env, 'a');
});

const req = (method, path, body) => callApi(env, method, path, { headers: { ...a.headers, 'Content-Type': 'application/json' }, body });
const snap = (slug = 'wakanda') => env.MEDIA.json(`catalog/${slug}.json`);
const upload = async (kind, size = 1000) =>
  (await callApi(env, 'POST', `/api/upload?kind=${kind}`, { headers: { ...a.headers, 'Content-Type': 'image/webp' }, body: fakeWebp(size) })).json.key;

test('IPD 3.4: cipta kedai menerbitkan catalog/<slug>.json dengan format BSD seksyen 5', async () => {
  const res = await req('POST', '/api/shop', { ...SHOP_BODY, description: 'Kuih sedap', askAddress: true });
  assert.equal(res.status, 201);
  const s = snap();
  assert.equal(s.v, 1);
  assert.ok(Date.parse(s.updated));
  assert.deepEqual(s.shop, {
    name: 'Kedai Wakanda', slug: 'wakanda', desc: 'Kuih sedap', wa: '60123456789', theme: '#0F766E',
    open: true, askName: true, askAddr: true, tpl: null, branding: true, logo: null, fav: false, info: {},
  });
  assert.deepEqual(s.banners, []);
  assert.deepEqual(s.cats, []);
  assert.deepEqual(s.items, []);
  const stored = env.MEDIA.objects.get('catalog/wakanda.json');
  assert.equal(stored.httpMetadata.cacheControl, 'public, max-age=60');
  assert.match(stored.httpMetadata.contentType, /application\/json/);
});

test('snapshot tak mengandungi e-mel, id pemilik atau data pelan', async () => {
  await req('POST', '/api/shop', SHOP_BODY);
  const text = JSON.stringify(snap());
  assert.ok(!text.includes(a.email));
  assert.ok(!text.includes(a.id));
  for (const k of ['plan_code', 'plan_expires_at', 'storage_bytes', 'owner', 'email']) assert.ok(!text.includes(k), k);
});

test('setiap tulisan mengemas kini snapshot: produk, kategori, banner, tetapan', async () => {
  await req('POST', '/api/shop', SHOP_BODY);
  const cat = (await req('POST', '/api/categories', { name: 'Minuman' })).json.category;
  const imageKey = await upload('product');
  const thumbKey = await upload('thumb');
  const p = (await req('POST', '/api/products', { name: 'Teh Ais', priceSen: 350, categoryId: cat.id, imageKey, thumbKey, description: 'Sejuk' })).json.product;
  const banner = await upload('banner');
  await req('PUT', '/api/shop/banners', { keys: [banner] });
  await req('PATCH', '/api/shop', { isOpen: false, themeColor: '#C2410C' });

  const s = snap();
  assert.deepEqual(s.cats, [{ id: cat.id, n: 'Minuman' }]);
  assert.deepEqual(s.items, [{ id: p.id, c: cat.id, n: 'Teh Ais', d: 'Sejuk', p: 350, t: thumbKey, i: imageKey, a: true }]);
  assert.deepEqual(s.banners, [{ k: banner }]);
  assert.equal(s.shop.open, false);
  assert.equal(s.shop.theme, '#C2410C');

  await req('PATCH', `/api/products/${p.id}`, { isAvailable: false });
  assert.equal(snap().items[0].a, false, 'habis stok dipaparkan, tidak disembunyikan');
  await req('DELETE', `/api/products/${p.id}`);
  assert.deepEqual(snap().items, []);
});

test('tukar slug: snapshot slug lama dipadam, slug baharu diterbitkan', async () => {
  await req('POST', '/api/shop', SHOP_BODY);
  assert.ok(snap('wakanda'));
  assert.equal((await req('PATCH', '/api/shop', { slug: 'wakanda-baru' })).status, 200);
  assert.equal(snap('wakanda'), null);
  assert.equal(snap('wakanda-baru').shop.slug, 'wakanda-baru');
});

test('IPD "Turun pelan": Pro tamat melepasi toleransi, katalog awam 20 produk pertama sahaja dan tiada data dipadam', async () => {
  const shopId = insertShop(env, a, { slug: 'wakanda', plan: 'pro', expires: '2099-01-01' });
  for (let i = 1; i <= 25; i++) assert.equal((await req('POST', '/api/products', { name: `Produk ${i}` })).status, 201);
  for (let i = 1; i <= 7; i++) await req('POST', '/api/categories', { name: `Kat ${i}` });
  const banners = [];
  for (let i = 0; i < 3; i++) banners.push(await upload('banner'));
  await req('PUT', '/api/shop/banners', { keys: banners });
  assert.equal(snap().items.length, 25);

  env.DB.sqlite.prepare("UPDATE shops SET plan_expires_at = date('now', '-8 days') WHERE id = ?").run(shopId);
  assert.ok(await publishSnapshot(env, shopId));
  const s = snap();
  assert.equal(s.items.length, 20);
  assert.equal(s.items[0].n, 'Produk 1');
  assert.equal(s.items[19].n, 'Produk 20');
  assert.equal(s.cats.length, 5);
  assert.equal(s.banners.length, 1);
  assert.equal(s.shop.branding, true);
  assert.equal(env.DB.rows('SELECT count(*) n FROM products')[0].n, 25, 'data tak dipadam');

  env.DB.sqlite.prepare("UPDATE shops SET plan_expires_at = date('now', '-6 days') WHERE id = ?").run(shopId);
  await publishSnapshot(env, shopId);
  assert.equal(snap().items.length, 25, 'masih dalam toleransi 7 hari');
  assert.equal(snap().shop.branding, false, 'Pro boleh buang branding');
});

test('produk dalam kategori di luar had pelan masih dipaparkan tanpa kategori', async () => {
  const shopId = insertShop(env, a, { slug: 'wakanda', plan: 'pro', expires: '2099-01-01' });
  const ids = [];
  for (let i = 1; i <= 6; i++) ids.push((await req('POST', '/api/categories', { name: `K${i}` })).json.category.id);
  await req('POST', '/api/products', { name: 'Dalam K6', categoryId: ids[5] });
  env.DB.sqlite.prepare("UPDATE shops SET plan_code = 'free' WHERE id = ?").run(shopId);
  await publishSnapshot(env, shopId);
  assert.equal(snap().items[0].c, null);
});

test('template mesej hanya diterbitkan jika pelan membenarkan', async () => {
  const shopId = insertShop(env, a, { slug: 'wakanda' });
  env.DB.sqlite.prepare("UPDATE shops SET message_template = 'Hai {kedai}' WHERE id = ?").run(shopId);
  await publishSnapshot(env, shopId);
  assert.equal(snap().shop.tpl, null);
  env.DB.sqlite.prepare("UPDATE shops SET plan_code = 'pro', plan_expires_at = '2099-01-01' WHERE id = ?").run(shopId);
  await publishSnapshot(env, shopId);
  assert.equal(snap().shop.tpl, 'Hai {kedai}');
});

test('kedai digantung: snapshot dipadam (halaman awam S-06)', async () => {
  const shopId = insertShop(env, a, { slug: 'wakanda' });
  await publishSnapshot(env, shopId);
  assert.ok(snap());
  env.DB.sqlite.prepare("UPDATE shops SET status = 'suspended' WHERE id = ?").run(shopId);
  await publishSnapshot(env, shopId);
  assert.equal(snap(), null);
});

test('R2 gagal: perubahan tetap disimpan, catalog_dirty = 1, API pulang 500 katalog-gagal; berjaya kemudian reset ke 0', async () => {
  await req('POST', '/api/shop', SHOP_BODY);
  const origError = console.error;
  console.error = () => {};
  env.MEDIA.failPuts = true;
  try {
    const res = await req('POST', '/api/products', { name: 'Teh' });
    assert.equal(res.status, 500);
    assert.equal(res.json.code, 'katalog-gagal');
    assert.match(res.json.message, /disimpan/);
  } finally {
    env.MEDIA.failPuts = false;
    console.error = origError;
  }
  assert.equal(env.DB.rows('SELECT count(*) n FROM products')[0].n, 1, 'produk tersimpan');
  assert.equal(env.DB.rows('SELECT catalog_dirty FROM shops')[0].catalog_dirty, 1);
  const me = await callApi(env, 'GET', '/api/me', { headers: a.headers });
  assert.equal(me.json.shop.catalogDirty, true);

  assert.equal((await req('POST', '/api/products', { name: 'Kopi' })).status, 201);
  assert.equal(env.DB.rows('SELECT catalog_dirty FROM shops')[0].catalog_dirty, 0);
  assert.equal(snap().items.length, 2, 'snapshot pulih dengan semua produk');
});

test('cipta kedai berjaya walaupun snapshot gagal (wizard tak perlu diulang)', async () => {
  const origError = console.error;
  console.error = () => {};
  env.MEDIA.failPuts = true;
  try {
    assert.equal((await req('POST', '/api/shop', SHOP_BODY)).status, 201);
  } finally {
    env.MEDIA.failPuts = false;
    console.error = origError;
  }
  assert.equal(env.DB.rows('SELECT catalog_dirty FROM shops')[0].catalog_dirty, 1);
});

// ---------------------------------------------------------------- objek yatim

test('pembersihan objek yatim: hanya objek lama yang tak dirujuk dipadam', async () => {
  const shopId = insertShop(env, a, { slug: 'wakanda' });
  const usedImg = await upload('product');
  const usedThumb = await upload('thumb');
  await req('POST', '/api/products', { name: 'Ada gambar', imageKey: usedImg, thumbKey: usedThumb });
  const banner = await upload('banner');
  await req('PUT', '/api/shop/banners', { keys: [banner] });
  const oldOrphan = await upload('product');
  const freshOrphan = await upload('thumb');
  for (const k of [usedImg, usedThumb, banner, oldOrphan]) env.MEDIA.age(k, ORPHAN_GRACE_MS + 60000);

  const removed = await sweepOrphans(env, shopId);
  assert.equal(removed, 1);
  assert.ok(!env.MEDIA.objects.has(oldOrphan), 'yatim lama dipadam');
  assert.ok(env.MEDIA.objects.has(freshOrphan), 'muat naik baru (borang mungkin masih dibuka) dikekalkan');
  for (const k of [usedImg, usedThumb, banner]) assert.ok(env.MEDIA.objects.has(k), `${k} dirujuk, dikekalkan`);
  assert.ok(env.MEDIA.objects.has('catalog/wakanda.json'), 'snapshot di luar awalan shops/');
});

test('pembersihan berjalan selepas muat naik dan tak menyentuh kedai lain', async () => {
  const shopId = insertShop(env, a, { slug: 'wakanda' });
  const b = await makeUser(env, 'b');
  const shopB = insertShop(env, b, { slug: 'kedai-b' });
  const orphanA = await upload('product');
  await env.MEDIA.put(`shops/${shopB}/00000000-0000-4000-8000-000000000001.webp`, fakeWebp());
  env.MEDIA.age(orphanA, ORPHAN_GRACE_MS + 1000);
  env.MEDIA.age(`shops/${shopB}/00000000-0000-4000-8000-000000000001.webp`, ORPHAN_GRACE_MS + 1000);

  await upload('thumb'); // mencetuskan sweep melalui waitUntil
  assert.ok(!env.MEDIA.objects.has(orphanA));
  assert.ok(env.MEDIA.objects.has(`shops/${shopB}/00000000-0000-4000-8000-000000000001.webp`), 'kedai B tak disentuh');
  assert.ok(shopId);
});

test('pembersihan melalui berbilang halaman senarai R2 (lebih 1,000 objek)', async () => {
  const shopId = insertShop(env, a, { slug: 'wakanda' });
  for (let i = 0; i < 1100; i++) {
    const k = `shops/${shopId}/${String(i).padStart(8, '0')}-0000-4000-8000-000000000000.webp`;
    await env.MEDIA.put(k, fakeWebp(20));
    env.MEDIA.age(k, ORPHAN_GRACE_MS + 1000);
  }
  assert.equal(await sweepOrphans(env, shopId), 1100);
});
