// Jana ikon PWA (PNG) daripada logo kedai dalam public/favicon.svg guna Chromium (Playwright).
// Guna:  node scripts/make-icons.js
// Hasil: public/assets/icons/icon-192.png, icon-512.png (sudut bulat), maskable-512.png dan apple-touch-icon.png (penuh, tanpa sudut).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const OUT = fileURLToPath(new URL('../public/assets/icons', import.meta.url));
const BG = '#0F766E';
const GLYPH = 'M7 13l2-5h14l2 5M7 13v11h18V13M7 13c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3M13 24v-5h6v5';

// scale: nisbah logo berbanding kanvas. Maskable mesti muat dalam zon selamat (bulatan 80%), jadi kecilkan.
function svg({ size, rounded, scale }) {
  const g = 32 * scale;
  const off = (32 - g) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  ${rounded ? `<rect width="32" height="32" rx="7" fill="${BG}"/>` : `<rect width="32" height="32" fill="${BG}"/>`}
  <g transform="translate(${off} ${off}) scale(${scale})"><path d="${GLYPH}" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></g>
</svg>`;
}

const JOBS = [
  { file: 'icon-192.png', size: 192, rounded: true, scale: 0.8 },
  { file: 'icon-512.png', size: 512, rounded: true, scale: 0.8 },
  { file: 'maskable-512.png', size: 512, rounded: false, scale: 0.58 },
  { file: 'apple-touch-icon.png', size: 180, rounded: false, scale: 0.66 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const job of JOBS) {
    const page = await browser.newPage({ viewport: { width: job.size, height: job.size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg(job)}`);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: job.size, height: job.size } });
    writeFileSync(join(OUT, job.file), png);
    console.log(job.file, png.length, 'B');
    await page.close();
  }
} finally {
  await browser.close();
}
