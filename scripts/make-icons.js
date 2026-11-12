// Jana ikon jenama daripada simbol "A" AnnurPro (public/assets/brand/annurpro-mark.png, latar lut sinar).
// Guna:  node scripts/make-icons.js
// Hasil:
//   public/assets/icons/icon-192.png, icon-512.png   (purpose any: jubin putih bersudut bulat)
//   public/assets/icons/maskable-512.png            (penuh putih, simbol dalam zon selamat 80%)
//   public/assets/icons/apple-touch-icon.png        (180 px, penuh putih; iOS membulatkan sendiri)
//   public/assets/brand/annurpro-mark-64.webp       (tanda di header laman)
//   public/favicon.svg                              (SVG dengan PNG 64 px terbenam; laluan kekal sama)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MARK = `data:image/png;base64,${readFileSync(`${ROOT}public/assets/brand/annurpro-mark.png`).toString('base64')}`;

// size: saiz kanvas; scale: lebar simbol berbanding kanvas; radius: sudut jubin (0 = penuh); bg: null = lut sinar.
const JOBS = [
  { out: 'public/assets/icons/icon-192.png', size: 192, scale: 0.78, radius: 0.22, bg: '#ffffff' },
  { out: 'public/assets/icons/icon-512.png', size: 512, scale: 0.78, radius: 0.22, bg: '#ffffff' },
  { out: 'public/assets/icons/maskable-512.png', size: 512, scale: 0.6, radius: 0, bg: '#ffffff' },
  { out: 'public/assets/icons/apple-touch-icon.png', size: 180, scale: 0.72, radius: 0, bg: '#ffffff' },
  { out: 'public/assets/brand/annurpro-mark-64.webp', size: 64, scale: 1, radius: 0, bg: null, type: 'image/webp' },
  { out: 'favicon-64', size: 64, scale: 0.92, radius: 0, bg: null },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  for (const job of JOBS) {
    const b64 = await page.evaluate(async ({ src, size, scale, radius, bg, type }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      if (bg) {
        const r = size * radius;
        x.fillStyle = bg;
        x.beginPath();
        x.roundRect(0, 0, size, size, r);
        x.fill();
      }
      const s = size * scale;
      x.drawImage(img, (size - s) / 2, (size - s) / 2, s, s);
      const blob = await new Promise((res) => c.toBlob(res, type || 'image/png', 0.9));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(bin);
    }, { src: MARK, ...job });
    if (job.out === 'favicon-64') {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,${b64}"/></svg>\n`;
      writeFileSync(`${ROOT}public/favicon.svg`, svg);
      console.log('public/favicon.svg', svg.length, 'B');
    } else {
      const buf = Buffer.from(b64, 'base64');
      writeFileSync(`${ROOT}${job.out}`, buf);
      console.log(job.out, buf.length, 'B');
    }
  }
} finally {
  await browser.close();
}
