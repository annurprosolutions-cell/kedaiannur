import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser, insertShop, SHOP_BODY } from './helpers/seed.js';

let env;
let a;
let b;

beforeEach(async () => {
  env = makeEnv();
  a = await makeUser(env, 'a');
  b = await makeUser(env, 'b');
});

const create = (user, body = SHOP_BODY) => callApi(env, 'POST', '/api/shop', { headers: user.headers, body });
const patch = (user, body) => callApi(env, 'PATCH', '/api/shop', { headers: user.headers, body });
const slugCheck = (user, slug) => callApi(env, 'GET', `/api/slug-check?slug=${encodeURIComponent(slug)}`, { headers: user.headers });

// ---------------------------------------------------------------- cipta kedai

test('cipta kedai: 201, nilai lalai, WhatsApp dinormalkan ke 60...', async () => {
  const res = await create(a);
  assert.equal(res.status, 201);
  assert.equal(res.json.shop.slug, 'wakanda');
  assert.equal(res.json.shop.whatsapp, '60123456789');
  assert.equal(res.json.shop.themeColor, '#0F766E');
  assert.equal(res.json.shop.isOpen, true);
  assert.equal(res.json.shop.askName, true);
  assert.equal(res.json.shop.askAddress, false);
  assert.equal(res.json.shop.planCode, 'free');
  assert.equal(res.json.shop.plan.maxBanners, 1);
  assert.equal(res.json.shop.slugChangesLeft, 3);
  assert.deepEqual(res.json.banners, []);

  const row = env.DB.rows('SELECT * FROM shops')[0];
  assert.equal(row.owner_user_id, a.id);
  assert.equal(row.whatsapp, '60123456789');
  assert.equal(row.storage_bytes, 0);
});

test('cipta kedai dengan semua medan pilihan', async () => {
  const res = await create(a, { ...SHOP_BODY, description: 'Kuih tradisional', themeColor: '#be123c', askName: false, askAddress: true, isOpen: false });
  assert.equal(res.status, 201);
  assert.equal(res.json.shop.themeColor, '#BE123C', 'dinormalkan ke huruf besar');
  assert.equal(res.json.shop.askName, false);
  assert.equal(res.json.shop.askAddress, true);
  assert.equal(res.json.shop.isOpen, false);
  assert.equal(res.json.shop.description, 'Kuih tradisional');
});

test('slug huruf besar disimpan sebagai huruf kecil', async () => {
  const res = await create(a, { ...SHOP_BODY, slug: 'WaKaNdA' });
  assert.equal(res.json.shop.slug, 'wakanda');
});

test('IPD ujian slug: format salah, reserved (admin, ADMIN), index, 404 ditolak dan tiada kedai dicipta', async () => {
  const bad = ['ab', 'a--', '-abc', 'abc-', 'ab_c', 'ab c', 'x'.repeat(31), 'admin', 'ADMIN', 'api', 'app', 'index', '404'];
  for (const slug of bad) {
    const res = await create(a, { ...SHOP_BODY, slug });
    assert.ok([400, 409].includes(res.status), `${slug} -> ${res.status}`);
    assert.ok(res.json.fields.slug, slug);
  }
  assert.equal(env.DB.rows('SELECT * FROM shops').length, 0);
});

test('slug reserved ditolak 409 dengan mesej jelas', async () => {
  const res = await create(a, { ...SHOP_BODY, slug: 'admin' });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'slug-diambil');
  assert.equal(res.json.message, 'Nama ini tak boleh digunakan, cuba yang lain.');
});

test('slug reserved tambahan oleh superadmin (jadual reserved_slugs) juga dihormati', async () => {
  env.DB.sqlite.exec("INSERT INTO reserved_slugs (slug) VALUES ('maybank')");
  const res = await create(a, { ...SHOP_BODY, slug: 'MayBank' });
  assert.equal(res.status, 409);
});

