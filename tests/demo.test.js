// db/data/kedai-contoh.sql: kedai demo boleh dimuat ke D1 dan menghasilkan katalog awam yang betul (dan selamat diulang).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeEnv } from './helpers/seed.js';
import { publishSnapshot } from '../lib/catalog.js';

test('kedai contoh: seed SQL sah, diulang tanpa ralat, snapshot ada kategori dan produk', async () => {
  const env = makeEnv({ MEDIA_BASE_URL: 'https://media.test' });
  const sql = readFileSync(new URL('../db/data/kedai-contoh.sql', import.meta.url), 'utf8');
  env.DB.sqlite.exec(sql);
  env.DB.sqlite.exec(sql);
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM shops WHERE slug = 'contoh'").get().n, 1);
  assert.equal(env.DB.sqlite.prepare("SELECT count(*) n FROM products WHERE shop_id = 'shop-demo-contoh'").get().n, 9);
  assert.deepEqual(sql.match(/'60\d+'/g), ["'60100000000'"], 'hanya nombor pemegang tempat dalam repo');

  await publishSnapshot(env, 'shop-demo-contoh');
  const snap = env.MEDIA.json('catalog/contoh.json');
  assert.equal(snap.shop.name, 'Kedai Contoh');
  assert.equal(snap.categories.length, 3);
  assert.equal(snap.products.length, 9);
  assert.equal(env.DB.sqlite.prepare("SELECT catalog_dirty d FROM shops WHERE slug = 'contoh'").get().d, 0);
});
