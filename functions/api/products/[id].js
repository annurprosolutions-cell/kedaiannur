// /api/products/:id
//   PATCH   ubah produk (medan pilihan); gambar baharu menggantikan yang lama, gambar lama dipadam dari R2
//   DELETE  padam produk dan gambarnya

import { fail, failFields, json, readJson } from '../../../lib/http.js';
import { ownerShop } from '../../../lib/shop.js';
import { formatMb } from '../../../lib/plan.js';
import { deleteObjects } from '../../../lib/media.js';
import { CATALOG_FAIL, publishSnapshot } from '../../../lib/catalog.js';
import { checkImagePair, getCategory, getProduct, productToApi, validateProductInput } from '../../../lib/products.js';

const COLUMNS = ['name', 'description', 'price_sen', 'category_id', 'is_available'];
const notFound = () => fail(404, 'produk-tiada', 'Produk tak dijumpai.');

export async function onRequestPatch({ request, env, data, params }) {
  const parsed = await readJson(request);
  if (parsed.error) return fail(400, 'badan-tidak-sah', 'Format permintaan tidak sah.');
  const body = parsed.value;

  const { shop, plan, error } = await ownerShop(env, data.user, { writable: true });
  if (error) return error;
  const product = await getProduct(env.DB, shop.id, params.id);
  if (!product) return notFound();

  const { values, errors } = validateProductInput(body, { partial: true });
  if (errors) return failFields(errors);
  if (values.category_id && !(await getCategory(env.DB, shop.id, values.category_id))) {
    return failFields({ categoryId: 'Kategori tak dijumpai.' });
  }

  // Gambar: imageKey null = buang gambar; pasangan baharu = ganti; tiada dalam body = kekal.
  let newImage = product.image_key;
  let newThumb = product.thumb_key;
  let newBytes = product.bytes;
  if ('imageKey' in body || 'thumbKey' in body) {
    if (body.imageKey == null && body.thumbKey == null) {
      newImage = null;
      newThumb = null;
      newBytes = 0;
    } else if (body.imageKey !== product.image_key || body.thumbKey !== product.thumb_key) {
      const check = await checkImagePair(env, shop.id, body.imageKey, body.thumbKey, product.id);
      if (check.error) return fail(check.error.status, check.error.code, check.error.message);
      newImage = body.imageKey;
      newThumb = body.thumbKey;
      newBytes = check.bytes;
    }
  }
  const delta = newBytes - product.bytes;
  if (delta > 0 && shop.storage_bytes + delta > plan.max_storage_bytes) {
    return fail(409, 'had-storage', `Had storage gambar ${formatMb(plan.max_storage_bytes)} pelan ${plan.name} dicapai.`);
  }

  const sets = [];
  const binds = [];
  for (const col of COLUMNS) {
    if (col in values) {
      binds.push(values[col]);
      sets.push(`${col} = ?${binds.length}`);
    }
  }
  if (newImage !== product.image_key || newThumb !== product.thumb_key) {
    binds.push(newImage, newThumb, newBytes);
    sets.push(`image_key = ?${binds.length - 2}`, `thumb_key = ?${binds.length - 1}`, `bytes = ?${binds.length}`);
  }
  if (!sets.length) return json({ ok: true, product: productToApi(product) });
  sets.push("updated_at = datetime('now')");
  binds.push(product.id, shop.id);

  const db = env.DB;
  await db.batch([
    db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?${binds.length - 1} AND shop_id = ?${binds.length}`).bind(...binds),
    db
      .prepare("UPDATE shops SET storage_bytes = MAX(0, storage_bytes + ?1), updated_at = datetime('now') WHERE id = ?2")
      .bind(delta, shop.id),
  ]);

  const stale = [product.image_key, product.thumb_key].filter((k) => k && k !== newImage && k !== newThumb);
  await deleteObjects(env, stale);

  const fresh = await getProduct(db, shop.id, product.id);
  if (!(await publishSnapshot(env, shop.id))) return fail(500, CATALOG_FAIL.code, CATALOG_FAIL.message);
  return json({ ok: true, product: productToApi(fresh) });
}

export async function onRequestDelete({ env, data, params }) {
  const { shop, error } = await ownerShop(env, data.user, { writable: true });
  if (error) return error;
  const product = await getProduct(env.DB, shop.id, params.id);
  if (!product) return notFound();

  const db = env.DB;
  await db.batch([
    db.prepare('DELETE FROM products WHERE id = ?1 AND shop_id = ?2').bind(product.id, shop.id),
    db
      .prepare("UPDATE shops SET storage_bytes = MAX(0, storage_bytes - ?1), updated_at = datetime('now') WHERE id = ?2")
      .bind(product.bytes, shop.id),
  ]);
  await deleteObjects(env, [product.image_key, product.thumb_key].filter(Boolean));

  if (!(await publishSnapshot(env, shop.id))) return fail(500, CATALOG_FAIL.code, CATALOG_FAIL.message);
  return json({ ok: true });
}
