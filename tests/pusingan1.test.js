// Pusingan 1: maklumat hubungan kedai, senarai semak, statistik admin dan peringatan tamat.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser, insertShop } from './helpers/seed.js';
import { isMapsUrl, normalizeHours, normalizeMapsUrl, normalizeSocial, socialUrl } from '../public/assets/js/rules.js';
import { niceTicks } from '../public/assets/js/chart.js';

let env;
let a;
let admin;
let shopA;

beforeEach(async () => {
  env = makeEnv();
  a = await makeUser(env, 'a');
  admin = await makeUser(env, 'm', { email: 'admin@annurpro.test' });
  shopA = insertShop(env, a, { slug: 'kedai-a' });
});

const snapshot = (slug = 'kedai-a') => JSON.parse(new TextDecoder().decode(env.MEDIA.objects.get(`catalog/${slug}.json`).bytes));

test('Google Maps: pautan Kongsi dan google.com/maps diterima, laman lain ditolak', () => {
  for (const ok of [
    'https://maps.app.goo.gl/AbCdEf123',
    'maps.app.goo.gl/AbCdEf123',
    'https://www.google.com/maps/place/Kedai+Ujian/@3.1,101.6,17z',
    'https://www.google.com.my/maps/place/Kedai',
    'https://maps.google.com/?q=3.1,101.6',
    'https://goo.gl/maps/xyz',
    'http://maps.app.goo.gl/x',
  ]) {
    const r = normalizeMapsUrl(ok);
    assert.ok(r.value && r.value.startsWith('https://'), ok);
    assert.ok(isMapsUrl(r.value));
  }
  for (const bad of ['https://evil.test/maps', 'https://google.com.evil.test/maps', 'https://www.google.com/search?q=x', 'javascript:alert(1)', 'https://goo.gl/abc', 123]) {
    assert.ok(normalizeMapsUrl(bad).error, String(bad));
  }
  assert.deepEqual(normalizeMapsUrl(''), { value: '' });
  assert.ok(normalizeMapsUrl(`https://maps.app.goo.gl/${'x'.repeat(400)}`).error, 'terlalu panjang');
});

test('media sosial: @nama, nama, pautan profil; pautan yang dibina', () => {
  assert.deepEqual(normalizeSocial('instagram', '@kuih.mak_teh'), { value: 'kuih.mak_teh' });
  assert.deepEqual(normalizeSocial('instagram', 'https://www.instagram.com/kuihmakteh/?hl=en'), { value: 'kuihmakteh' });
  assert.deepEqual(normalizeSocial('tiktok', 'https://www.tiktok.com/@kuihmakteh?lang=ms'), { value: 'kuihmakteh' });
  assert.deepEqual(normalizeSocial('facebook', 'facebook.com/kuihmakteh'), { value: 'kuihmakteh' });
  assert.deepEqual(normalizeSocial('facebook', 'https://m.facebook.com/profile.php?id=100012345'), { value: '100012345' });
  assert.deepEqual(normalizeSocial('tiktok', ''), { value: '' });
  assert.ok(normalizeSocial('instagram', 'https://evil.test/kuih').error, 'domain lain');
  assert.ok(normalizeSocial('instagram', 'nama ada ruang').error);
  assert.ok(normalizeSocial('tiktok', '@a').error, 'TikTok minimum 2 aksara');
  assert.ok(normalizeSocial('facebook', '<script>').error);
  assert.equal(socialUrl('instagram', 'kuih.mak_teh'), 'https://www.instagram.com/kuih.mak_teh/');
  assert.equal(socialUrl('tiktok', 'kuih'), 'https://www.tiktok.com/@kuih');
  assert.equal(socialUrl('facebook', '100012345'), 'https://www.facebook.com/profile.php?id=100012345');
  assert.equal(socialUrl('facebook', 'kuih'), 'https://www.facebook.com/kuih');
  assert.deepEqual(normalizeHours('  Isnin - Jumaat\r\n9 pagi - 6 petang  '), { value: 'Isnin - Jumaat\n9 pagi - 6 petang' });
  assert.ok(normalizeHours('x'.repeat(201)).error);
});

