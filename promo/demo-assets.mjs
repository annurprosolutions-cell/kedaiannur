// Jana gambar demo (6 produk 1000x1000, banner 1600x800, logo 512) untuk kedai "contoh". Guna: node demo-assets.mjs <folder>
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const DIR = fileURLToPath(new URL('.', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(DIR, url === '/' ? 'demo-assets.html' : url));
  if (!file.startsWith(DIR) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[halaman]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.ready === true);
const assets = await page.evaluate(() => window.assets);
for (const [name, url] of Object.entries(assets)) {
  const buf = Buffer.from(url.split(',')[1], 'base64');
  writeFileSync(join(out, `${name}.webp`), buf);
  console.log(name, Math.round(buf.length / 1024), 'KB');
}
await browser.close();
server.close();
