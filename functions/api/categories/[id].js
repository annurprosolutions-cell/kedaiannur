// /api/categories/:id
//   PATCH   nama semula { name }
//   DELETE  padam kategori; produk di dalamnya kekal tanpa kategori (ON DELETE SET NULL)

import { fail, failFields, json, readJson } from '../../../lib/http.js';
import { ownerShop } from '../../../lib/shop.js';
import { CATALOG_FAIL, publishSnapshot } from '../../../lib/catalog.js';
import { categoryToApi, getCategory, validateCategoryName } from '../../../lib/products.js';

const notFound = () => fail(404, 'kategori-tiada', 'Kategori tak dijumpai.');

export async function onRequestPatch({ request, env, data, params }) {
  const parsed = await readJson(request);
  if (parsed.error) return fail(400, 'badan-tidak-sah', 'Format permintaan tidak sah.');

  const { shop, error } = await ownerShop(env, data.user, { writable: true });
  if (error) return error;
  const category = await getCategory(env.DB, shop.id, params.id);
  if (!category) return notFound();

  const name = validateCategoryName(parsed.value.name);
  if (name.error) return failFields({ name: name.error });
  if (name.value === category.name) return json({ ok: true, category: categoryToApi(category) });

  const upd = await env.DB
    .prepare(
      `UPDATE categories SET name = ?1 WHERE id = ?2 AND shop_id = ?3
         AND NOT EXISTS (SELECT 1 FROM categories WHERE shop_id = ?3 AND id != ?2 AND lower(name) = lower(?1))`,
    )
    .bind(name.value, category.id, shop.id)
    .run();
  if (upd.meta.changes === 0) return failFields({ name: 'Kategori dengan nama ini sudah ada.' }, 409, 'kategori-wujud');

  if (!(await publishSnapshot(env, shop.id))) return fail(500, CATALOG_FAIL.code, CATALOG_FAIL.message);
  return json({ ok: true, category: categoryToApi(await getCategory(env.DB, shop.id, category.id)) });
}

export async function onRequestDelete({ env, data, params }) {
  const { shop, error } = await ownerShop(env, data.user, { writable: true });
  if (error) return error;
  const category = await getCategory(env.DB, shop.id, params.id);
  if (!category) return notFound();

  await env.DB.prepare('DELETE FROM categories WHERE id = ?1 AND shop_id = ?2').bind(category.id, shop.id).run();
  if (!(await publishSnapshot(env, shop.id))) return fail(500, CATALOG_FAIL.code, CATALOG_FAIL.message);
  return json({ ok: true });
}