test('slug sudah diambil (tak sensitif huruf) ditolak 409; data peniaga pertama kekal', async () => {
  assert.equal((await create(a)).status, 201);
  const res = await create(b, { ...SHOP_BODY, slug: 'WAKANDA', name: 'Penyamar' });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'slug-diambil');
  assert.equal(env.DB.rows('SELECT name FROM shops').length, 1);
  assert.equal(env.DB.rows('SELECT name FROM shops')[0].name, 'Kedai Wakanda');
});

test('perlumbaan: dua permintaan serentak untuk slug sama, hanya satu berjaya', async () => {
  const results = await Promise.all([create(a), create(b, { ...SHOP_BODY, name: 'Kedai B' })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(env.DB.rows('SELECT * FROM shops').length, 1);
});

test('satu akaun satu kedai: cipta kali kedua 409 ada-kedai', async () => {
  await create(a);
  const res = await create(a, { ...SHOP_BODY, slug: 'lain' });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'ada-kedai');
  assert.equal(env.DB.rows('SELECT * FROM shops').length, 1);
});

test('validasi medan: nama, WhatsApp, penerangan, warna, boolean', async () => {
  const cases = [
    [{ name: 'A' }, 'name'],
    [{ name: 'x'.repeat(61) }, 'name'],
    [{ name: '   ' }, 'name'],
    [{ whatsapp: '123' }, 'whatsapp'],
    [{ whatsapp: 'abc' }, 'whatsapp'],
    [{ description: 'x'.repeat(301) }, 'description'],
    [{ description: 123 }, 'description'],
    [{ themeColor: '#123456' }, 'themeColor'],
    [{ themeColor: 'red' }, 'themeColor'],
    [{ askName: 'ya' }, 'askName'],
    [{ isOpen: 1 }, 'isOpen'],
  ];
  for (const [override, field] of cases) {
    const res = await create(a, { ...SHOP_BODY, ...override });
    assert.equal(res.status, 400, JSON.stringify(override));
    assert.equal(res.json.code, 'tidak-sah');
    assert.ok(res.json.fields[field], `${field} patut ada ralat`);
  }
  assert.equal(env.DB.rows('SELECT * FROM shops').length, 0);
});

test('medan wajib tiada: ralat setiap medan', async () => {
  const res = await create(a, {});
  assert.equal(res.status, 400);
  assert.deepEqual(Object.keys(res.json.fields).sort(), ['name', 'slug', 'whatsapp']);
});

test('IPD ujian "Ubah medan terlarang": plan_code, status, storage_bytes dan lain-lain diabaikan semasa cipta', async () => {
  const res = await create(a, {
    ...SHOP_BODY, plan_code: 'pro', planCode: 'pro', plan_expires_at: '2099-01-01', status: 'suspended',
    storage_bytes: 1, storageBytes: 1, slug_changes: -99, owner_user_id: b.id, ownerUserId: b.id, id: 'dipalsukan', catalog_dirty: 1,
  });
  assert.equal(res.status, 201);
  const row = env.DB.rows('SELECT * FROM shops')[0];
  assert.equal(row.plan_code, 'free');
  assert.equal(row.plan_expires_at, null);
  assert.equal(row.status, 'active');
  assert.equal(row.storage_bytes, 0);
  assert.equal(row.slug_changes, 0);
  assert.equal(row.owner_user_id, a.id);
  assert.notEqual(row.id, 'dipalsukan');
  assert.equal(row.catalog_dirty, 0);
});

test('nama dengan HTML disimpan sebagai teks mentah (di-escape ketika dipaparkan); aksara kawalan dibuang', async () => {
  const res = await create(a, { ...SHOP_BODY, name: '<img src=x onerror=alert(1)>\u0000 Kedai' });
  assert.equal(res.status, 201);
  assert.equal(res.json.shop.name, '<img src=x onerror=alert(1)> Kedai');
});

test('badan rosak 400; tanpa sesi 401; tanpa Origin 403', async () => {
  assert.equal((await callApi(env, 'POST', '/api/shop', { headers: a.headers, body: '{rosak' })).status, 400);
  assert.equal((await callApi(env, 'POST', '/api/shop', { body: SHOP_BODY })).status, 401);
  assert.equal((await callApi(env, 'POST', '/api/shop', { headers: a.headers, body: SHOP_BODY, origin: 'https://evil.test' })).status, 403);
  assert.equal(env.DB.rows('SELECT * FROM shops').length, 0);
});

test('/api/me menunjukkan kedai selepas dicipta, termasuk pelan efektif', async () => {
  await create(a);
  const me = await callApi(env, 'GET', '/api/me', { headers: a.headers });
  assert.equal(me.json.shop.slug, 'wakanda');
  assert.equal(me.json.shop.plan.code, 'free');
  assert.equal(me.json.shop.plan.maxProducts, 20);
  assert.equal(me.json.shop.plan.maxStorageBytes, 10485760);
  assert.equal(me.json.shop.storageBytes, 0);
});

// ---------------------------------------------------------------- slug-check

test('slug-check: tersedia, format, reserved, diambil, kedai sendiri', async () => {
  assert.deepEqual((await slugCheck(a, 'Wakanda')).json, { ok: true, available: true, slug: 'wakanda' });
  assert.equal((await slugCheck(a, 'ab')).json.reason, 'format');
  assert.equal((await slugCheck(a, 'a--')).json.reason, 'format');
  assert.equal((await slugCheck(a, 'admin')).json.reason, 'reserved');
  assert.equal((await slugCheck(a, '404')).json.reason, 'reserved');

  await create(b);
  const taken = await slugCheck(a, 'wakanda');
  assert.equal(taken.json.available, false);
  assert.equal(taken.json.reason, 'taken');
  assert.equal(taken.json.message, 'Nama ini tak boleh digunakan, cuba yang lain.');
  assert.equal((await slugCheck(b, 'wakanda')).json.available, true, 'slug sendiri tersedia');
});

test('slug-check perlu sesi dan parameter', async () => {
  assert.equal((await callApi(env, 'GET', '/api/slug-check?slug=abc')).status, 401);
  assert.equal((await callApi(env, 'GET', '/api/slug-check', { headers: a.headers })).status, 400);
});

// ---------------------------------------------------------------- GET dan PATCH

test('GET /api/shop tanpa kedai 404; dengan kedai pulang tetapan penuh', async () => {
  assert.equal((await callApi(env, 'GET', '/api/shop', { headers: a.headers })).status, 404);
  await create(a);
  const res = await callApi(env, 'GET', '/api/shop', { headers: a.headers });
  assert.equal(res.status, 200);
  assert.equal(res.json.shop.whatsapp, '60123456789');
  assert.equal(res.json.shop.description, '');
});

test('PATCH: ubah beberapa medan, yang lain kekal', async () => {
  await create(a);
  const res = await patch(a, { name: 'Wakanda Baru', whatsapp: '+60 11-2345 6789', themeColor: '#1D4ED8', isOpen: false, askAddress: true, description: 'Buka 9 pagi' });
  assert.equal(res.status, 200);
  assert.equal(res.json.shop.name, 'Wakanda Baru');
  assert.equal(res.json.shop.whatsapp, '601123456789');
  assert.equal(res.json.shop.themeColor, '#1D4ED8');
  assert.equal(res.json.shop.isOpen, false);
  assert.equal(res.json.shop.askAddress, true);
  assert.equal(res.json.shop.slug, 'wakanda');
  assert.equal(res.json.shop.askName, true);
});

test('PATCH badan kosong: tiada perubahan, 200', async () => {
  await create(a);
  const before = env.DB.rows('SELECT updated_at FROM shops')[0];
  const res = await patch(a, {});
  assert.equal(res.status, 200);
  assert.equal(env.DB.rows('SELECT updated_at FROM shops')[0].updated_at, before.updated_at);
});

test('IPD ujian "Ubah medan terlarang": plan_code pro dalam PATCH /api/shop diabaikan', async () => {
  await create(a);
  const res = await patch(a, {
    name: 'Tukar Nama', plan_code: 'pro', planCode: 'pro', plan_expires_at: '2099-12-31', planExpiresAt: '2099-12-31',
    status: 'suspended', storage_bytes: 999999, storageBytes: 999999, slug_changes: 0, owner_user_id: b.id, catalog_dirty: 1,
    suspended_reason: 'x', plan_anchor_day: 5,
  });
  assert.equal(res.status, 200);
  const row = env.DB.rows('SELECT * FROM shops')[0];
  assert.equal(row.name, 'Tukar Nama');
  assert.equal(row.plan_code, 'free');
  assert.equal(row.plan_expires_at, null);
  assert.equal(row.status, 'active');
  assert.equal(row.storage_bytes, 0);
  assert.equal(row.owner_user_id, a.id);
  assert.equal(row.catalog_dirty, 0);
  assert.equal(row.suspended_reason, null);
  assert.equal(row.plan_anchor_day, null);
});

test('templat mesej: pelan Percuma ditolak 403 perlu-pro, tiada perubahan lain', async () => {
  await create(a);
  const res = await patch(a, { name: 'Nama Lain', messageTemplate: 'Order {kedai}\n{senarai_item}' });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'perlu-pro');
  const row = env.DB.rows('SELECT name, message_template FROM shops')[0];
  assert.deepEqual(row, { name: 'Kedai Wakanda', message_template: null });
  assert.equal((await patch(a, { messageTemplate: null })).status, 200, 'set semula ke lalai dibenarkan');
  assert.equal((await patch(a, { messageTemplate: '' })).status, 200);
});

