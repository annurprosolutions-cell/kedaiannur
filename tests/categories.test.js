import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser, insertShop } from './helpers/seed.js';

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

const req = (user, method, path, body) => callApi(env, method, path, { headers: { ...user.headers, 'Content-Type': 'application/json' }, body });
const add = (user, name) => req(user, 'POST', '/api/categories', { name });
const cats = () => env.DB.rows('SELECT name FROM categories WHERE shop_id = ? ORDER BY sort_order', shopA).map((c) => c.name);

test('tambah, senarai ikut susunan, nama dibersihkan', async () => {
  assert.equal((await add(a, '  Nasi  ')).status, 201);
  assert.equal((await add(a, 'Minuman')).status, 201);
  const res = await req(a, 'GET', '/api/categories');
  assert.deepEqual(res.json.categories.map((c) => c.name), ['Nasi', 'Minuman']);
});

test('nama berganda (tak sensitif huruf) ditolak', async () => {
  await add(a, 'Minuman');
  const res = await add(a, 'MINUMAN');
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'kategori-wujud');
  assert.deepEqual(cats(), ['Minuman']);
});

test('kedai lain boleh guna nama sama', async () => {
  insertShop(env, b, { slug: 'kedai-b' });
  await add(a, 'Minuman');
  assert.equal((await add(b, 'Minuman')).status, 201);
});

test('had 5 kategori pelan Percuma', async () => {
  for (const n of ['A', 'B', 'C', 'D', 'E']) assert.equal((await add(a, n)).status, 201);
  const res = await add(a, 'F');
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'had-kategori');
  assert.match(res.json.message, /Had 5 kategori pelan Percuma/);
});

test('validasi nama: kosong, terlalu panjang, bukan teks', async () => {
  for (const name of ['', '   ', 'x'.repeat(41), 123, null]) {
    assert.equal((await add(a, name)).status, 400, JSON.stringify(name));
  }
});

test('nama semula, termasuk tolak nama yang sudah ada', async () => {
  const id = (await add(a, 'Nasi')).json.category.id;
  await add(a, 'Minuman');
  assert.equal((await req(a, 'PATCH', `/api/categories/${id}`, { name: 'Nasi Lemak' })).json.category.name, 'Nasi Lemak');
  assert.equal((await req(a, 'PATCH', `/api/categories/${id}`, { name: 'minuman' })).status, 409);
  assert.equal((await req(a, 'PATCH', `/api/categories/${id}`, { name: 'NASI LEMAK' })).status, 200, 'tukar huruf nama sendiri dibenarkan');
});

test('padam kategori: produk di dalamnya kekal, jadi tanpa kategori', async () => {
  const id = (await add(a, 'Nasi')).json.category.id;
  const p = await req(a, 'POST', '/api/products', { name: 'Nasi Lemak', categoryId: id });
  assert.equal((await req(a, 'DELETE', `/api/categories/${id}`)).status, 200);
  const row = env.DB.rows('SELECT category_id FROM products WHERE id = ?', p.json.product.id)[0];
  assert.equal(row.category_id, null);
  assert.deepEqual(cats(), []);
});

test('IDOR: kategori kedai lain tak boleh diubah atau dipadam', async () => {
  const shopB = insertShop(env, b, { slug: 'kedai-b' });
  const idB = (await add(b, 'Kategori B')).json.category.id;
  assert.equal((await req(a, 'PATCH', `/api/categories/${idB}`, { name: 'Dirampas' })).status, 404);
  assert.equal((await req(a, 'DELETE', `/api/categories/${idB}`)).status, 404);
  assert.equal(env.DB.rows('SELECT name FROM categories WHERE shop_id = ?', shopB)[0].name, 'Kategori B');
});

test('susun semula kategori', async () => {
  const ids = [];
  for (const n of ['A', 'B', 'C']) ids.push((await add(a, n)).json.category.id);
  assert.equal((await req(a, 'POST', '/api/categories/reorder', { ids: [ids[2], ids[0], ids[1]] })).status, 200);
  assert.deepEqual(cats(), ['C', 'A', 'B']);
  assert.equal((await req(a, 'POST', '/api/categories/reorder', { ids: [ids[0]] })).status, 409);
});