test('PATCH /api/shop: maklumat hubungan dinormalkan, diterbitkan dalam snapshot dan dikira dalam senarai semak', async () => {
  const res = await callApi(env, 'PATCH', '/api/shop', {
    headers: a.headers,
    body: { openingHours: 'Setiap hari\n8 pagi - 10 malam', mapsUrl: 'maps.app.goo.gl/Abc', instagram: '@kuihmakteh', tiktok: 'https://www.tiktok.com/@kuih_mt', facebook: '' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const s = res.json.shop;
  assert.deepEqual([s.openingHours, s.mapsUrl, s.instagram, s.tiktok, s.facebook], ['Setiap hari\n8 pagi - 10 malam', 'https://maps.app.goo.gl/Abc', 'kuihmakteh', 'kuih_mt', '']);
  assert.deepEqual(snapshot().shop.info, { hours: 'Setiap hari\n8 pagi - 10 malam', maps: 'https://maps.app.goo.gl/Abc', ig: 'kuihmakteh', tt: 'kuih_mt' });
  const me = await callApi(env, 'GET', '/api/me', { headers: a.headers });
  assert.equal(me.json.shop.hasContact, true);
  assert.equal(me.json.shop.hasDescription, false);

  const bad = await callApi(env, 'PATCH', '/api/shop', { headers: a.headers, body: { mapsUrl: 'https://evil.test/maps', instagram: 'a b' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.fields.mapsUrl && bad.json.fields.instagram);

  // Kosongkan semua: tiada maklumat diterbitkan.
  await callApi(env, 'PATCH', '/api/shop', { headers: a.headers, body: { openingHours: '', mapsUrl: '', instagram: '', tiktok: '' } });
  assert.deepEqual(snapshot().shop.info, {});
  const exp = await callApi(env, 'GET', '/api/account/export', { headers: a.headers });
  assert.equal(JSON.parse(exp.text).kedai.google_maps, '');
});

test('GET /api/admin/stats: 30 hari waktu Malaysia, hasil, kadar Pro, senarai hampir tamat; hanya superadmin', async () => {
  const b = await makeUser(env, 'b');
  const shopB = insertShop(env, b, { slug: 'kedai-b', plan: 'pro', expires: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) });
  env.DB.sqlite.prepare("INSERT INTO payments (id, order_no, shop_id, amount_sen, period, quantity, months_added, status) VALUES ('p1', 'O1', ?, 20000, 'yearly', 1, 12, 'applied'), ('p2', 'O2', NULL, 2000, 'monthly', 1, 1, 'unmatched')").run(shopB);

  assert.equal((await callApi(env, 'GET', '/api/admin/stats', { headers: a.headers })).status, 403);
  const res = await callApi(env, 'GET', '/api/admin/stats', { headers: admin.headers });
  assert.equal(res.status, 200);
  const d = res.json;
  assert.equal(d.days.length, 30);
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  assert.equal(d.days.at(-1).date, today, 'hari terakhir = hari ini waktu Malaysia');
  assert.equal(d.days.at(-1).shops, 2);
  assert.equal(d.days.at(-1).revenueSen, 20000, 'hanya bayaran applied');
  assert.deepEqual([d.totals.shops, d.totals.paid, d.totals.conversionPct, d.totals.revenueAllSen, d.totals.paymentsAll], [2, 1, 50, 20000, 1]);
  assert.equal(d.ending.length, 1);
  assert.deepEqual([d.ending[0].slug, d.ending[0].state, d.ending[0].remindedAt], ['kedai-b', 'ending', null]);
  assert.equal(d.ending[0].whatsapp, '60123456789');

  // Peringatan direkod dalam audit_log dan dipaparkan.
  assert.equal((await callApi(env, 'POST', `/api/admin/shops/${shopB}/remind`, { headers: a.headers, body: {} })).status, 403);
  assert.equal((await callApi(env, 'POST', '/api/admin/shops/tiada/remind', { headers: admin.headers, body: {} })).status, 404);
  assert.equal((await callApi(env, 'POST', `/api/admin/shops/${shopB}/remind`, { headers: admin.headers, body: {} })).status, 200);
  const again = await callApi(env, 'GET', '/api/admin/stats', { headers: admin.headers });
  assert.ok(again.json.ending[0].remindedAt);
});

test('niceTicks: paksi bersih', () => {
  assert.deepEqual(niceTicks(0), [0, 0.5, 1]);
  assert.deepEqual(niceTicks(0, { integer: true }), [0, 1]);
  assert.deepEqual(niceTicks(2, { integer: true }), [0, 1, 2]);
  assert.deepEqual(niceTicks(3), [0, 1, 2, 3]);
  assert.deepEqual(niceTicks(7), [0, 2, 4, 6, 8]);
  assert.deepEqual(niceTicks(20000), [0, 5000, 10000, 15000, 20000]);
});