test('templat mesej Pro: disimpan, dipulangkan, dan divalidasi', async () => {
  await create(a);
  env.DB.sqlite.exec("UPDATE shops SET plan_code = 'pro', plan_expires_at = date('now', '+30 days')");
  const tpl = 'Salam {kedai},\n{senarai_item}\nJumlah {jumlah}\nDari {nama}';
  const res = await patch(a, { messageTemplate: `  ${tpl}  ` });
  assert.equal(res.status, 200);
  assert.equal(res.json.shop.messageTemplate, tpl);
  for (const bad of ['Tiada senarai item {kedai}', 'x'.repeat(790) + '{senarai_item}', 123]) {
    const r = await patch(a, { messageTemplate: bad });
    assert.equal(r.status, 400, String(bad).slice(0, 20));
    assert.ok(r.json.fields.messageTemplate);
  }
  assert.equal((await patch(a, { messageTemplate: null })).json.shop.messageTemplate, null);
});

test('templat mesej kekal dalam D1 bila pelan turun (tak dipadam), tapi tak diterbitkan', async () => {
  await create(a);
  env.DB.sqlite.exec("UPDATE shops SET plan_code = 'pro', plan_expires_at = date('now', '+30 days')");
  await patch(a, { messageTemplate: 'Hai {kedai} {senarai_item}' });
  env.DB.sqlite.exec("UPDATE shops SET plan_expires_at = date('now', '-30 days')");
  await patch(a, { name: 'Kedai Turun' });
  assert.equal(env.DB.rows('SELECT message_template FROM shops')[0].message_template, 'Hai {kedai} {senarai_item}');
  assert.equal(env.MEDIA.json('catalog/wakanda.json').shop.tpl, null);
});

