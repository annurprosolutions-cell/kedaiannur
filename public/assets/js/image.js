// Mampat gambar di browser sebelum dimuat naik (F-03, F-04). Gambar 5 MB dari phone menjadi ratusan KB.
// WebP dahulu; jika browser tak boleh menghasilkan WebP (Safari lama pulangkan PNG), guna JPEG.
// Had saiz sama dengan server (lib/media.js UPLOAD_LIMITS).

export const SPECS = {
  banner: { maxBytes: 500 * 1024, width: 1600, height: 800 }, // dipotong ke nisbah 2:1
  product: { maxBytes: 400 * 1024, maxSide: 1000 },
  thumb: { maxBytes: 80 * 1024, maxSide: 400 },
  logo: { maxBytes: 100 * 1024, maxSide: 512 },
  // Artikel (superadmin): gambar utama 1200 x 630 (saiz og:image), gambar dalam kandungan tanpa potongan.
  cover: { maxBytes: 300 * 1024, width: 1200, height: 630 },
  inline: { maxBytes: 300 * 1024, maxSide: 1200 },
};

const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const SCALES = [1, 0.85, 0.7, 0.55];
const QUALITIES = [0.82, 0.7, 0.58, 0.46];

export class ImageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImageError';
    this.code = code;
  }
}

function looksLikeImage(file) {
  return /^image\//.test(file.type) || (!file.type && /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name || ''));
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* Safari lama tak sokong pilihan; cuba tanpa pilihan */
    }
    try {
      return await createImageBitmap(file);
    } catch {
      /* jatuh ke elemen img */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new ImageError('gagal-baca', 'Gambar tak dapat dibaca. Cuba gambar lain.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

let webpWorks = null; // diketahui selepas percubaan pertama

async function encode(canvas, quality) {
  if (webpWorks !== false) {
    const blob = await toBlob(canvas, 'image/webp', quality);
    if (blob && blob.type === 'image/webp') {
      webpWorks = true;
      return blob;
    }
    webpWorks = false;
  }
  const jpeg = await toBlob(canvas, 'image/jpeg', quality);
  if (!jpeg) throw new ImageError('gagal-mampat', 'Gambar tak dapat dimampatkan. Cuba gambar lain.');
  return jpeg;
}

// Nisbah bingkai potongan setiap jenis (lebar / tinggi). Halaman kedai papar produk 1:1 dan banner 2:1.
export const ASPECT = { banner: 2, product: 1, thumb: 1, logo: 1, cover: 1200 / 630 };

// Potongan lalai: kawasan terbesar di tengah dengan nisbah jenis itu (sama seperti object-fit: cover).
export function centerCrop(kind, srcW, srcH) {
  if (kind === 'inline') return { sx: 0, sy: 0, sw: srcW, sh: srcH }; // gambar penuh, tiada potongan
  const a = ASPECT[kind] || 1;
  let sw = srcW;
  let sh = srcH;
  if (srcW / srcH > a) sw = Math.round(srcH * a);
  else sh = Math.round(srcW / a);
  return { sx: Math.round((srcW - sw) / 2), sy: Math.round((srcH - sh) / 2), sw, sh };
}

// Kawasan sumber dan saiz sasaran penuh mengikut jenis. crop (pilihan) datang daripada cropper.
function plan(kind, srcW, srcH, crop) {
  const spec = SPECS[kind];
  const c = crop ? clampCrop(crop, srcW, srcH) : centerCrop(kind, srcW, srcH);
  if (spec.width && spec.height) {
    const outW = Math.min(spec.width, c.sw);
    return { ...c, outW, outH: Math.max(1, Math.round((outW * spec.height) / spec.width)) };
  }
  const ratio = Math.min(1, spec.maxSide / Math.max(c.sw, c.sh));
  return { ...c, outW: Math.max(1, Math.round(c.sw * ratio)), outH: Math.max(1, Math.round(c.sh * ratio)) };
}

function clampCrop(c, srcW, srcH) {
  const sw = Math.max(1, Math.min(srcW, Math.round(c.sw)));
  const sh = Math.max(1, Math.min(srcH, Math.round(c.sh)));
  const sx = Math.max(0, Math.min(srcW - sw, Math.round(c.sx)));
  const sy = Math.max(0, Math.min(srcH - sh, Math.round(c.sy)));
  return { sx, sy, sw, sh };
}

/** Semak dan baca fail gambar. Pemanggil mesti memanggil releaseImage() selepas selesai. */
export async function readImage(file) {
  if (!file || !looksLikeImage(file)) throw new ImageError('bukan-gambar', 'Fail ini bukan gambar. Pilih gambar JPG, PNG atau WebP.');
  if (file.size > MAX_INPUT_BYTES) throw new ImageError('terlalu-besar-asal', 'Gambar terlalu besar (maksimum 30 MB). Pilih gambar lain.');
  const bitmap = await decode(file);
  if (!bitmap.width || !bitmap.height) {
    releaseImage(bitmap);
    throw new ImageError('gagal-baca', 'Gambar tak dapat dibaca. Cuba gambar lain.');
  }
  return bitmap;
}

export function releaseImage(bitmap) {
  if (bitmap && typeof bitmap.close === 'function') bitmap.close();
}

/**
 * Mampat gambar yang sudah dibaca. crop = { sx, sy, sw, sh } dalam piksel sumber (daripada cropper), atau kosong
 * untuk potongan tengah.
 * @returns {Promise<{ blob: Blob, type: string, width: number, height: number }>}
 */
export async function compressBitmap(bitmap, kind, crop) {
  const spec = SPECS[kind];
  if (!spec) throw new Error(`Jenis gambar tak dikenali: ${kind}`);
  const p = plan(kind, bitmap.width, bitmap.height, crop);
  for (const scale of SCALES) {
    const w = Math.max(1, Math.round(p.outW * scale));
    const h = Math.max(1, Math.round(p.outH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff'; // PNG lut sinar menjadi latar putih (JPEG tiada alfa)
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, p.sx, p.sy, p.sw, p.sh, 0, 0, w, h);
    for (const q of QUALITIES) {
      const blob = await encode(canvas, q);
      if (blob.size <= spec.maxBytes) return { blob, type: blob.type, width: w, height: h };
    }
  }
  throw new ImageError('terlalu-besar', 'Gambar masih terlalu besar selepas dimampatkan. Cuba gambar lain.');
}

/**
 * Baca dan mampat dalam satu langkah (potongan tengah atau crop yang diberi).
 * @param {File|Blob} file
 * @param {'banner'|'product'|'thumb'} kind
 */
export async function compressImage(file, kind, crop) {
  if (!SPECS[kind]) throw new Error(`Jenis gambar tak dikenali: ${kind}`);
  const bitmap = await readImage(file);
  try {
    return await compressBitmap(bitmap, kind, crop);
  } finally {
    releaseImage(bitmap);
  }
}
