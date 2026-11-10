import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser, insertShop } from './helpers/seed.js';
import { fakeJpeg, fakeWebp } from './helpers/r2.js';
import { UPLOAD_LIMITS } from '../lib/media.js';

let env;
let a;
let shopId;

beforeEach(async () => {
  env = makeEnv();
  a = await makeUser(env, 'a');
  shopId = insertShop(env, a);
});

const upload = (kind, body, type = 'image/webp', extraHeaders = {}, user = a) =>
  callApi(env, 'POST', `/api/upload?kind=${kind}`, { headers: { ...user.headers, 'Content-Type': type, ...extraHeaders }, body });

test('muat naik WebP banner: kunci dijana server di bawah awalan kedai, disimpan dengan jenis dan cache betul', async () => {
  const res = await upload('banner', fakeWebp(3000));
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.bytes, 3000);
  assert.match(res.json.key, new RegExp(`^shops/${shopId}/b_[0-9a-f-]{36}\\.webp$`));

  const stored = env.MEDIA.objects.get(res.json.key);
  assert.equal(stored.bytes.length, 3000);
  assert.equal(stored.httpMetadata.contentType, 'image/webp');
  assert.equal(stored.httpMetadata.cacheControl, 'public, max-age=31536000, immutable');
});

test('format kunci mengikut BSD seksyen 5: produk, thumbnail, banner; .jpg untuk JPEG', async () => {
  const product = (await upload('product', fakeWebp())).json.key;
  const thumb = (await upload('thumb', fakeWebp())).json.key;
  const jpg = (await upload('banner', fakeJpeg(), 'image/jpeg')).json.key;
  assert.match(product, new RegExp(`^shops/${shopId}/[0-9a-f-]{36}\\.webp$`));
  assert.match(thumb, new RegExp(`^shops/${shopId}/[0-9a-f-]{36}_t\\.webp$`));
  assert.match(jpg, new RegExp(`^shops/${shopId}/b_[0-9a-f-]{36}\\.jpg$`));
});

test('kunci tak boleh dipengaruhi client (parameter key atau header diabaikan)', async () => {
  const res = await callApi(env, 'POST', '/api/upload?kind=banner&key=shops/lain/x.webp', {
    headers: { ...a.headers, 'Content-Type': 'image/webp', 'X-Key': 'shops/lain/y.webp' },
    body: fakeWebp(),
  });
  assert.equal(res.status, 200);
  assert.ok(res.json.key.startsWith(`shops/${shopId}/`));
});

test('had saiz setiap jenis: tepat pada had lulus, lebih satu bait ditolak 413', async () => {
  for (const [kind, max] of Object.entries(UPLOAD_LIMITS)) {
    assert.equal((await upload(kind, fakeWebp(max))).status, 200, `${kind} pada had`);
    const over = await upload(kind, fakeWebp(max + 1));
    assert.equal(over.status, 413, `${kind} melebihi`);
    assert.equal(over.json.code, 'gambar-terlalu-besar');
  }
  assert.equal(UPLOAD_LIMITS.product, 400 * 1024);
  assert.equal(UPLOAD_LIMITS.thumb, 80 * 1024);
  assert.equal(UPLOAD_LIMITS.banner, 500 * 1024);
});

test('Content-Length melebihi had ditolak sebelum badan dibaca', async () => {
  const res = await upload('thumb', fakeWebp(100), 'image/webp', { 'Content-Length': String(10 * 1024 * 1024) });
  assert.equal(res.status, 413);
  assert.equal(env.MEDIA.keys().length, 0);
});

test('Content-Length bohong (kecil) tetap dihadkan semasa membaca strim', async () => {
  const res = await upload('thumb', fakeWebp(500 * 1024), 'image/webp', { 'Content-Length': '100' });
  assert.equal(res.status, 413);
  assert.equal(env.MEDIA.keys().length, 0);
});

test('IPD ujian "Muat naik palsu": fail .exe berpura-pura jpg ditolak oleh magic bytes', async () => {
  const exe = new Uint8Array(2000);
  exe.set([0x4d, 0x5a, 0x90, 0x00]); // MZ
  const res = await upload('banner', exe, 'image/jpeg');
  assert.equal(res.status, 415);
  assert.equal(res.json.code, 'jenis-gambar');
  assert.equal(env.MEDIA.keys().length, 0);
});

