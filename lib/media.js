// Muat naik gambar ke R2 (binding MEDIA): had saiz, semakan magic bytes, kunci objek dijana server.

export const UPLOAD_LIMITS = {
  product: 400 * 1024,
  thumb: 80 * 1024,
  banner: 500 * 1024,
};

export const ALLOWED_TYPES = new Set(['image/webp', 'image/jpeg']);
export const CACHE_CONTROL = 'public, max-age=31536000, immutable';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BANNER_SUFFIX = new RegExp(`^b_${UUID}\\.(webp|jpg)$`);

// Jenis sebenar fail berdasarkan beberapa bait pertama; null jika bukan JPEG atau WebP.
export function sniffImage(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // WEBP
  ) {
    return 'image/webp';
  }
  return null;
}

// Baca badan permintaan tetapi berhenti sebaik melebihi had (tidak memuatkan fail besar ke memori).
export async function readCapped(request, max) {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function newObjectKey(shopId, kind, type) {
  const ext = type === 'image/jpeg' ? 'jpg' : 'webp';
  const id = crypto.randomUUID();
  if (kind === 'banner') return `shops/${shopId}/b_${id}.${ext}`;
  if (kind === 'thumb') return `shops/${shopId}/${id}_t.${ext}`;
  return `shops/${shopId}/${id}.${ext}`;
}

export function isBannerKeyOf(shopId, key) {
  if (typeof key !== 'string') return false;
  const prefix = `shops/${shopId}/`;
  return key.startsWith(prefix) && BANNER_SUFFIX.test(key.slice(prefix.length));
}

// Saiz sebenar objek dalam R2 (tak percaya angka daripada client). null jika objek tiada.
export async function objectSize(env, key) {
  const head = await env.MEDIA.head(key);
  return head ? head.size : null;
}

// Padam objek lama. Gagal padam tak patut menggagalkan permintaan (objek yatim boleh dibersihkan kemudian).
export async function deleteObjects(env, keys) {
  if (!keys.length) return;
  try {
    await env.MEDIA.delete(keys);
  } catch (err) {
    console.error('Padam objek R2 gagal', keys, err && err.message ? err.message : err);
  }
}
