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

const req = (user, method, path, body) => callApi(env, method, path, { headers: user.headers, body });
const create = (user, body) => req(user, 'POST', '/api/products', body);
const patch = (user, id, body) => req(user, 'PATCH', `/api/products/${id}`, body);
const del = (user, id) => callApi(env, 'DELETE', `/api/products/${id}`, { headers: { ...user.headers, 'Content-Type': 'application/json' } });
const list = (user) => req(user, 'GET', '/api/products');
const rows = (id = shopA) => env.DB.rows('SELECT * FROM products WHERE shop_id = ? ORDER BY sort_order', id);
const storage = (id = shopA) => env.DB.rows('SELECT storage_bytes FROM shops WHERE id = ?', id)[0].storage_bytes;
const makePro = (id = shopA) => env.DB.sqlite.prepare("UPDATE shops SET plan_code = 'pro', plan_expires_at = date('now', '+30 days') WHERE id = ?").run(id);

async function uploadPair(user, big = 3000, thumb = 500) {
  const up = async (kind, size) => {
    const r = await callApi(env, 'POST', `/api/upload?kind=${kind}`, { headers: { ...user.headers, 'Content-Type': 'image/webp' }, body: fakeWebp(size) });
    assert.equal(r.status, 200, `upload ${kind}`);
    return r.json.key;
  };
  return { imageKey: await up('product', big), thumbKey: await up('thumb', thumb) };
}

// ---------------------------------------------------------------- tambah

test('tambah produk minimum (nama sahaja): harga kosong = Hubungi untuk harga, tersedia, susunan di hujung', async () => {
  const r1 = await create(a, { name: 'Teh Ais' });
  assert.equal(r1.status, 201);
  assert.equal(r1.json.product.name, 'Teh Ais');
  assert.equal(r1.json.product.priceSen, null);
  assert.equal(r1.json.product.isAvailable, true);
  assert.equal(r1.json.product.imageKey, null);
  const r2 = await create(a, { name: 'Kopi O', priceSen: 250 });
  assert.equal(r2.json.product.sortOrder, 1);
  assert.deepEqual(rows().map((p) => p.name), ['Teh Ais', 'Kopi O']);
});

test('tambah produk penuh dengan gambar: saiz sebenar dari R2 dikira dalam storage', async () => {
  const cat = await req(a, 'POST', '/api/categories', { name: 'Minuman' });
  const pair = await uploadPair(a, 3000, 500);
  const res = await create(a, { name: 'Teh Tarik', description: 'Kurang manis\nboleh', priceSen: 350, categoryId: cat.json.category.id, isAvailable: false, ...pair });
  assert.equal(res.status, 201);
  assert.equal(res.json.product.bytes, 3500);
  assert.equal(res.json.product.categoryId, cat.json.category.id);
  assert.equal(res.json.product.isAvailable, false);
  assert.equal(res.json.product.description, 'Kurang manis\nboleh');
  assert.equal(storage(), 3500);
});

test('validasi: nama, harga, penerangan, kategori, boolean', async () => {
  const cases = [
    [{}, 'name'],
    [{ name: '' }, 'name'],
    [{ name: '   ' }, 'name'],
    [{ name: 'x'.repeat(81) }, 'name'],
    [{ name: 'A', priceSen: -1 }, 'priceSen'],
    [{ name: 'A', priceSen: 12.5 }, 'priceSen'],
    [{ name: 'A', priceSen: '1250' }, 'priceSen'],
    [{ name: 'A', priceSen: 100000000 }, 'priceSen'],
    [{ name: 'A', description: 'x'.repeat(501) }, 'description'],
    [{ name: 'A', isAvailable: 'ya' }, 'isAvailable'],
    [{ name: 'A', categoryId: 5 }, 'categoryId'],
  ];
  for (const [body, field] of cases) {
    const res = await create(a, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.json.fields[field], `${field}: ${JSON.stringify(res.json)}`);
  }
  assert.equal(rows().length, 0);
});

test('kategori kedai lain atau tak wujud ditolak', async () => {
  const shopB = insertShop(env, b, { slug: 'kedai-b' });
  env.DB.sqlite.prepare("INSERT INTO categories (id, shop_id, name) VALUES ('cat-b', ?, 'B')").run(shopB);
  assert.equal((await create(a, { name: 'X', categoryId: 'cat-b' })).status, 400);
  assert.equal((await create(a, { name: 'X', categoryId: 'tiada' })).status, 400);
});

test('IPD "Had produk": produk ke-21 pada pelan Percuma ditolak 409 had-produk melalui API', async () => {
  for (let i = 1; i <= 20; i++) assert.equal((await create(a, { name: `Produk ${i}` })).status, 201, `produk ${i}`);
  const res = await create(a, { name: 'Produk 21' });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'had-produk');
  assert.match(res.json.message, /Had 20 produk pelan Percuma dicapai/);
  assert.equal(rows().length, 20);
});

