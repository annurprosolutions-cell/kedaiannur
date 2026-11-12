// Pusingan 3: statistik pelawat tanpa nama dan piksel iklan (Pro). Artikel: tests/artikel.test.js.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser, insertShop } from './helpers/seed.js';
import { cleanEvents, isBot, mytDay } from '../lib/stats.js';
import { normalizePixel } from '../public/assets/js/rules.js';
import { PAGE_CSP, pageHeaders } from '../lib/shoppage.js';

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';
let env;
let a;
let shopA;

const future = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const track = (slug, body, headers = { 'User-Agent': UA }) => callApi(env, 'POST', `/api/track/${slug}`, { headers, body });
const daily = (id = shopA) => env.DB.sqlite.prepare('SELECT views, qr, items, carts, orders FROM stats_daily WHERE shop_id = ? AND day = ?').get(id, mytDay());

beforeEach(async () => {
  env = makeEnv({ MEDIA_BASE_URL: 'https://media.test' });
  a = await makeUser(env, 'a');
  shopA = insertShop(env, a, { slug: 'kedai-a' });
  env.DB.sqlite.prepare("INSERT INTO products (id, shop_id, name, price_sen) VALUES ('pa1', ?, 'Karipap', 500), ('pa2', ?, 'Donat', 300)").run(shopA, shopA);
});

test('cleanEvents: had setiap permintaan, ID produk disahkan; pengesan bot', () => {
  assert.equal(cleanEvents({}), null);
  assert.equal(cleanEvents(null), null);
  const ev = cleanEvents({ view: true, src: 'qr', items: 999, carts: -3, orders: 2.5, products: ['pa1', 'pa1', '../x', 5, 'p'.repeat(80)] });
  assert.deepEqual(ev, { view: 1, qr: 1, items: 30, carts: 0, orders: 0, products: ['pa1'] });
  assert.equal(cleanEvents({ view: false, src: 'qr', orders: 1 }).qr, 0, 'qr hanya dikira bersama lawatan');
  assert.ok(isBot('facebookexternalhit/1.1'));
  assert.ok(isBot('WhatsApp/2.23'));
  assert.ok(isBot('Mozilla/5.0 HeadlessChrome/120'));
  assert.ok(isBot(''));
  assert.ok(!isBot(UA));
});

test('POST /api/track/:slug: kiraan harian ditambah; Origin wajib; bot, slug tiada dan produk kedai lain diabaikan', async () => {
  assert.equal((await track('kedai-a', { view: true, src: 'qr', items: 2, products: ['pa1', 'pa2'] })).status, 200);
  assert.equal((await track('kedai-a', { view: true, carts: 1, orders: 1 })).status, 200);
  assert.deepEqual({ ...daily() }, { views: 2, qr: 1, items: 2, carts: 1, orders: 1 });
  const pv = env.DB.sqlite.prepare('SELECT product_id, views FROM stats_product WHERE shop_id = ? ORDER BY product_id').all(shopA).map((r) => ({ ...r }));
  assert.deepEqual(pv, [{ product_id: 'pa1', views: 1 }, { product_id: 'pa2', views: 1 }]);

  // Tanpa Origin (laman lain atau skrip): ditolak oleh middleware.
  assert.equal((await callApi(env, 'POST', '/api/track/kedai-a', { headers: { 'User-Agent': UA }, body: { view: true }, origin: null })).status, 403);
  await track('kedai-a', { view: true }, { 'User-Agent': 'facebookexternalhit/1.1' });
  assert.equal(daily().views, 2, 'pratonton link WhatsApp/Facebook tak dikira');
  assert.equal((await track('tiada-kedai', { view: true })).status, 200, 'tiada beza respons untuk slug tak wujud');

  const b = await makeUser(env, 'b');
  const shopB = insertShop(env, b, { slug: 'kedai-b' });
  env.DB.sqlite.prepare("INSERT INTO products (id, shop_id, name) VALUES ('pb1', ?, 'Lain')").run(shopB);
  await track('kedai-a', { items: 1, products: ['pb1'] });
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) AS n FROM stats_product WHERE product_id = 'pb1'").get().n, 0, 'ID produk kedai lain tak disimpan');

  env.DB.sqlite.prepare("UPDATE shops SET status = 'suspended' WHERE id = ?").run(shopA);
  await track('kedai-a', { view: true });
  assert.equal(daily().views, 2, 'kedai digantung tak dikira');
});