test('PATCH validasi: nilai tak sah ditolak 400 dan tiada apa berubah', async () => {
  await create(a);
  for (const bad of [{ name: 'A' }, { whatsapp: '1' }, { themeColor: '#000000' }, { description: 'x'.repeat(301) }, { isOpen: 'ya' }, { slug: 'a--' }]) {
    const res = await patch(a, { ...bad, askAddress: true });
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  assert.equal(env.DB.rows('SELECT ask_address FROM shops')[0].ask_address, 0);
});

test('IDOR: peniaga B tak boleh ubah kedai A (kedai dicari melalui sesi; shop_id dalam body diabaikan)', async () => {
  const shopA = (await create(a)).json.shop.id;
  const res = await patch(b, { name: 'Dirampas', shop_id: shopA, id: shopA, shopId: shopA });
  assert.equal(res.status, 404, 'B belum ada kedai');
  assert.equal(env.DB.rows('SELECT name FROM shops WHERE id = ?', shopA)[0].name, 'Kedai Wakanda');

  await create(b, { ...SHOP_BODY, slug: 'kedai-b', name: 'Kedai B' });
  const res2 = await patch(b, { name: 'B Baru', shop_id: shopA });
  assert.equal(res2.status, 200);
  assert.equal(env.DB.rows('SELECT name FROM shops WHERE id = ?', shopA)[0].name, 'Kedai Wakanda');
  assert.equal(env.DB.rows("SELECT name FROM shops WHERE slug = 'kedai-b'")[0].name, 'B Baru');
});

test('tukar slug: berjaya, direkod dalam audit_log, baki berkurang', async () => {
  await create(a);
  const res = await patch(a, { slug: 'Wakanda-Baru' });
  assert.equal(res.status, 200);
  assert.equal(res.json.shop.slug, 'wakanda-baru');
  assert.equal(res.json.shop.slugChangesLeft, 2);
  const log = env.DB.rows('SELECT * FROM audit_log');
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'rename_slug');
  assert.equal(log[0].actor_email, a.email);
  assert.deepEqual(JSON.parse(log[0].meta), { from: 'wakanda', to: 'wakanda-baru' });
});

