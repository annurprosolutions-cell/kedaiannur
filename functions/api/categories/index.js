// /api/categories
//   GET   senarai kategori kedai sendiri
//   POST  tambah kategori { name }; had kategori pelan efektif, nama unik dalam kedai (tak sensitif huruf)

import { fail, failFields, json, readJson } from '../../../lib/http.js';
import { ownerShop } from '../../../lib/shop.js';
import { CATALOG_FAIL, publishSnapshot } from '../../../lib/catalog.js';
import { categoryToApi, getCategory, limitMessage, listCategories, validateCategoryName } from '../../../lib/products.js';

export async function onRequestGet({ env, data }) {
  const { shop, error } = await ownerShop(env, data.user);
  if (error) return error;
  return json({ ok: true, categories: (await listCategories(env.DB, shop.id)).map(categoryToApi) });
}

export async function onRequestPost({ request, env, data }) {
  const parsed = await readJson(request);
  if (parsed.error) return fail(400, 'badan-tidak-sah', 'Format permintaan tidak sah.');

  const { shop, plan, error } = await ownerShop(env, data.user, { writable: true });
  if (error) return error;

  const name = validateCategoryName(parsed.value.name);
  if (name.error) return failFields({ name: name.error });

  const id = crypto.randomUUID();
  const ins = await env.DB
    .prepare(
      `INSERT INTO categories (id, shop_id, name, sort_order)
       SELECT ?1, ?2, ?3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories WHERE shop_id = ?2)
       WHERE (SELECT count(*) FROM categories WHERE shop_id = ?2) < ?4
         AND NOT EXISTS (SELECT 1 FROM categories WHERE shop_id = ?2 AND lower(name) = lower(?3))`,
    )
    .bind(id, shop.id, name.value, plan.max_categories)
    .run();

  if (ins.meta.changes === 0) {
    const { n } = await env.DB.prepare('SELECT count(*) AS n FROM categories WHERE shop_id = ?1').bind(shop.id).first();
    if (n >= plan.max_categories) return fail(409, 'had-kategori', limitMessage('kategori', plan.max_categories, plan));
    return failFields({ name: 'Kategori dengan nama ini sudah ada.' }, 409, 'kategori-wujud');
  }

  const category = await getCategory(env.DB, shop.id, id);
  if (!(await publishSnapshot(env, shop.id))) return fail(500, CATALOG_FAIL.code, CATALOG_FAIL.message);
  return json({ ok: true, category: categoryToApi(category) }, 201);
}