test('had produk mengikut jadual plans (boleh diubah tanpa deploy) dan pelan Pro', async () => {
  env.DB.sqlite.exec("UPDATE plans SET max_products = 2 WHERE code = 'free'");
  await create(a, { name: '1' });
  await create(a, { name: '2' });
  assert.equal((await create(a, { name: '3' })).status, 409);
  makePro();
  assert.equal((await create(a, { name: '3' })).status, 201);
});

test('had produk serentak: permintaan selari tak melepasi had', async () => {
  env.DB.sqlite.exec("UPDATE plans SET max_products = 3 WHERE code = 'free'");
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => create(a, { name: `P${i}` })));
  assert.equal(results.filter((r) => r.status === 201).length, 3);
  assert.equal(rows().length, 3);
});

test('IPD "Had storage": gambar yang melebihi had storage ditolak, tiada produk dicipta', async () => {
  const pair = await uploadPair(a, 3000, 500);
  env.DB.sqlite.prepare('UPDATE shops SET storage_bytes = ? WHERE id = ?').run(10 * 1048576 - 1000, shopA);
  const res = await create(a, { name: 'Besar', ...pair });
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'had-storage');
  assert.equal(rows().length, 0);
});

test('gambar tak sah: kunci banner, kunci kedai lain, jenis terbalik, separuh pasangan, belum dimuat naik, sudah dipakai', async () => {
  const shopB = insertShop(env, b, { slug: 'kedai-b' });
  const pairB = await uploadPair(b);
  const pairA = await uploadPair(a);
  const banner = (await callApi(env, 'POST', '/api/upload?kind=banner', { headers: { ...a.headers, 'Content-Type': 'image/webp' }, body: fakeWebp() })).json.key;
  const cases = [
    { imageKey: pairB.imageKey, thumbKey: pairB.thumbKey },
    { imageKey: banner, thumbKey: pairA.thumbKey },
    { imageKey: pairA.thumbKey, thumbKey: pairA.imageKey },
    { imageKey: pairA.imageKey },
    { thumbKey: pairA.thumbKey },
    { imageKey: `shops/${shopA}/00000000-0000-4000-8000-000000000000.webp`, thumbKey: pairA.thumbKey },
  ];
  for (const c of cases) {
    const res = await create(a, { name: 'X', ...c });
    assert.equal(res.status, 400, JSON.stringify(c));
  }
  assert.equal((await create(a, { name: 'Pertama', ...pairA })).status, 201);
  assert.equal((await create(a, { name: 'Kedua', ...pairA })).status, 400, 'gambar sama tak boleh dipakai dua produk');
  assert.equal(rows(shopB).length, 0);
});

// ---------------------------------------------------------------- ubah, padam, IDOR

test('ubah medan produk; medan lain kekal', async () => {
  const id = (await create(a, { name: 'Teh', priceSen: 300, description: 'Asal' })).json.product.id;
  const res = await patch(a, id, { priceSen: 350, isAvailable: false });
  assert.equal(res.status, 200);
  assert.equal(res.json.product.priceSen, 350);
  assert.equal(res.json.product.isAvailable, false);
  assert.equal(res.json.product.name, 'Teh');
  assert.equal(res.json.product.description, 'Asal');
  assert.equal((await patch(a, id, { priceSen: null })).json.product.priceSen, null, 'kosongkan harga');
});

test('ganti gambar: objek lama dipadam dari R2, storage dikira semula; buang gambar mengosongkan storage', async () => {
  const p1 = await uploadPair(a, 3000, 500);
  const id = (await create(a, { name: 'Teh', ...p1 })).json.product.id;
  const p2 = await uploadPair(a, 1000, 200);
  const res = await patch(a, id, p2);
  assert.equal(res.status, 200);
  assert.equal(res.json.product.bytes, 1200);
  assert.equal(storage(), 1200);
  assert.ok(!env.MEDIA.objects.has(p1.imageKey) && !env.MEDIA.objects.has(p1.thumbKey), 'gambar lama dibuang');
  assert.ok(env.MEDIA.objects.has(p2.imageKey));

  const cleared = await patch(a, id, { imageKey: null, thumbKey: null });
  assert.equal(cleared.json.product.imageKey, null);
  assert.equal(storage(), 0);
  assert.ok(!env.MEDIA.objects.has(p2.imageKey));
});

test('hantar semula pasangan gambar yang sama tak mengubah storage', async () => {
  const p1 = await uploadPair(a, 3000, 500);
  const id = (await create(a, { name: 'Teh', ...p1 })).json.product.id;
  await patch(a, id, { name: 'Teh Baru', ...p1 });
  assert.equal(storage(), 3500);
  assert.ok(env.MEDIA.objects.has(p1.imageKey));
});

