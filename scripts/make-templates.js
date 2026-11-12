// Jana templat banner untuk peniaga: public/assets/templates/templat-banner-1600x800.png
// Menunjukkan saiz sebenar (1600 x 800, nisbah 2:1), zon selamat untuk teks, dan kawasan yang mungkin dilindungi logo kedai.
// Guna:  node scripts/make-templates.js

import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:1600px;height:800px;position:relative;overflow:hidden;
    font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;color:#334155;
    background-color:#f1f5f9;background-image:linear-gradient(#e2e8f0 1px,transparent 1px),linear-gradient(90deg,#e2e8f0 1px,transparent 1px);background-size:100px 100px">
    <div style="position:absolute;inset:60px 120px 200px 120px;border:4px dashed #0f766e;border-radius:12px;display:flex;align-items:center;justify-content:center;text-align:center">
      <div>
        <div style="font-size:64px;font-weight:800;color:#0f172a">Banner 1600 x 800 piksel</div>
        <div style="font-size:34px;margin-top:16px">Nisbah 2:1. Letak tajuk dan teks penting di dalam garisan putus-putus.</div>
        <div style="font-size:28px;margin-top:12px;color:#64748b">Simpan sebagai JPG atau PNG. Sistem memampat sendiri.</div>
      </div>
    </div>
    <div style="position:absolute;left:40px;bottom:0;width:340px;height:170px;background:rgba(190,18,60,.12);border:4px solid rgba(190,18,60,.6);border-bottom:0;
      border-radius:20px 20px 0 0;display:flex;align-items:center;justify-content:center;text-align:center;font-size:26px;font-weight:700;color:#9f1239">
      Kawasan logo kedai<br>(elak teks di sini)
    </div>
    <div style="position:absolute;right:24px;top:20px;font-size:24px;color:#64748b">Templat Kedai AnnurPro</div>
  </body></html>`);
  const out = `${ROOT}public/assets/templates/templat-banner-1600x800.png`;
  await page.screenshot({ path: out, type: 'png' });
  console.log(out);
} finally {
  await browser.close();
}
