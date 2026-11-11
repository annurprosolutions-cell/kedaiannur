// /api/products
//   GET   senarai produk dan kategori kedai sendiri, dengan pelan dan penggunaan (S-10, S-11)
//   POST  tambah produk; had produk dan storage pelan efektif dikuatkuasakan di sini (F-10)

import { fail, failFields, json, readJson } from '../../../lib/http.js';
import { ownerShop } from '../../../lib/shop.js';
import { formatMb, planToApi } from '../../../lib/plan.js';
import { CATALOG_FAIL, publishSnapshot } from '../../../lib/catalog.js';
import {
  categoryToApi, checkImagePair, getCategory, getProduct, limitMessage, listCategories, listProducts, productToApi,
  validateProductInput,
} from '../../../lib/products.js';

export async function onRequestGet({ env, data }) {
  const { shop, plan, error } = await ownerShop(env, data.user);
  if (error) return error;
  const [products, categories] = await Promise.all([listProducts(env.DB, shop.id), listCategories(env.DB, shop.id)]);
  return json({
    ok: true,
    products: products.map((p, i) => productToApi(p, i, plan.max_products)),
    categories: categories.map(categoryToApi),
    plan: planToApi(plan),
    usage: { products: products.length, categories: categories.length, storageBytes: shop.storage_bytes },
  });
}

export async function onRequestPost({ request, env, data }) {
  const parsed = await readJson(request);
  if (parsed.error) return fail(400, 'badan-tidak-sah', 'Format permintaan tidak sah.');
  const body = parsed.value;

  const { shop, plan, error } = await ownerShop(env, data.user, { writable: true });
  if (error) return error;

  const { values, errors } = validateProductInput(body, { partial: false });
  if (errors) return failFields(errors);
  if (values.category_id && !(await getCategory(env.DB, shop.id, values.category_id))) {
    return failFields({ categoryId: 'Kategori tak dijumpai.' });
  }

  let imageKey = null;
  let thumbKey = null;
  let bytes = 0;
  if (body.imageKey != null || body.thumbKey != null) {
    const check = await checkImagePair(env, shop.id, body.imageKey, body.thumbKey);
    if (check.error) return fail(check.error.status, check.error.code, check.error.message);
    ({ imageKey, thumbKey } = body);
    bytes = check.bytes;
    if (shop.storage_bytes + bytes > plan.max_storage_bytes) {
      return fail(409, 'had-storage', `Had storage gambar ${formatMb(plan.max_storage_bytes)} pelan ${plan.name} dicapai.`);
    }
  }

  const id = crypto.randomUUID();
  const db = env.DB;
  // Had produk disemak dalam pernyataan INSERT sendiri: dua permintaan serentak tak boleh melepasi had.
  const [ins] = await db.batch([
    db
      .prepare(
        `INSERT INTO products (id, shop_id, category_id, name, description, price_sen, image_key, thumb_key, bytes, is_available, sort_order)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM products WHERE shop_id = ?2)
         WHERE (SELECT count(*) FROM products WHERE shop_id = ?2) < ?11
         RETURNING id`,
      )
      .bind(
        id, shop.id, values.category_id ?? null, values.name, values.description ?? '', values.price_sen ?? null,
        imageKey, thumbKey, bytes, values.is_available ?? 1, plan.max_products,
      ),
    db
      .prepare(
        `UPDATE shops SET storage_bytes = storage_bytes + ?1, updated_at = datetime('now')
         WHERE id = ?2 AND EXISTS (SELECT 1 FROM products WHERE id = ?3)`,
      )
      .bind(bytes, shop.id, id),
  ]);
  if (!ins.results.length) return fail(409, 'had-produk', limitMessage('produk', plan.max_products, plan));

  const product = await getProduct(db, shop.id, id);
  if (!(await publishSnapshot(env, shop.id))) return fail(500, CATALOG_FAIL.code, CATALOG_FAIL.message);
  return json({ ok: true, product: productToApi(product) }, 201);
}