test('slug sama dengan semasa bukan perubahan (tak guna baki, tiada audit)', async () => {
  await create(a);
  const res = await patch(a, { slug: 'WAKANDA', name: 'Nama Baharu' });
  assert.equal(res.status, 200);
  assert.equal(res.json.shop.slugChangesLeft, 3);
  assert.equal(env.DB.rows('SELECT * FROM audit_log').length, 0);
});

test('maksimum 3 perubahan slug (BSD): yang ke-4 ditolak 409 had-tukar-slug', async () => {
  await create(a);
  for (const s of ['satu', 'dua', 'tiga']) assert.equal((await patch(a, { slug: `kedai-${s}` })).status, 200, s);
  const res = await patch(a, { slug: 'kedai-empat' });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'had-tukar-slug');
  assert.equal(env.DB.rows('SELECT slug FROM shops')[0].slug, 'kedai-tiga');
  assert.equal(env.DB.rows('SELECT * FROM audit_log').length, 3);
  assert.equal((await patch(a, { name: 'Nama masih boleh ditukar' })).status, 200);
});

test('tukar ke slug diambil atau reserved ditolak; baki tak berkurang', async () => {
  await create(a);
  await create(b, { ...SHOP_BODY, slug: 'kedai-b' });
  assert.equal((await patch(a, { slug: 'kedai-b' })).json.code, 'slug-diambil');
  assert.equal((await patch(a, { slug: 'admin' })).json.code, 'slug-diambil');
  assert.equal((await patch(a, { slug: '404' })).json.code, 'slug-diambil');
  const row = env.DB.rows("SELECT slug, slug_changes FROM shops WHERE slug = 'wakanda'")[0];
  assert.equal(row.slug_changes, 0);
});

test('slug lama boleh diambil orang lain selepas ditukar (slug lama tak dikekalkan)', async () => {
  await create(a);
  await patch(a, { slug: 'wakanda-baru' });
  assert.equal((await create(b)).status, 201);
});

test('kedai digantung tak boleh diubah (PATCH 403) tetapi masih boleh dibaca', async () => {
  const shopId = insertShop(env, a, { status: 'suspended' });
  assert.equal((await patch(a, { name: 'Cuba Ubah' })).status, 403);
  assert.equal((await patch(a, { name: 'Cuba Ubah' })).json.code, 'digantung');
  assert.equal((await callApi(env, 'GET', '/api/shop', { headers: a.headers })).status, 200);
  assert.equal(env.DB.rows('SELECT name FROM shops WHERE id = ?', shopId)[0].name, 'Kedai Ujian');
});

test('pelan Pro tamat melepasi toleransi dilaporkan sebagai free dalam /api/me', async () => {
  insertShop(env, a, { plan: 'pro', expires: '2020-01-01' });
  const me = await callApi(env, 'GET', '/api/me', { headers: a.headers });
  assert.equal(me.json.shop.planCode, 'pro', 'nilai disimpan');
  assert.equal(me.json.shop.plan.code, 'free', 'pelan efektif');
  assert.equal(me.json.shop.plan.maxBanners, 1);
});
