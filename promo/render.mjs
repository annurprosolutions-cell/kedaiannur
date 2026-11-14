// Rakam video frame demi frame: pelayan statik kecil + Chromium (WebGL perisian) memanggil window.renderFrame(t).
//
// Guna:
//   node render.mjs frames <folder> [--from 0] [--to 1800] [--workers 3]   jana JPEG setiap frame
//   node render.mjs stills <folder> 5.5,12.3,...                           jana beberapa frame untuk semakan
// Kemudian audio.py dan ffmpeg (lihat README.md).

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const DIR = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(DIR, '..', 'public', 'assets');
const TL = JSON.parse((await import('node:fs')).readFileSync(join(DIR, 'timeline.json'), 'utf8'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };

function serve() {
  const roots = [['/vendor/', join(PUBLIC, 'vendor')], ['/brand/', join(PUBLIC, 'brand')], ['/', DIR]];
  const server = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const [prefix, root] = roots.find(([p]) => url.startsWith(p));
    const file = normalize(join(root, url.slice(prefix.length) || 'index.html'));
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function openPage(browser, port) {
  const page = await browser.newPage({ viewport: { width: 400, height: 700 } });
  page.on('pageerror', (e) => console.error('[halaman]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('[konsol]', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
  return page;
}

const [mode, outDir, ...rest] = process.argv.slice(2);
const opt = (n, d) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? Number(rest[i + 1]) : d; };
mkdirSync(outDir, { recursive: true });
const server = await serve();
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'] });

async function grab(page, t, file) {
  const url = await page.evaluate((tt) => window.renderFrame(tt), t);
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
}

if (mode === 'stills') {
  const page = await openPage(browser, port);
  for (const t of rest[0].split(',').map(Number)) { await grab(page, t, join(outDir, `t${String(t).replace('.', '_')}.jpg`)); console.log('still', t); }
} else {
  const total = Math.round(TL.duration * TL.fps);
  const from = opt('from', 0);
  const to = Math.min(opt('to', total), total);
  const workers = opt('workers', 2);
  const pages = await Promise.all(Array.from({ length: workers }, () => openPage(browser, port)));
  let next = from;
  const t0 = Date.now();
  await Promise.all(pages.map(async (page) => {
    for (;;) {
      const i = next++;
      if (i >= to) return;
      await grab(page, i / TL.fps, join(outDir, `f${String(i).padStart(5, '0')}.jpg`));
      if (i % 30 === 0) console.log(`frame ${i}/${to} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  }));
}
await browser.close();
server.close();