test('GET /api/stats: Percuma terhad 7 hari tanpa produk teratas; Pro 90 hari dengan produk teratas', async () => {
  await track('kedai-a', { view: true, items: 1, orders: 1, products: ['pa2'] });
  const free = await callApi(env, 'GET', '/api/stats?days=90', { headers: a.headers });
  assert.equal(free.status, 200);
  assert.deepEqual([free.json.isPro, free.json.maxDays, free.json.days, free.json.series.length], [false, 7, 7, 7]);
  assert.deepEqual(free.json.totals, { views: 1, qr: 0, items: 1, carts: 0, orders: 1, orderRatePct: 100 });
  assert.deepEqual(free.json.topProducts, []);
  assert.equal(free.json.series.at(-1).date, mytDay());

  env.DB.sqlite.prepare("UPDATE shops SET plan_code = 'pro', plan_expires_at = ? WHERE id = ?").run(future(30), shopA);
  const pro = await callApi(env, 'GET', '/api/stats?days=90', { headers: a.headers });
  assert.deepEqual([pro.json.isPro, pro.json.maxDays, pro.json.series.length], [true, 90, 90]);
  assert.deepEqual(pro.json.topProducts.map((p) => ({ ...p })), [{ id: 'pa2', name: 'Donat', views: 1 }]);
  assert.equal((await callApi(env, 'GET', '/api/stats?days=13', { headers: a.headers })).json.days, 7, 'nilai pelik jatuh ke 7');
  assert.equal((await callApi(env, 'GET', '/api/stats')).status, 401);
});

test('piksel: ID disahkan; Percuma ditolak 403 (mengosongkan dibenarkan); Pro disimpan, masuk snapshot dan CSP kedai itu sahaja', async () => {
  assert.deepEqual(normalizePixel('metaPixel', ' 1234567890 12345 '), { value: '123456789012345' });
  assert.ok(normalizePixel('metaPixel', '<script>').error);
  assert.deepEqual(normalizePixel('tiktokPixel', 'cabcdef1234567890xyz'), { value: 'CABCDEF1234567890XYZ' });
  assert.deepEqual(normalizePixel('googleTag', 'g-abc123xyz'), { value: 'G-ABC123XYZ' });
  assert.ok(normalizePixel('googleTag', 'UA-12345-1').error, 'Universal Analytics lama tak diterima');

  const body = { metaPixel: '123456789012345', tiktokPixel: 'CABCDEF1234567890XYZ', googleTag: 'G-ABC123XYZ' };
  const denied = await callApi(env, 'PATCH', '/api/shop', { headers: a.headers, body });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, 'perlu-pro');
  assert.equal((await callApi(env, 'PATCH', '/api/shop', { headers: a.headers, body: { metaPixel: '' } })).status, 200);
  const bad = await callApi(env, 'PATCH', '/api/shop', { headers: a.headers, body: { googleTag: 'javascript:alert(1)' } });
  assert.equal(bad.status, 400);

  env.DB.sqlite.prepare("UPDATE shops SET plan_code = 'pro', plan_expires_at = ? WHERE id = ?").run(future(30), shopA);
  const ok = await callApi(env, 'PATCH', '/api/shop', { headers: a.headers, body });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.shop.metaPixel, '123456789012345');
  const snap = JSON.parse(new TextDecoder().decode(env.MEDIA.objects.get('catalog/kedai-a.json').bytes));
  assert.deepEqual(snap.shop.px, { meta: '123456789012345', tiktok: 'CABCDEF1234567890XYZ', google: 'G-ABC123XYZ' });

  const csp = pageHeaders(snap)['Content-Security-Policy'];
  assert.match(csp, /script-src [^;]*https:\/\/connect\.facebook\.net/);
  assert.match(csp, /script-src [^;]*https:\/\/analytics\.tiktok\.com/);
  assert.match(csp, /script-src [^;]*https:\/\/www\.googletagmanager\.com/);
  assert.ok(!/script-src [^;]*unsafe/.test(csp), 'tiada unsafe-inline atau unsafe-eval');
  assert.equal(pageHeaders({ shop: { px: {} } })['Content-Security-Policy'], PAGE_CSP, 'kedai tanpa piksel kekal ketat');
  assert.equal(pageHeaders(null)['Content-Security-Policy'], PAGE_CSP);
  const TEMPLATE = readFileSync(new URL('../public/shop.html', import.meta.url), 'utf8');
  env.ASSETS = { fetch: async (url) => (new URL(url).pathname === '/shop' ? new Response(TEMPLATE) : new Response('tiada', { status: 404 })) };
  const res = await callApi(env, 'GET', '/kedai-a', { origin: null });
  assert.match(res.headers.get('content-security-policy'), /connect\.facebook\.net/);

  // Pro tamat (lepas toleransi): piksel berhenti diterbitkan walaupun ID masih disimpan.
  env.DB.sqlite.prepare("UPDATE shops SET plan_expires_at = '2020-01-01' WHERE id = ?").run(shopA);
  await callApi(env, 'PATCH', '/api/shop', { headers: a.headers, body: { name: 'Kedai A baru' } });
  const after = JSON.parse(new TextDecoder().decode(env.MEDIA.objects.get('catalog/kedai-a.json').bytes));
  assert.deepEqual(after.shop.px, {});
});

test('admin stats: jumlah lawatan 30 hari dan kedai paling dilawati', async () => {
  const admin = await makeUser(env, 'm', { email: 'admin@annurpro.test' });
  await track('kedai-a', { view: true, orders: 1 });
  await track('kedai-a', { view: true });
  const res = await callApi(env, 'GET', '/api/admin/stats', { headers: admin.headers });
  assert.equal(res.json.totals.views30, 2);
  assert.equal(res.json.totals.orders30, 1);
  assert.deepEqual(res.json.topShops.map((s) => [s.slug, s.views, s.orders]), [['kedai-a', 2, 1]]);
});
