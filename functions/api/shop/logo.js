// PUT /api/shop/logo  { key: "shops/<id>/l_<uuid>.webp" | null }
// Tetapkan atau buang logo kedai (semua pelan). Gambar dimuat naik dahulu melalui /api/upload?kind=logo.
// Pro: logo juga menjadi favicon dan ikon skrin utama halaman kedai (snapshot `fav`).

import { fail, json, readJson } from '../../../lib/http.js';
import { ownerShop } from '../../../lib/shop.js';
import { formatMb } from '../../../lib/plan.js';
import { deleteObjects, isLogoKeyOf, objectSize } from '../../../lib/media.js';
import { CATALOG_FAIL, publishSnapshot } from '../../../lib/catalog.js';

export async function onRequestPut({ request, env, data }) {
  const parsed = await readJson(request);
  const key = parsed.value ? parsed.value.key : undefined;
  if (parsed.error || (key !== null && typeof key !== 'string')) return fail(400, 'badan-tidak-sah', 'Format permintaan tidak sah.');

  const { shop, plan, error } = await ownerShop(env, data.user, { writable: true });
  if (error) return error;
  if (key === shop.logo_key) return json({ ok: true, logoKey: shop.logo_key, storageBytes: shop.storage_bytes });

  let bytes = 0;
  if (key !== null) {
    // Pemilikan: hanya objek logo di bawah awalan kedai sendiri; saiz sebenar daripada R2.
    if (!isLogoKeyOf(shop.id, key)) return fail(400, 'gambar-tak-sah', 'Gambar logo tak sah.');
    bytes = await objectSize(env, key);
    if (bytes === null) return fail(400, 'gambar-tiada', 'Gambar belum dimuat naik. Cuba muat naik semula.');
    if (shop.storage_bytes - (shop.logo_bytes || 0) + bytes > plan.max_storage_bytes) {
      return fail(409, 'had-storage', `Had storage gambar ${formatMb(plan.max_storage_bytes)} pelan ${plan.name} dicapai.`);
    }
  }

  const db = env.DB;
  // Syarat logo_key lama dalam WHERE: dua permintaan serentak tak boleh mengira storage dua kali.
  const res = await db
    .prepare(
      `UPDATE shops SET logo_key = ?1, logo_bytes = ?2, storage_bytes = MAX(0, storage_bytes - logo_bytes + ?2), updated_at = datetime('now')
       WHERE id = ?3 AND logo_key IS ?4`,
    )
    .bind(key, bytes, shop.id, shop.logo_key)
    .run();
  if (!res.meta.changes) return fail(409, 'berubah', 'Logo baru sahaja diubah. Muat semula dan cuba lagi.');

  if (shop.logo_key) await deleteObjects(env, [shop.logo_key]);
  if (!(await publishSnapshot(env, shop.id))) return fail(500, CATALOG_FAIL.code, CATALOG_FAIL.message);
  const fresh = await db.prepare('SELECT logo_key, storage_bytes FROM shops WHERE id = ?1').bind(shop.id).first();
  return json({ ok: true, logoKey: fresh.logo_key, storageBytes: fresh.storage_bytes });
}
