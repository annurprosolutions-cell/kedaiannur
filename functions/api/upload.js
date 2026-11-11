// POST /api/upload?kind=product|thumb|banner
// Badan = fail gambar mentah (image/webp atau image/jpeg) yang sudah dimampatkan di browser.
// Kunci objek dijana server. Saiz storage dikira pada masa gambar dipautkan (produk atau banner), bukan di sini.

import { fail, json } from '../../lib/http.js';
import { ownerShop } from '../../lib/shop.js';
import { formatMb } from '../../lib/plan.js';
import {
  ALLOWED_TYPES, CACHE_CONTROL, UPLOAD_LIMITS, newObjectKey, readCapped, sniffImage, sweepOrphans,
} from '../../lib/media.js';

export async function onRequestPost({ request, env, data, waitUntil }) {
  const { shop, plan, error } = await ownerShop(env, data.user, { writable: true });
  if (error) return error;

  const kind = new URL(request.url).searchParams.get('kind');
  if (!Object.hasOwn(UPLOAD_LIMITS, kind)) return fail(400, 'jenis-tidak-sah', 'Jenis muat naik tidak sah.');
  const max = UPLOAD_LIMITS[kind];
  const tooBig = () => fail(413, 'gambar-terlalu-besar', `Gambar melebihi had ${Math.round(max / 1024)} KB selepas dimampatkan.`);

  const declared = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(declared)) return fail(415, 'jenis-gambar', 'Hanya gambar WebP atau JPEG diterima.');

  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > max) return tooBig();

  const bytes = await readCapped(request, max);
  if (bytes === null) return tooBig();
  if (bytes.length === 0) return fail(400, 'gambar-kosong', 'Fail gambar kosong.');

  // Jangan percaya header Content-Type: semak bait sebenar.
  if (sniffImage(bytes) !== declared) return fail(415, 'jenis-gambar', 'Fail ini bukan gambar WebP atau JPEG yang sah.');

  if (shop.storage_bytes + bytes.length > plan.max_storage_bytes) {
    return fail(409, 'had-storage', `Had storage gambar ${formatMb(plan.max_storage_bytes)} pelan ${plan.name} dicapai.`);
  }

  const key = newObjectKey(shop.id, kind, declared);
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: declared, cacheControl: CACHE_CONTROL } });
  // Bersihkan gambar yang dimuat naik lebih 6 jam lalu tetapi tak pernah dipautkan (selepas respons dihantar).
  waitUntil(sweepOrphans(env, shop.id));
  return json({ ok: true, key, bytes: bytes.length, type: declared });
}
