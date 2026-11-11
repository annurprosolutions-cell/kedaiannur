// POST /api/products/reorder  { ids: [semua id produk mengikut susunan baharu] }

import { fail, json, readJson } from '../../../lib/http.js';
import { ownerShop } from '../../../lib/shop.js';
import { CATALOG_FAIL, publishSnapshot } from '../../../lib/catalog.js';
import { reorderStatements } from '../../../lib/products.js';

export async function onRequestPost({ request, env, data }) {
  const parsed = await readJson(request, 65536);
  if (parsed.error) return fail(400, 'badan-tidak-sah', 'Format permintaan tidak sah.');

  const { shop, error } = await ownerShop(env, data.user, { writable: true });
  if (error) return error;

  const { results: current } = await env.DB
    .prepare('SELECT id, sort_order FROM products WHERE shop_id = ?1 ORDER BY sort_order, id')
    .bind(shop.id)
    .all();
  const statements = reorderStatements(env.DB, 'products', shop.id, current, parsed.value.ids);
  if (!statements) return fail(409, 'senarai-lapuk', 'Senarai produk sudah berubah. Muat semula halaman dan cuba lagi.');

  if (statements.length) {
    await env.DB.batch(statements);
    if (!(await publishSnapshot(env, shop.id))) return fail(500, CATALOG_FAIL.code, CATALOG_FAIL.message);
  }
  return json({ ok: true, changed: statements.length });
}
