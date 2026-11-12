import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser, SHOP_BODY } from './helpers/seed.js';
import { PAGE_CSP, renderShopPage, safeJson } from '../lib/shoppage.js';

const TEMPLATE = readFileSync(new URL('../public/shop.html', import.meta.url), 'utf8');
let env;
let a;

beforeEach(async () => {
  env = makeEnv({ MEDIA_BASE_URL: 'https://media.test/', SUPPORT_EMAIL: 'sokongan@annurpro.test' });
  env.ASSETS = { fetch: async (url) => (new URL(url).pathname === '/shop' ? new Response(TEMPLATE) : new Response('tiada', { status: 404 })) };
  a = await makeUser(env, 'a');
});

const api = (method, path, body) => callApi(env, method, path, { headers: { ...a.headers, 'Content-Type': 'application/json' }, body });
const page = (path) => callApi(env, 'GET', path);
function pageData(html) {
  const m = /<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(m[1]);
}

test('CSP halaman kedai sama dengan public/_headers', () => {
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  assert.equal(/Content-Security-Policy: (.+)/.exec(headers)[1].trim(), PAGE_CSP);
});

test('/<slug> menghidang halaman kedai dengan data katalog, meta OG dan header keselamatan', async () => {
  await api('POST', '/api/shop', { ...SHOP_BODY, description: 'Kuih tradisional\nsedap' });
  await api('POST', '/api/products', { name: 'Teh Ais', priceSen: 350 });
  const res = await page('/wakanda');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('content-security-policy'), PAGE_CSP);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');

  assert.match(res.text, /<title>Kedai Wakanda \| Kedai AnnurPro<\/title>/);
  assert.match(res.text, /<meta property="og:title" content="Kedai Wakanda">/);
  assert.match(res.text, /<meta property="og:description" content="Kuih tradisional sedap">/);
  assert.match(res.text, /<meta property="og:url" content="https:\/\/kedai\.test\/wakanda">/);
  assert.match(res.text, /<meta property="og:image" content="https:\/\/kedai\.test\/assets\/og-default\.png">/, 'tiada banner: gambar lalai');
  const data = pageData(res.text);
  assert.equal(data.slug, 'wakanda');
  assert.equal(data.media, 'https://media.test');
  assert.equal(data.catalog.items[0].n, 'Teh Ais');
  assert.equal(data.report, 'mailto:sokongan@annurpro.test?subject=Lapor%20kedai%20wakanda');
  assert.ok(!res.text.includes('<!--HEAD-->'));
});

test('banner pertama menjadi og:image dan dimuat awal (LCP)', async () => {
  await api('POST', '/api/shop', SHOP_BODY);
  const { fakeWebp } = await import('./helpers/r2.js');
  const up = await callApi(env, 'POST', '/api/upload?kind=banner', { headers: { ...a.headers, 'Content-Type': 'image/webp' }, body: fakeWebp() });
  await api('PUT', '/api/shop/banners', { keys: [up.json.key] });
  const res = await page('/wakanda');
  assert.ok(res.text.includes(`<meta property="og:image" content="https://media.test/${up.json.key}">`));
  assert.ok(res.text.includes(`<link rel="preload" as="image" href="https://media.test/${up.json.key}" fetchpriority="high">`));
});

test('IPD "XSS": nama kedai dengan </script> dan HTML tak boleh keluar dari tag; teks di-escape dalam meta', async () => {
  const evil = '</script><img src=x onerror=alert(1)>"\'&';
  await api('POST', '/api/shop', { ...SHOP_BODY, name: evil.slice(0, 60) });
  await api('POST', '/api/products', { name: '</script><script>alert(2)</script>' });
  const res = await page('/wakanda');
  const scriptBlocks = res.text.match(/<\/script>/g).length;
  const template = TEMPLATE.match(/<\/script>/g).length;
  assert.equal(scriptBlocks, template + 1, 'tiada </script> tambahan disuntik (selain blok JSON-LD)');
  const ld = JSON.parse(/<script type="application\/ld\+json">([^<]*)<\/script>/.exec(res.text)[1]);
  assert.equal(ld['@type'], 'Store');
  assert.equal(ld.name, evil.slice(0, 60), 'JSON-LD selamat: nama asal dipulihkan, tiada tag dibuka');
  assert.ok(!res.text.includes('<img src=x'), 'tiada tag HTML mentah');
  assert.ok(res.text.includes('&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;'));
  const data = pageData(res.text);
  assert.equal(data.catalog.shop.name, evil.slice(0, 60), 'data asal dipulihkan selepas JSON.parse');
  assert.equal(data.catalog.items[0].n, '</script><script>alert(2)</script>');
});

