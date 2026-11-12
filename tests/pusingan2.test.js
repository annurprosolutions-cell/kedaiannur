// Pusingan 2: Marketplace (kelayakan, susunan, indeks R2, API awam, kawalan admin), sitemap dan JSON-LD.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser, insertShop } from './helpers/seed.js';
import { MARKET_KEY, MARKET_TTL_MS, getMarketIndex, marketEligibility } from '../lib/market.js';
import { normalizeCategory, SHOP_CATEGORIES } from '../public/assets/js/rules.js';

let env;
let admin;

const future = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

beforeEach(async () => {
  env = makeEnv({ MEDIA_BASE_URL: 'https://media.test' });
  admin = await makeUser(env, 'm', { email: 'admin@annurpro.test' });
});

// Kedai lengkap: jenis kedai, logo, dan n produk yang ada stok.
async function shop(n, { plan = 'free', category = 'makanan', opt = null, products = 3, logo = true, available = 1 } = {}) {
  const u = await makeUser(env, n);
  const id = insertShop(env, u, { slug: `kedai-${n}`, plan, expires: plan === 'pro' ? future(30) : null });
  env.DB.sqlite.prepare('UPDATE shops SET category = ?, market_opt = ?, logo_key = ?, name = ? WHERE id = ?').run(category, opt, logo ? `shops/${id}/l_x.webp` : null, `Kedai ${n}`, id);
  for (let i = 0; i < products; i++) {
    env.DB.sqlite.prepare('INSERT INTO products (id, shop_id, name, price_sen, is_available) VALUES (?, ?, ?, 100, ?)').run(`${id}-p${i}`, id, `Produk ${i}`, available);
  }
  return { u, id };
}

const market = async () => (await callApi(env, 'GET', '/api/market', { origin: null })).json;

test('jenis kedai: 14 kod tetap, input disahkan', () => {
  assert.equal(SHOP_CATEGORIES.length, 14);
  assert.equal(new Set(SHOP_CATEGORIES.map((c) => c.code)).size, 14);
  assert.deepEqual(normalizeCategory('kuih'), { value: 'kuih' });
  assert.deepEqual(normalizeCategory(''), { value: '' });
  assert.ok(normalizeCategory('palsu').error);
});

test('kelayakan: Pro automatik, Percuma perlu pilih masuk, syarat kelengkapan untuk semua', () => {
  const base = { category: 'makanan', logo_key: 'x', status: 'active', market_hidden: 0, market_opt: null };
  assert.equal(marketEligibility(base, { isPro: true, products: 3, hasBanner: false }).listed, true);
  assert.equal(marketEligibility(base, { isPro: false, products: 3, hasBanner: false }).listed, false, 'Percuma lalai: tidak');
  assert.equal(marketEligibility({ ...base, market_opt: 1 }, { isPro: false, products: 3, hasBanner: false }).listed, true);
  assert.equal(marketEligibility({ ...base, market_opt: 0 }, { isPro: true, products: 3, hasBanner: false }).listed, false, 'Pro pilih keluar');
  const e = marketEligibility({ ...base, category: '', logo_key: null }, { isPro: true, products: 1, hasBanner: false });
  assert.equal(e.listed, false);
  assert.equal(e.issues.length, 3, e.issues.join(' | '));
  assert.ok(marketEligibility({ ...base, logo_key: null }, { isPro: true, products: 3, hasBanner: true }).listed, 'banner pun cukup');
});

test('GET /api/market (awam): hanya kedai layak, susunan Pilihan Admin > Pro > Percuma, tiada data peribadi', async () => {
  await shop('percuma-masuk', { opt: 1 });
  await shop('percuma-lalai'); // tak pilih masuk
  const pro = await shop('pro', { plan: 'pro' });
  await shop('pro-keluar', { plan: 'pro', opt: 0 });
  await shop('pro-tiada-jenis', { plan: 'pro', category: '' });
  await shop('pro-sikit', { plan: 'pro', products: 2 });
  await shop('pro-habis', { plan: 'pro', available: 0 });
  const feat = await shop('pilihan', { opt: 1 });
  env.DB.sqlite.prepare('UPDATE shops SET market_featured = 1 WHERE id = ?').run(feat.id);
  const susp = await shop('gantung', { plan: 'pro' });
  env.DB.sqlite.prepare("UPDATE shops SET status = 'suspended' WHERE id = ?").run(susp.id);

  const res = await callApi(env, 'GET', '/api/market', { origin: null });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /public/);
  assert.deepEqual(res.json.shops.map((s) => s.s), ['kedai-pilihan', 'kedai-pro', 'kedai-percuma-masuk']);
  const p = res.json.shops.find((s) => s.s === 'kedai-pro');
  assert.deepEqual(Object.keys(p).sort(), ['b', 'c', 'cn', 'd', 'f', 'i', 'l', 'n', 'o', 'p', 'u', 's'].sort());
  assert.equal(p.cn, 'Makanan dan minuman');
  assert.equal(p.l, `shops/${pro.id}/l_x.webp`);
  assert.ok(env.MEDIA.objects.has(MARKET_KEY), 'indeks disimpan dalam R2');
  assert.ok(!JSON.stringify(res.json).includes('@'), 'tiada e-mel');
});

