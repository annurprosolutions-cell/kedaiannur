import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser, insertShop } from './helpers/seed.js';
import { fakeWebp } from './helpers/r2.js';

let env;
let a;
let b;
let shopA;

beforeEach(async () => {
  env = makeEnv();
  a = await makeUser(env, 'a');
  b = await makeUser(env, 'b');
  shopA = insertShop(env, a, { slug: 'kedai-a' });
});

const put = (user, keys) => callApi(env, 'PUT', '/api/shop/banners', { headers: user.headers, body: { keys } });
const upl = async (user, size = 4000, kind = 'banner') => {
  const res = await callApi(env, 'POST', `/api/upload?kind=${kind}`, { headers: { ...user.headers, 'Content-Type': 'image/webp' }, body: fakeWebp(size) });
  assert.equal(res.status, 200);
  return res.json.key;
};
const storage = (id = shopA) => env.DB.rows('SELECT storage_bytes FROM shops WHERE id = ?', id)[0].storage_bytes;
const rows = (id = shopA) => env.DB.rows('SELECT image_key, bytes, sort_order FROM shop_banners WHERE shop_id = ? ORDER BY sort_order', id);
const makePro = () => env.DB.sqlite.prepare("UPDATE shops SET plan_code = 'pro', plan_expires_at = date('now', '+30 days') WHERE id = ?").run(shopA);

test('tetapkan satu banner: disimpan dengan saiz sebenar daripada R2, storage_bytes dikemas kini', async () => {
  const k = await upl(a, 4321);
  const res = await put(a, [k]);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.banners, [{ key: k, bytes: 4321 }]);
  assert.equal(res.json.storageBytes, 4321);
  assert.deepEqual(rows(), [{ image_key: k, bytes: 4321, sort_order: 0 }]);
  assert.equal(storage(), 4321);
});

test('GET /api/shop menyenaraikan banner mengikut susunan', async () => {
  makePro();
  const k1 = await upl(a);
  const k2 = await upl(a);
  await put(a, [k2, k1]);
  const res = await callApi(env, 'GET', '/api/shop', { headers: a.headers });
  assert.deepEqual(res.json.banners.map((x) => x.key), [k2, k1]);
});

test('IPD: pelan Percuma had 1 banner; dua banner ditolak 409 had-banner dan tiada apa berubah', async () => {
  const k1 = await upl(a);
  const k2 = await upl(a);
  const res = await put(a, [k1, k2]);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'had-banner');
  assert.match(res.json.message, /1 banner pelan Percuma/);
  assert.match(res.json.message, /Pro/);
  assert.equal(rows().length, 0);
  assert.equal(storage(), 0);
});

test('pelan Pro aktif: sehingga 5 banner (berputar), yang ke-6 ditolak', async () => {
  makePro();
  const keys = [];
  for (let i = 0; i < 5; i++) keys.push(await upl(a, 1000 + i));
  assert.equal((await put(a, keys)).status, 200);
  assert.equal(rows().length, 5);
  assert.equal(storage(), 1000 + 1001 + 1002 + 1003 + 1004);
  const sixth = await upl(a);
  const res = await put(a, [...keys, sixth]);
  assert.equal(res.status, 409);
  assert.doesNotMatch(res.json.message, /Naik taraf/);
});

test('Pro tamat melepasi toleransi: had banner kembali ke 1 (data tak dipadam, hanya penambahan disekat)', async () => {
  makePro();
  const k1 = await upl(a);
  const k2 = await upl(a);
  await put(a, [k1, k2]);
  env.DB.sqlite.prepare("UPDATE shops SET plan_expires_at = date('now', '-30 days') WHERE id = ?").run(shopA);
  assert.equal((await put(a, [k1, k2])).status, 409);
  assert.equal(rows().length, 2, 'banner sedia ada tak dipadam oleh turun pelan');
  assert.equal((await put(a, [k1])).status, 200, 'peniaga boleh kurangkan ke had pelan Percuma');
});

test('susun semula: sort_order dikemas kini, storage tak berubah', async () => {
  makePro();
  const [k1, k2, k3] = [await upl(a, 100), await upl(a, 200), await upl(a, 300)];
  await put(a, [k1, k2, k3]);
  await put(a, [k3, k1, k2]);
  assert.deepEqual(rows().map((r) => r.image_key), [k3, k1, k2]);
  assert.equal(storage(), 600);
});

test('ganti banner: objek lama dipadam daripada R2, storage dikira semula', async () => {
  const old = await upl(a, 3000);
  await put(a, [old]);
  const fresh = await upl(a, 1000);
  const res = await put(a, [fresh]);
  assert.equal(res.status, 200);
  assert.equal(storage(), 1000);
  assert.ok(!env.MEDIA.objects.has(old), 'objek lama dibuang daripada R2');
  assert.ok(env.MEDIA.objects.has(fresh));
  assert.deepEqual(rows().map((r) => r.image_key), [fresh]);
});

test('buang semua banner: senarai kosong, R2 dibersihkan, storage kembali 0', async () => {
  const k = await upl(a, 2500);
  await put(a, [k]);
  const res = await put(a, []);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.banners, []);
  assert.equal(storage(), 0);
  assert.equal(env.MEDIA.keys().filter((k) => k.startsWith('shops/')).length, 0);
});