test('safeJson melarikan < dan pemisah baris unicode', () => {
  assert.equal(safeJson({ a: '</script>\u2028' }), '{"a":"\\u003c/script>\\u2028"}');
});

test('pelan Pro tanpa branding: tajuk tanpa nama platform', () => {
  const html = renderShopPage(TEMPLATE, {
    slug: 'x', origin: 'https://k.test', media: 'https://m.test', report: '',
    catalog: { v: 1, shop: { name: 'Kedai X', slug: 'x', desc: '', theme: '#0F766E', branding: false }, banners: [], cats: [], items: [] },
  });
  assert.match(html, /<title>Kedai X<\/title>/);
  assert.match(html, /og:description" content="Pilih produk dan hantar order terus ke WhatsApp kedai\."/);
});

test('kedai tak wujud: 404 dengan halaman S-06, noindex, tiada cache', async () => {
  const res = await page('/tiada-kedai');
  assert.equal(res.status, 404);
  assert.match(res.text, /noindex/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  const data = pageData(res.text);
  assert.equal(data.missing, true);
  assert.equal(data.catalog, null);
});

test('kedai digantung: tiada snapshot, jadi 404 (S-06)', async () => {
  await api('POST', '/api/shop', SHOP_BODY);
  assert.equal((await page('/wakanda')).status, 200);
  env.DB.sqlite.exec("UPDATE shops SET status = 'suspended'");
  const { publishSnapshot } = await import('../lib/catalog.js');
  await publishSnapshot(env, env.DB.rows('SELECT id FROM shops')[0].id);
  assert.equal((await page('/wakanda')).status, 404);
});

test('URL kanonik: huruf besar dan garis miring hujung dialih ke huruf kecil (301)', async () => {
  const res = await callApi(env, 'GET', '/WaKanDa?x=1');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://kedai.test/wakanda?x=1');
});

test('slug tak sah diserahkan kepada fail statik (next)', async () => {
  for (const p of ['/ab', '/a--', '/index', '/404', '/-x-']) {
    const res = await page(p);
    assert.equal(res.text, 'STATIC-404', p);
  }
});

test('snapshot rosak: 503 tanpa butiran dalaman', async () => {
  await env.MEDIA.put('catalog/rosak.json', '{bukan json');
  const origError = console.error;
  console.error = () => {};
  try {
    const res = await page('/rosak');
    assert.equal(res.status, 503);
    assert.equal(pageData(res.text).missing, true);
  } finally {
    console.error = origError;
  }
});

test('HEAD untuk perangkak pratonton', async () => {
  await api('POST', '/api/shop', SHOP_BODY);
  const res = await callApi(env, 'HEAD', '/wakanda');
  assert.equal(res.status, 200);
  assert.equal(res.text, '');
});

test('halaman kedai tak membaca D1 (had D1 tak menjatuhkan kedai)', async () => {
  await api('POST', '/api/shop', SHOP_BODY);
  const before = env.DB.queries.length;
  await page('/wakanda');
  assert.equal(env.DB.queries.length, before);
  const res = await callApi({ ...env, DB: { prepare() { throw new Error('D1 tumbang'); } } }, 'GET', '/wakanda');
  assert.equal(res.status, 200);
});

test('SUPPORT_EMAIL kosong atau tak sah: tiada link lapor', async () => {
  const { reportLink } = await import('../lib/shoppage.js');
  assert.equal(reportLink({}, 'x'), '');
  assert.equal(reportLink({ SUPPORT_EMAIL: 'bukan emel' }, 'x'), '');
  assert.equal(reportLink({ SUPPORT_EMAIL: 'a"b@c.d' }, 'x'), '');
});