test('padam produk: baris, gambar R2 dan storage dikemas kini', async () => {
  const pair = await uploadPair(a, 3000, 500);
  const id = (await create(a, { name: 'Teh', ...pair })).json.product.id;
  const res = await del(a, id);
  assert.equal(res.status, 200);
  assert.equal(rows().length, 0);
  assert.equal(storage(), 0);
  assert.ok(!env.MEDIA.objects.has(pair.imageKey) && !env.MEDIA.objects.has(pair.thumbKey));
  assert.equal((await del(a, id)).status, 404);
});

test('IPD "Pemilikan (IDOR)": peniaga A tak boleh ubah atau padam produk B', async () => {
  insertShop(env, b, { slug: 'kedai-b' });
  const pairB = await uploadPair(b);
  const idB = (await create(b, { name: 'Produk B', priceSen: 1000, ...pairB })).json.product.id;
  const r1 = await patch(a, idB, { name: 'Dirampas', priceSen: 1 });
  assert.equal(r1.status, 404);
  const r2 = await del(a, idB);
  assert.equal(r2.status, 404);
  const rowB = env.DB.rows('SELECT name, price_sen FROM products WHERE id = ?', idB)[0];
  assert.deepEqual(rowB, { name: 'Produk B', price_sen: 1000 });
  assert.ok(env.MEDIA.objects.has(pairB.imageKey), 'gambar B tak dipadam');
});

test('IPD "XSS": nama produk berisi HTML disimpan sebagai teks dan tak diubah', async () => {
  const res = await create(a, { name: '<img src=x onerror=alert(1)>' });
  assert.equal(res.json.product.name, '<img src=x onerror=alert(1)>');
});

test('API tanpa sesi 401; kedai digantung tak boleh tulis; Origin lain 403', async () => {
  assert.equal((await callApi(env, 'GET', '/api/products')).status, 401);
  assert.equal((await callApi(env, 'POST', '/api/products', { body: { name: 'X' } })).status, 401);
  assert.equal((await callApi(env, 'POST', '/api/products', { headers: a.headers, body: { name: 'X' }, origin: 'https://evil.test' })).status, 403);
  env.DB.sqlite.prepare("UPDATE shops SET status = 'suspended' WHERE id = ?").run(shopA);
  assert.equal((await create(a, { name: 'X' })).status, 403);
  assert.equal((await list(a)).status, 200, 'masih boleh baca');
});

// ---------------------------------------------------------------- senarai dan susun

test('GET /api/products: produk, kategori, pelan dan penggunaan; produk melebihi had ditanda hidden', async () => {
  env.DB.sqlite.exec("UPDATE plans SET max_products = 2 WHERE code = 'free'");
  makePro();
  for (const n of ['A', 'B', 'C']) await create(a, { name: n });
  env.DB.sqlite.prepare("UPDATE shops SET plan_expires_at = date('now', '-30 days') WHERE id = ?").run(shopA);
  const res = await list(a);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.products.map((p) => [p.name, p.hidden]), [['A', false], ['B', false], ['C', true]]);
  assert.equal(res.json.plan.code, 'free');
  assert.deepEqual(res.json.usage, { products: 3, categories: 0, storageBytes: 0 });
});

test('susun semula: hanya baris berubah ditulis; senarai lapuk ditolak', async () => {
  const ids = [];
  for (const n of ['A', 'B', 'C', 'D']) ids.push((await create(a, { name: n })).json.product.id);
  const swap = [ids[0], ids[2], ids[1], ids[3]];
  const res = await req(a, 'POST', '/api/products/reorder', { ids: swap });
  assert.equal(res.status, 200);
  assert.equal(res.json.changed, 2, 'tukar dua bersebelahan = dua tulisan');
  assert.deepEqual(rows().map((p) => p.name), ['A', 'C', 'B', 'D']);

  for (const bad of [[ids[0], ids[1]], [...ids, 'lebih'], [ids[0], ids[0], ids[1], ids[2]], ['x', 'y', 'z', 'w'], 'bukan-senarai']) {
    assert.equal((await req(a, 'POST', '/api/products/reorder', { ids: bad })).status, 409, JSON.stringify(bad));
  }
});

test('susun semula tak boleh memasukkan id produk kedai lain', async () => {
  insertShop(env, b, { slug: 'kedai-b' });
  const idA = (await create(a, { name: 'A' })).json.product.id;
  const idB = (await create(b, { name: 'B' })).json.product.id;
  assert.equal((await req(a, 'POST', '/api/products/reorder', { ids: [idB] })).status, 409);
  assert.equal((await req(a, 'POST', '/api/products/reorder', { ids: [idA, idB] })).status, 409);
});

test('/api/me membawa penggunaan had untuk meter dashboard', async () => {
  await create(a, { name: 'A' });
  await req(a, 'POST', '/api/categories', { name: 'Kuih' });
  const me = await callApi(env, 'GET', '/api/me', { headers: a.headers });
  assert.deepEqual(me.json.shop.usage, { products: 1, categories: 1, banners: 0 });
});
