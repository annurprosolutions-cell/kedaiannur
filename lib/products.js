// Produk dan kategori: validasi input, bentuk respons, dan pemeriksaan gambar.
// Semua pertanyaan menggunakan shop_id daripada sesi (WHERE id = ? AND shop_id = ?), tak pernah daripada client.

import { LIMITS, MSG, cleanText } from '../public/assets/js/rules.js';
import { isProductImageKeyOf, isThumbKeyOf, objectSize } from './media.js';

export function productToApi(p, index = 0, maxProducts = Infinity) {
  return {
    id: p.id,
    categoryId: p.category_id,
    name: p.name,
    description: p.description,
    priceSen: p.price_sen,
    imageKey: p.image_key,
    thumbKey: p.thumb_key,
    bytes: p.bytes,
    isAvailable: p.is_available === 1,
    sortOrder: p.sort_order,
    // Melebihi had pelan efektif: disimpan tetapi tak dipaparkan dalam katalog awam.
    hidden: index >= maxProducts,
  };
}

export function categoryToApi(c) {
  return { id: c.id, name: c.name, sortOrder: c.sort_order };
}

export async function listProducts(db, shopId) {
  const { results } = await db
    .prepare('SELECT * FROM products WHERE shop_id = ?1 ORDER BY sort_order, id')
    .bind(shopId)
    .all();
  return results;
}

export async function listCategories(db, shopId) {
  const { results } = await db
    .prepare('SELECT * FROM categories WHERE shop_id = ?1 ORDER BY sort_order, id')
    .bind(shopId)
    .all();
  return results;
}

export async function getProduct(db, shopId, id) {
  if (typeof id !== 'string' || id.length > 64) return null;
  return db.prepare('SELECT * FROM products WHERE id = ?1 AND shop_id = ?2').bind(id, shopId).first();
}

export async function getCategory(db, shopId, id) {
  if (typeof id !== 'string' || id.length > 64) return null;
  return db.prepare('SELECT * FROM categories WHERE id = ?1 AND shop_id = ?2').bind(id, shopId).first();
}

/**
 * Validasi medan produk (bukan gambar). Pulangkan { values, errors }; values guna nama lajur D1.
 * partial: hanya medan yang ada dalam body disemak (PATCH).
 */
export function validateProductInput(body, { partial }) {
  const values = {};
  const errors = {};

  if ('name' in body || !partial) {
    const name = typeof body.name === 'string' ? cleanText(body.name) : '';
    if (name.length < 1 || name.length > LIMITS.productNameMax) errors.name = MSG.namaProduk;
    else values.name = name;
  }
  if ('description' in body) {
    if (body.description !== null && typeof body.description !== 'string') errors.description = MSG.peneranganProduk;
    else {
      const d = cleanText(body.description ?? '', { multiline: true });
      if (d.length > LIMITS.productDescMax) errors.description = MSG.peneranganProduk;
      else values.description = d;
    }
  }
  if ('priceSen' in body) {
    const p = body.priceSen;
    if (p === null) values.price_sen = null;
    else if (Number.isSafeInteger(p) && p >= 0 && p <= LIMITS.priceMaxSen) values.price_sen = p;
    else errors.priceSen = MSG.harga;
  }
  if ('isAvailable' in body) {
    if (typeof body.isAvailable !== 'boolean') errors.isAvailable = MSG.boolean;
    else values.is_available = body.isAvailable ? 1 : 0;
  }
  if ('categoryId' in body) {
    const c = body.categoryId;
    if (c === null) values.category_id = null;
    else if (typeof c === 'string' && c.length > 0 && c.length <= 64) values.category_id = c;
    else errors.categoryId = 'Kategori tak sah.';
  }
  return { values, errors: Object.keys(errors).length ? errors : null };
}

export function validateCategoryName(value) {
  const name = typeof value === 'string' ? cleanText(value) : '';
  return name.length >= 1 && name.length <= LIMITS.categoryNameMax ? { value: name } : { error: MSG.namaKategori };
}

/**
 * Semak pasangan gambar produk yang baru dimuat naik: kedua-dua kunci mesti milik kedai ini, jenis betul,
 * wujud dalam R2, dan belum dipautkan kepada produk lain (supaya padam satu produk tak memadam gambar produk lain).
 * Pulangkan { bytes } atau { error: { status, code, message } }.
 */
export async function checkImagePair(env, shopId, imageKey, thumbKey, exceptProductId = '') {
  if (!isProductImageKeyOf(shopId, imageKey) || !isThumbKeyOf(shopId, thumbKey)) {
    return { error: { status: 400, code: 'gambar-tak-sah', message: 'Gambar produk tak sah.' } };
  }
  const used = await env.DB
    .prepare(
      `SELECT 1 AS x FROM products
       WHERE shop_id = ?1 AND id != ?2 AND (image_key IN (?3, ?4) OR thumb_key IN (?3, ?4)) LIMIT 1`,
    )
    .bind(shopId, exceptProductId, imageKey, thumbKey)
    .first();
  if (used) return { error: { status: 400, code: 'gambar-tak-sah', message: 'Gambar ini sudah digunakan oleh produk lain.' } };

  const [a, b] = await Promise.all([objectSize(env, imageKey), objectSize(env, thumbKey)]);
  if (a === null || b === null) {
    return { error: { status: 400, code: 'gambar-tiada', message: 'Gambar belum dimuat naik. Cuba muat naik semula.' } };
  }
  return { bytes: a + b };
}

/**
 * Susun semula: ids mesti sama tepat dengan set semasa (mengelak menimpa senarai yang sudah berubah di tab lain).
 * Hanya baris yang sort_order-nya berubah ditulis (jimat had tulis D1).
 */
export function reorderStatements(db, table, shopId, current, ids) {
  if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== ids.length) return null;
  const byId = new Map(current.map((r) => [r.id, r]));
  if (!ids.every((id) => typeof id === 'string' && byId.has(id))) return null;
  const statements = [];
  ids.forEach((id, index) => {
    if (byId.get(id).sort_order !== index) {
      statements.push(db.prepare(`UPDATE ${table} SET sort_order = ?1 WHERE id = ?2 AND shop_id = ?3`).bind(index, id, shopId));
    }
  });
  return statements;
}

export function limitMessage(what, max, plan) {
  const upsell = plan.code === 'free' ? ' Naik taraf ke Pro untuk had lebih tinggi.' : '';
  return `Had ${max} ${what} pelan ${plan.name} dicapai.${upsell}`;
}