test('HTML/SVG/teks berpura-pura gambar ditolak', async () => {
  for (const text of ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', '<script>alert(1)</script>', 'GIF89a....', '\x89PNG\r\n\x1a\n']) {
    for (const type of ['image/jpeg', 'image/webp']) {
      assert.equal((await upload('banner', new TextEncoder().encode(text), type)).status, 415, `${text.slice(0, 12)} sebagai ${type}`);
    }
  }
});

test('jenis diisytihar tak sepadan dengan bait sebenar ditolak (JPEG diisytihar WebP dan sebaliknya)', async () => {
  assert.equal((await upload('banner', fakeJpeg(), 'image/webp')).status, 415);
  assert.equal((await upload('banner', fakeWebp(), 'image/jpeg')).status, 415);
});

test('jenis kandungan lain ditolak: png, gif, svg, json, tiada header', async () => {
  for (const type of ['image/png', 'image/gif', 'image/svg+xml', 'application/json', 'text/html', 'application/octet-stream']) {
    assert.equal((await upload('banner', fakeWebp(), type)).status, 415, type);
  }
});

test('Content-Type dengan parameter dan huruf besar diterima', async () => {
  assert.equal((await upload('banner', fakeWebp(), 'Image/WebP; charset=binary')).status, 200);
});

test('badan kosong 400; kind tak sah atau tiada 400', async () => {
  assert.equal((await upload('banner', new Uint8Array(0))).status, 400);
  assert.equal((await upload('avatar', fakeWebp())).status, 400);
  assert.equal((await upload('constructor', fakeWebp())).status, 400);
  assert.equal((await upload('__proto__', fakeWebp())).status, 400);
  const none = await callApi(env, 'POST', '/api/upload', { headers: { ...a.headers, 'Content-Type': 'image/webp' }, body: fakeWebp() });
  assert.equal(none.status, 400);
});

test('IPD ujian "Had storage": melebihi had storage pelan ditolak 409 had-storage', async () => {
  env.DB.sqlite.prepare('UPDATE shops SET storage_bytes = ? WHERE id = ?').run(10 * 1048576 - 1000, shopId);
  const res = await upload('banner', fakeWebp(1001));
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'had-storage');
  assert.match(res.json.message, /10 MB/);
  assert.equal(env.MEDIA.keys().length, 0);
  assert.equal((await upload('banner', fakeWebp(1000))).status, 200, 'tepat pada had masih lulus');
});

test('had storage mengikut pelan efektif: Pro aktif ada 150 MB', async () => {
  env.DB.sqlite.prepare("UPDATE shops SET plan_code = 'pro', plan_expires_at = date('now', '+30 days'), storage_bytes = ? WHERE id = ?").run(20 * 1048576, shopId);
  assert.equal((await upload('banner', fakeWebp(1000))).status, 200);
});

test('Pro tamat melepasi toleransi: had kembali ke Percuma (10 MB)', async () => {
  env.DB.sqlite.prepare("UPDATE shops SET plan_code = 'pro', plan_expires_at = date('now', '-30 days'), storage_bytes = ? WHERE id = ?").run(20 * 1048576, shopId);
  assert.equal((await upload('banner', fakeWebp(1000))).status, 409);
});

test('tanpa sesi 401; tanpa kedai 404; tanpa Origin 403; kedai digantung 403', async () => {
  const anon = await callApi(env, 'POST', '/api/upload?kind=banner', { headers: { 'Content-Type': 'image/webp' }, body: fakeWebp() });
  assert.equal(anon.status, 401);

  const b = await makeUser(env, 'b');
  assert.equal((await upload('banner', fakeWebp(), 'image/webp', {}, b)).status, 404);

  const noOrigin = await callApi(env, 'POST', '/api/upload?kind=banner', { headers: { ...a.headers, 'Content-Type': 'image/webp' }, body: fakeWebp(), origin: null });
  assert.equal(noOrigin.status, 403);

  env.DB.sqlite.prepare("UPDATE shops SET status = 'suspended'").run();
  assert.equal((await upload('banner', fakeWebp())).status, 403);
  assert.equal(env.MEDIA.keys().length, 0);
});

test('upload tak mengubah storage_bytes (dikira semasa gambar dipautkan)', async () => {
  await upload('banner', fakeWebp(5000));
  assert.equal(env.DB.rows('SELECT storage_bytes FROM shops')[0].storage_bytes, 0);
});
