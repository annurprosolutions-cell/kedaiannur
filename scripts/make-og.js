// Jana public/assets/og-default.png (1200 x 630): gambar pratonton link lalai untuk landing dan kedai tanpa banner/logo.
// Guna:  node scripts/make-og.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const mark = `data:image/png;base64,${readFileSync(`${ROOT}public/assets/brand/annurpro-mark.png`).toString('base64')}`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:1200px;height:630px;display:flex;align-items:center;gap:56px;padding:0 96px;box-sizing:border-box;
    background:linear-gradient(135deg,#ffffff 0%,#f0fdfa 60%,#fef3c7 100%);font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;color:#0f1530">
    <img src="${mark}" width="300" height="300" style="flex:none">
    <div>
      <div style="font-size:30px;font-weight:700;letter-spacing:.12em;color:#0f766e">ANNURPRO</div>
      <div style="font-size:78px;font-weight:800;line-height:1.05;margin-top:8px">Kedai AnnurPro</div>
      <div style="font-size:36px;margin-top:20px;color:#4a5578">Katalog online, order terus ke WhatsApp</div>
    </div></body></html>`);
  await page.locator('img').evaluate((img) => img.decode());
  await page.screenshot({ path: `${ROOT}public/assets/og-default.png`, type: 'png' });
  console.log('public/assets/og-default.png');
} finally {
  await browser.close();
}
