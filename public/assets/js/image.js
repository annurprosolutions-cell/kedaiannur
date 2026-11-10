// Mampat gambar di browser sebelum dimuat naik (F-03, F-04). Gambar 5 MB dari phone menjadi ratusan KB.
// WebP dahulu; jika browser tak boleh menghasilkan WebP (Safari lama pulangkan PNG), guna JPEG.
// Had saiz sama dengan server (lib/media.js UPLOAD_LIMITS).

export const SPECS = {
  banner: { maxBytes: 500 * 1024, width: 1600, height: 800 }, // dipotong ke nisbah 2:1
  product: { maxBytes: 400 * 1024, maxSide: 1000 },
  thumb: { maxBytes: 80 * 1024, maxSide: 400 },
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

// Kawasan sumber dan saiz sasaran penuh mengikut jenis.
function plan(kind, srcW, srcH) {
  const spec = SPECS[kind];
  if (kind === 'banner') {
    let sw = srcW;
    let sh = srcH;
    if (srcW / srcH > 2) sw = Math.round(srcH * 2);
    else sh = Math.round(srcW / 2);
    const outW = Math.min(spec.width, sw);
    return { sx: Math.round((srcW - sw) / 2), sy: Math.round((srcH - sh) / 2), sw, sh, outW, outH: Math.round(outW / 2) };
  }
  const ratio = Math.min(1, spec.maxSide / Math.max(srcW, srcH));
  return { sx: 0, sy: 0, sw: srcW, sh: srcH, outW: Math.max(1, Math.round(srcW * ratio)), outH: Math.max(1, Math.round(srcH * ratio)) };
}

/**
 * @param {File|Blob} file
 * @param {'banner'|'product'|'thumb'} kind
 * @returns {Promise<{ blob: Blob, type: string, width: number, height: number }>}
 */
export async function compressImage(file, kind) {
  const spec = SPECS[kind];
  if (!spec) throw new Error(`Jenis gambar tak dikenali: ${kind}`);
  if (!file || !looksLikeImage(file)) throw new ImageError('bukan-gambar', 'Fail ini bukan gambar. Pilih gambar JPG, PNG atau WebP.');
  if (file.size > MAX_INPUT_BYTES) throw new ImageError('terlalu-besar-asal', 'Gambar terlalu besar (maksimum 30 MB). Pilih gambar lain.');

  const bitmap = await decode(file);
  try {
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    if (!srcW || !srcH) throw new ImageError('gagal-baca', 'Gambar tak dapat dibaca. Cuba gambar lain.');
    const p = plan(kind, srcW, srcH);

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
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}