test('indeks lama dihidang dan dibina semula di latar; peniaga PATCH jenis/pilihan membina semula serta-merta', async () => {
  const s1 = await shop('a', { opt: 1 });
  assert.equal((await market()).shops.length, 1);
  await shop('b', { opt: 1 });
  // Indeks masih segar: kedai baharu belum muncul.
  assert.equal((await market()).shops.length, 1);
  // Paksa indeks menjadi lama: lawatan seterusnya menghidang yang lama dan membina semula di latar.
  const stale = JSON.parse(new TextDecoder().decode(env.MEDIA.objects.get(MARKET_KEY).bytes));
  stale.updated = new Date(Date.now() - MARKET_TTL_MS - 1000).toISOString();
  await env.MEDIA.put(MARKET_KEY, JSON.stringify(stale));
  const jobs = [];
  const served = await getMarketIndex(env, (p) => jobs.push(p));
  assert.equal(served.shops.length, 1);
  await Promise.all(jobs);
  assert.equal((await market()).shops.length, 2);

  // Peniaga pilih keluar: hilang serta-merta.
  const res = await callApi(env, 'PATCH', '/api/shop', { headers: s1.u.headers, body: { marketOpt: false } });
  assert.equal(res.status, 200);
  assert.equal(res.json.shop.marketOpt, false);
  assert.equal(res.json.shop.market.listed, false);
  assert.deepEqual((await market()).shops.map((s) => s.s), ['kedai-b']);
  // Kembali ke lalai (null).
  const back = await callApi(env, 'PATCH', '/api/shop', { headers: s1.u.headers, body: { marketOpt: null, category: 'kuih' } });
  assert.equal(back.json.shop.marketOpt, null);
  assert.equal(back.json.shop.category, 'kuih');
  assert.equal((await callApi(env, 'PATCH', '/api/shop', { headers: s1.u.headers, body: { category: 'palsu' } })).status, 400);
});

test('GET /api/shop: status Marketplace dengan senarai perkara yang belum lengkap', async () => {
  const s = await shop('x', { plan: 'pro', category: '', products: 1, logo: false });
  const res = await callApi(env, 'GET', '/api/shop', { headers: s.u.headers });
  const m = res.json.shop.market;
  assert.deepEqual([m.listed, m.wants, m.defaultOn], [false, true, true]);
  assert.equal(m.issues.length, 3);
});

test('admin: sembunyi dan Pilihan Admin direkod dan terus mengubah indeks', async () => {
  const s = await shop('y', { plan: 'pro' });
  const a = await shop('z', { plan: 'pro' });
  const act = (id, action) => callApi(env, 'PATCH', `/api/admin/shops/${id}`, { headers: admin.headers, body: { action } });
  assert.equal((await callApi(env, 'PATCH', `/api/admin/shops/${s.id}`, { headers: a.u.headers, body: { action: 'market_hide' } })).status, 403);
  const hid = await act(s.id, 'market_hide');
  assert.equal(hid.status, 200);
  assert.equal(hid.json.shop.market.listed, false);
  assert.deepEqual((await market()).shops.map((x) => x.s), ['kedai-z']);
  await act(s.id, 'market_show');
  await act(s.id, 'market_feature');
  assert.deepEqual((await market()).shops.map((x) => x.s), ['kedai-y', 'kedai-z']);
  assert.equal((await market()).shops[0].f, true);
  const audit = env.DB.sqlite.prepare("SELECT action FROM audit_log WHERE action LIKE 'market_%' ORDER BY id").all().map((r) => r.action);
  assert.deepEqual(audit, ['market_hide', 'market_show', 'market_feature']);
  assert.equal(a.id.length > 0, true);
});

test('sitemap.xml: halaman awam dan kedai Marketplace sahaja, XML sah; robots.txt menunjuk ke sitemap', async () => {
  await shop('listed', { plan: 'pro' });
  await shop('tidak', {});
  const res = await callApi(env, 'GET', '/sitemap.xml', { origin: null });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/xml/);
  assert.ok(res.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(res.text.includes('<loc>https://kedai.test/kedai-listed</loc>'));
  assert.ok(!res.text.includes('kedai-tidak'), 'kedai tak tersenarai tak diiklankan');
  for (const p of ['/', '/marketplace', '/privasi', '/terma']) assert.ok(res.text.includes(`<loc>https://kedai.test${p}</loc>`), p);
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8'), /Sitemap: https:\/\/kedai\.annurpro\.com\/sitemap\.xml/);
});

test('kedai menjadi layak selepas tambah produk: indeks diselaraskan serta-merta (tanpa tunggu luput)', async () => {
  const s = await shop('baru', { plan: 'pro', products: 2 });
  await shop('lain', { plan: 'pro' });
  assert.deepEqual((await market()).shops.map((x) => x.s), ['kedai-lain'], 'indeks dibina; kedai-baru belum layak');
  const res = await callApi(env, 'POST', '/api/products', { headers: s.u.headers, body: { name: 'Produk ketiga', priceSen: 500 } });
  assert.equal(res.status, 201);
  assert.ok((await market()).shops.some((x) => x.s === 'kedai-baru'), 'muncul selepas produk ketiga');
  // Buang semua produk: hilang serta-merta.
  for (const id of ['p0', 'p1']) {
    assert.equal((await callApi(env, 'DELETE', `/api/products/${s.id}-${id}`, { headers: s.u.headers, body: {} })).status, 200);
  }
  assert.ok(!(await market()).shops.some((x) => x.s === 'kedai-baru'));
});
