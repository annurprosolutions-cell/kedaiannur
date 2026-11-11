// Logo kedai: semua pelan; Pro: logo juga menjadi favicon dan ikon skrin utama halaman kedai.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser, insertShop } from './helpers/seed.js';
import { fakeWebp } from './helpers/r2.js';
import { ORPHAN_GRACE_MS, sweepOrphans } from '../lib/media.js';
import { DEFAULT_ICON, renderShopPage } from '../lib/shoppage.js';

const TEMPLATE = readFileSync(new URL('../public/shop.html', import.meta.url), 'utf8');
let env;
let a;
let b;
let shopA;

beforeEach(async () => {
  env = makeEnv({ MEDIA_BASE_URL: 'https://media.test' });
  a = await makeUser(env, 'a');
  b = await makeUser(env, 'b');
  shopA = insertShop(env, a, { slug: 'kedai-a' });
});

const upl = async (user, size = 3000, kind = 'logo') => {
  const res = await callApi(env, 'POST', `/api/upload?kind=${kind}`, { headers: { ...user.headers, 'Content-Type': 'image/webp' }, body: fakeWebp(size) });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return res.json.key;
};
const put = (user, key) => callApi(env, 'PUT', '/api/shop/logo', { headers: user.headers, body: { key } });
const row = () => ({ ...env.DB.sqlite.prepare('SELECT logo_key, logo_bytes, storage_bytes FROM shops WHERE id = ?').get(shopA) });
const snapshot = () => JSON.parse(new TextDecoder().decode(env.MEDIA.objects.get('catalog/kedai-a.json').bytes));
const makePro = () => env.DB.sqlite.prepare("UPDATE shops SET plan_code = 'pro', plan_expires_at = date('now', '+30 days') WHERE id = ?").run(shopA);

test('muat naik logo: kunci l_<uuid>, had 100 KB', async () => {
  const k = await upl(a);
  assert.match(k, new RegExp(`^shops/${shopA}/l_[0-9a-f-]{36}\\.webp$`));
  const big = await callApi(env, 'POST', '/api/upload?kind=logo', { headers: { ...a.headers, 'Content-Type': 'image/webp' }, body: fakeWebp(101 * 1024) });
  assert.equal(big.status, 413);
});

test('tetapkan, tukar dan buang logo: storage dikira dengan saiz sebenar, objek lama dipadam, snapshot dikemas kini', async () => {
  const k1 = await upl(a, 3000);
  const r1 = await put(a, k1);
  assert.equal(r1.status, 200);
  assert.deepEqual([r1.json.logoKey, r1.json.storageBytes], [k1, 3000]);
  assert.deepEqual(row(), { logo_key: k1, logo_bytes: 3000, storage_bytes: 3000 });
  assert.equal(snapshot().shop.logo, k1);
  assert.equal(snapshot().shop.fav, false, 'Percuma: tiada favicon tersuai');

  const k2 = await upl(a, 5000);
  await put(a, k2);
  assert.deepEqual(row(), { logo_key: k2, logo_bytes: 5000, storage_bytes: 5000 }, 'storage tak berganda bila tukar');
  assert.ok(!env.MEDIA.objects.has(k1), 'logo lama dipadam');

  const me = await callApi(env, 'GET', '/api/me', { headers: a.headers });
  assert.equal(me.json.shop.logoKey, k2);

  const r3 = await put(a, null);
  assert.equal(r3.status, 200);
  assert.deepEqual(row(), { logo_key: null, logo_bytes: 0, storage_bytes: 0 });
  assert.ok(!env.MEDIA.objects.has(k2));
  assert.equal(snapshot().shop.logo, null);
  assert.equal((await put(a, null)).status, 200, 'buang bila tiada logo: tiada perubahan');
});

test('Pro: snapshot fav=true; halaman kedai guna logo sebagai favicon dan apple-touch-icon', async () => {
  makePro();
  const k = await upl(a);
  await put(a, k);
  const snap = snapshot();
  assert.equal(snap.shop.fav, true);
  assert.ok(TEMPLATE.includes(DEFAULT_ICON), 'shop.html mengandungi baris favicon lalai yang tepat');
  const html = renderShopPage(TEMPLATE, { slug: 'kedai-a', origin: 'https://kedai.test', media: 'https://media.test', catalog: snap });
  assert.ok(!html.includes(DEFAULT_ICON), 'favicon lalai diganti');
  assert.ok(html.includes(`<link rel="icon" href="https://media.test/${k}">`));
  assert.ok(html.includes(`<link rel="apple-touch-icon" href="https://media.test/${k}">`));
  assert.ok(html.includes(`<meta property="og:image" content="https://media.test/${k}">`), 'tiada banner: logo jadi gambar pratonton');

  // Percuma: favicon lalai kekal walaupun ada logo.
  const free = { ...snap, shop: { ...snap.shop, fav: false } };
  const freeHtml = renderShopPage(TEMPLATE, { slug: 'kedai-a', origin: 'https://kedai.test', media: 'https://media.test', catalog: free });
  assert.ok(freeHtml.includes(DEFAULT_ICON));
});

test('ditolak: kunci kedai lain, kunci banner, objek tiada, had storage, bentuk badan salah', async () => {
  const shopB = insertShop(env, b, { slug: 'kedai-b' });
  const kb = await upl(b);
  assert.equal((await put(a, kb)).status, 400, 'logo kedai lain (IDOR)');
  assert.equal((await put(a, await upl(a, 2000, 'banner'))).status, 400, 'kunci banner bukan logo');
  assert.equal((await put(a, `shops/${shopA}/l_00000000-0000-4000-8000-000000000000.webp`)).status, 400, 'belum dimuat naik');
  assert.equal((await put(a, 123)).status, 400);
  assert.equal((await callApi(env, 'PUT', '/api/shop/logo', { headers: a.headers, body: {} })).status, 400);
  const k = await upl(a, 3000); // muat naik dahulu, kemudian storage hampir penuh sebelum dipautkan
  env.DB.sqlite.prepare('UPDATE shops SET storage_bytes = 10485000 WHERE id = ?').run(shopA);
  assert.equal((await put(a, k)).status, 409, 'had storage pelan Percuma');
  assert.equal(env.DB.sqlite.prepare('SELECT logo_key FROM shops WHERE id = ?').get(shopB).logo_key, null);
  assert.equal((await callApi(env, 'PUT', '/api/shop/logo', { body: { key: null } })).status, 401);
});

test('pembersihan objek yatim tak memadam logo yang sedang digunakan', async () => {
  const k = await upl(a);
  await put(a, k);
  const orphan = await upl(a);
  env.MEDIA.age(k, ORPHAN_GRACE_MS + 60000);
  env.MEDIA.age(orphan, ORPHAN_GRACE_MS + 60000);
  assert.equal(await sweepOrphans(env, shopA), 1);
  assert.ok(env.MEDIA.objects.has(k), 'logo dikekalkan');
  assert.ok(!env.MEDIA.objects.has(orphan));
});

test('eksport data mengandungi URL logo', async () => {
  const k = await upl(a);
  await put(a, k);
  const res = await callApi(env, 'GET', '/api/account/export', { headers: a.headers });
  assert.equal(JSON.parse(res.text).kedai.logo, `https://media.test/${k}`);
});
