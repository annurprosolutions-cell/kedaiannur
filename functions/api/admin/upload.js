// POST /api/admin/upload?kind=cover|inline (superadmin): gambar artikel yang sudah dimampatkan di browser.
// Disimpan di R2 sebagai articles/<uuid>.<ext>; gambar yang tak dirujuk dibersihkan selepas 6 jam.

import { fail, json } from '../../../lib/http.js';
import { ALLOWED_TYPES, CACHE_CONTROL, readCapped, sniffImage } from '../../../lib/media.js';
import { ARTICLE_UPLOAD_LIMITS, mediaBase, sweepArticleImages } from '../../../lib/articles.js';

export async function onRequestPost({ request, env, waitUntil }) {
  const kind = new URL(request.url).searchParams.get('kind');
  if (!Object.hasOwn(ARTICLE_UPLOAD_LIMITS, kind)) return fail(400, 'jenis-tidak-sah', 'Jenis muat naik tidak sah.');
  const max = ARTICLE_UPLOAD_LIMITS[kind];
  const tooBig = () => fail(413, 'gambar-terlalu-besar', `Gambar melebihi had ${Math.round(max / 1024)} KB selepas dimampatkan.`);
  const declared = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(declared)) return fail(415, 'jenis-gambar', 'Hanya gambar WebP atau JPEG diterima.');
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > max) return tooBig();
  const bytes = await readCapped(request, max);
  if (bytes === null) return tooBig();
  if (bytes.length === 0) return fail(400, 'gambar-kosong', 'Fail gambar kosong.');
  if (sniffImage(bytes) !== declared) return fail(415, 'jenis-gambar', 'Fail ini bukan gambar WebP atau JPEG yang sah.');

  const key = `articles/${crypto.randomUUID()}.${declared === 'image/jpeg' ? 'jpg' : 'webp'}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: declared, cacheControl: CACHE_CONTROL } });
  waitUntil(sweepArticleImages(env));
  return json({ ok: true, key, url: `${mediaBase(env)}/${key}`, bytes: bytes.length });
}