test('PUT berulang dengan senarai sama idempotent: tiada pertambahan storage', async () => {
  const k = await upl(a, 2000);
  await put(a, [k]);
  await put(a, [k]);
  await put(a, [k]);
  assert.equal(storage(), 2000);
  assert.equal(rows().length, 1);
});

test('IDOR: kunci banner kedai lain ditolak; objek dan storage kedai lain tak terjejas', async () => {
  const shopB = insertShop(env, b, { slug: 'kedai-b' });
  const keyB = await upl(b, 2222);
  await put(b, [keyB]);

  const res = await put(a, [keyB]);
  assert.equal(res.status, 400);
  assert.equal(res.json.code, 'gambar-tak-sah');
  assert.equal(rows().length, 0);
  assert.equal(storage(shopB), 2222);
  assert.ok(env.MEDIA.objects.has(keyB));
  assert.equal(rows(shopB).length, 1);
});

test('kunci tak sah: jenis produk, laluan traversal, kunci rawak, bukan rentetan, kunci kedai sendiri tapi bukan banner', async () => {
  const productKey = await upl(a, 1000, 'product');
  const thumbKey = await upl(a, 1000, 'thumb');
  const bad = [
    productKey,
    thumbKey,
    `shops/${shopA}/../shops/${shopA}/b_00000000-0000-4000-8000-000000000000.webp`,
    `shops/${shopA}/b_bukan-uuid.webp`,
    `shops/${shopA}/b_00000000-0000-4000-8000-000000000000.png`,
    `catalog/kedai-a.json`,
    '',
    '../../etc/passwd',
  ];
  for (const k of bad) {
    const res = await put(a, [k]);
    assert.equal(res.status, 400, k);
  }
  for (const body of [{ keys: 'x' }, { keys: [1] }, { keys: [null] }, {}, { keys: {} }]) {
    assert.equal((await callApi(env, 'PUT', '/api/shop/banners', { headers: a.headers, body })).status, 400, JSON.stringify(body));
  }
  assert.equal(rows().length, 0);
  assert.equal(storage(), 0);
});

test('kunci banner sah tetapi belum dimuat naik: 400 gambar-tiada', async () => {
  const res = await put(a, [`shops/${shopA}/b_00000000-0000-4000-8000-000000000000.webp`]);
  assert.equal(res.status, 400);
  assert.equal(res.json.code, 'gambar-tiada');
});

test('kunci berganda ditolak', async () => {
  makePro();
  const k = await upl(a);
  assert.equal((await put(a, [k, k])).json.code, 'banner-berganda');
});

test('had storage: tambah banner yang melebihi had ditolak, tetapi mengurangkan sentiasa dibenarkan', async () => {
  const k = await upl(a, 2000);
  env.DB.sqlite.prepare('UPDATE shops SET storage_bytes = ? WHERE id = ?').run(10 * 1048576 - 1000, shopA);
  const res = await put(a, [k]);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'had-storage');
  assert.equal(rows().length, 0);

  env.DB.sqlite.prepare('UPDATE shops SET storage_bytes = ? WHERE id = ?').run(0, shopA);
  assert.equal((await put(a, [k])).status, 200);
  env.DB.sqlite.prepare('UPDATE shops SET storage_bytes = ? WHERE id = ?').run(11 * 1048576, shopA); // melebihi had selepas turun pelan
  assert.equal((await put(a, [])).status, 200, 'buang gambar dibenarkan walaupun storage melebihi had');
});

test('storage_bytes tak boleh jadi negatif', async () => {
  const k = await upl(a, 2000);
  await put(a, [k]);
  env.DB.sqlite.prepare('UPDATE shops SET storage_bytes = 0 WHERE id = ?').run(shopA);
  await put(a, []);
  assert.equal(storage(), 0);
});

test('tanpa sesi 401; tanpa kedai 404; tanpa Origin 403; kedai digantung 403; bukan JSON 415', async () => {
  assert.equal((await callApi(env, 'PUT', '/api/shop/banners', { body: { keys: [] } })).status, 401);
  const c = await makeUser(env, 'c');
  assert.equal((await put(c, [])).status, 404);
  assert.equal((await callApi(env, 'PUT', '/api/shop/banners', { headers: a.headers, body: { keys: [] }, origin: null })).status, 403);
  assert.equal((await callApi(env, 'PUT', '/api/shop/banners', { headers: { ...a.headers, 'Content-Type': 'text/plain' }, body: '{"keys":[]}' })).status, 415);
  env.DB.sqlite.prepare("UPDATE shops SET status = 'suspended' WHERE id = ?").run(shopA);
  assert.equal((await put(a, [])).status, 403);
});

test('padam kedai (CASCADE) membuang baris banner', async () => {
  const k = await upl(a);
  await put(a, [k]);
  env.DB.sqlite.prepare('DELETE FROM shops WHERE id = ?').run(shopA);
  assert.equal(env.DB.rows('SELECT * FROM shop_banners').length, 0);
});
