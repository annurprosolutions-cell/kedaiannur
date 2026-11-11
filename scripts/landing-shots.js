// Jana tangkapan skrin sebenar aplikasi untuk landing page (public/assets/img/landing/*.webp).
// Jalankan `wrangler pages dev` dengan D1 dan R2 local, isi satu kedai demo, ambil gambar dengan Playwright
// pada saiz phone (360 px, skala 2), kemudian tukar ke WebP. Gambar produk dilukis dengan emoji di canvas.
//
// Guna:  node scripts/landing-shots.js
// Pilihan env: WRANGLER_BIN=<path ke wrangler.js>  SHOTS_TMP=<folder sementara>

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'public/assets/img/landing');
const PORT = Number(process.env.SHOTS_PORT || 8798);
const BASE = `http://127.0.0.1:${PORT}`;
const MEDIA = 'https://media.annurpro.com';
const wranglerCmd = process.env.WRANGLER_BIN
  ? [process.execPath, [process.env.WRANGLER_BIN]]
  : ['npx', ['--yes', 'wrangler@4']];

const TOKEN = 'D'.repeat(43);
const ADMIN = 'Z'.repeat(43);
const sha = (t) => createHash('sha256').update(t).digest('hex');
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const SHOP = 's-demo';
const CATS = [
  { id: 'c1', name: 'Kuih' },
  { id: 'c2', name: 'Kek' },
  { id: 'c3', name: 'Minuman' },
];
const PRODUCTS = [
  { name: 'Karipap Pusing (10 biji)', price: 1000, cat: 'c1', emoji: '🥟', bg: ['#fde68a', '#f59e0b'], desc: 'Inti kentang dan ayam, digoreng pagi.' },
  { name: 'Kuih Lapis Pelangi', price: 800, cat: 'c1', emoji: '🍡', bg: ['#fbcfe8', '#ec4899'], desc: 'Satu bekas 12 keping.' },
  { name: 'Onde-onde Gula Melaka', price: 600, cat: 'c1', emoji: '🟢', bg: ['#bbf7d0', '#22c55e'], desc: '' },
  { name: 'Kek Batik Coklat', price: 3500, cat: 'c2', emoji: '🍫', bg: ['#e7c9a9', '#92400e'], desc: 'Loyang 8 inci.' },
  { name: 'Kek Lapis Sarawak', price: null, cat: 'c2', emoji: '🍰', bg: ['#fecaca', '#dc2626'], desc: 'Tempahan khas, harga ikut saiz.' },
  { name: 'Teh Tarik Botol', price: 450, cat: 'c3', emoji: '🧋', bg: ['#fed7aa', '#c2410c'], desc: '' },
];

function wrangler(args, opts = {}) {
  const [cmd, base] = wranglerCmd;
  return execFileSync(cmd, [...base, ...args], { env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'pipe', ...opts });
}

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/ping`)).ok) return;
    } catch {
      /* belum siap */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('wrangler pages dev tak hidup');
}

// Lukis gambar di browser dan pulangkan bait WebP.
async function drawImage(page, { w, h, emoji, bg, title, sub }) {
  const b64 = await page.evaluate(async ({ w, h, emoji, bg, title, sub }) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, bg[0]);
    g.addColorStop(1, bg[1]);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    if (title) {
      x.fillStyle = '#fff';
      x.font = `800 ${Math.round(h * 0.11)}px system-ui, sans-serif`;
      x.fillText(title, w * 0.4, h * 0.42);
      x.font = `600 ${Math.round(h * 0.065)}px system-ui, sans-serif`;
      x.fillText(sub, w * 0.4, h * 0.6);
      x.font = `${Math.round(h * 0.3)}px "Noto Color Emoji"`;
      x.fillText(emoji, w * 0.84, h * 0.52);
    } else {
      x.font = `${Math.round(h * 0.55)}px "Noto Color Emoji"`;
      x.fillText(emoji, w / 2, h * 0.54);
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  }, { w, h, emoji, bg, title, sub });
  return Buffer.from(b64, 'base64');
}

// Tukar PNG tangkapan skrin kepada WebP (kualiti 0.8) melalui canvas.
async function toWebp(page, png) {
  const b64 = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  }, png.toString('base64'));
  return Buffer.from(b64, 'base64');
}

async function main() {
  const tmp = mkdtempSync(join(process.env.SHOTS_TMP || tmpdir(), 'kedai-shots-'));
  const cfgDir = join(tmp, 'cfg');
  const state = join(tmp, 'state');
  mkdirSync(cfgDir);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(cfgDir, 'wrangler.toml'),
    'name = "kedai-shots"\ncompatibility_date = "2025-09-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "kedai-db"\ndatabase_id = "kedai-db-shots"\n[[r2_buckets]]\nbinding = "MEDIA"\nbucket_name = "kedai-media"\n',
  );

  const browser = await chromium.launch();
  let server;
  try {
    // 1. Lukis gambar produk dan banner, simpan ke R2 local.
    const draw = await (await browser.newContext()).newPage();
    const media = new Map();
    const put = (key, bytes) => {
      media.set(key, bytes);
      const f = join(tmp, `${randomUUID()}.webp`);
      writeFileSync(f, bytes);
      wrangler(['r2', 'object', 'put', `kedai-media/${key}`, '--local', '--persist-to', state, '--file', f, '--content-type', 'image/webp'], { cwd: cfgDir });
    };
    const rows = [];
    for (const [i, p] of PRODUCTS.entries()) {
      const id = randomUUID();
      const image = `shops/${SHOP}/${id}.webp`;
      const thumb = `shops/${SHOP}/${id}_t.webp`;
      const big = await drawImage(draw, { w: 800, h: 800, emoji: p.emoji, bg: p.bg });
      const small = await drawImage(draw, { w: 240, h: 240, emoji: p.emoji, bg: p.bg });
      put(image, big);
      put(thumb, small);
      rows.push(`(${q(`p${i}`)}, ${q(SHOP)}, ${q(p.cat)}, ${q(p.name)}, ${q(p.desc)}, ${p.price ?? 'NULL'}, ${q(image)}, ${q(thumb)}, ${big.length + small.length}, ${i})`);
    }
    const bannerKey = `shops/${SHOP}/b_${randomUUID()}.webp`;
    const banner = await drawImage(draw, { w: 1200, h: 600, emoji: '🥟', bg: ['#0f766e', '#14b8a6'], title: 'Tempahan Raya dibuka', sub: 'Pesan sebelum 20 hb' });
    put(bannerKey, banner);

    const seed = `${readFileSync(join(ROOT, 'db/0001_init.sql'), 'utf8')}
INSERT INTO users (id, google_sub, email, name) VALUES ('u-d', 'sub-d', 'demo@contoh.test', 'Mak Teh'), ('u-z', 'sub-z', 'admin@contoh.test', 'Admin');
INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('${sha(TOKEN)}', 'u-d', datetime('now', '+1 day')), ('${sha(ADMIN)}', 'u-z', datetime('now', '+1 day'));
INSERT INTO shops (id, owner_user_id, slug, name, whatsapp, description, plan_code, plan_expires_at, storage_bytes) VALUES
  (${q(SHOP)}, 'u-d', 'kuih-mak-teh', 'Kuih Mak Teh', '60123456789', 'Kuih tradisional buatan sendiri di Shah Alam. Order sebelum 9 malam untuk esok pagi.', 'pro', date('now', '+300 days'), 0);
INSERT INTO shop_banners (id, shop_id, image_key, bytes, sort_order) VALUES ('b1', ${q(SHOP)}, ${q(bannerKey)}, ${banner.length}, 0);
INSERT INTO categories (id, shop_id, name, sort_order) VALUES ${CATS.map((c, i) => `(${q(c.id)}, ${q(SHOP)}, ${q(c.name)}, ${i})`).join(', ')};
INSERT INTO products (id, shop_id, category_id, name, description, price_sen, image_key, thumb_key, bytes, sort_order) VALUES ${rows.join(', ')};
UPDATE shops SET storage_bytes = (SELECT SUM(bytes) FROM products) + ${banner.length};
`;
    writeFileSync(join(tmp, 'seed.sql'), seed);
    wrangler(['d1', 'execute', 'kedai-db', '--local', '--persist-to', state, '--file', join(tmp, 'seed.sql')], { cwd: cfgDir });

    // 2. Hidupkan pelayan dan bina snapshot katalog.
    const [cmd, base] = wranglerCmd;
    server = spawn(
      cmd,
      [
        ...base, 'pages', 'dev', 'public', '--port', String(PORT), '--ip', '127.0.0.1',
        '--compatibility-date', '2025-09-01', '--d1', 'DB=kedai-db-shots', '--r2', 'MEDIA=kedai-media', '--persist-to', state,
        '--binding', 'GOOGLE_CLIENT_ID=shots.apps.googleusercontent.com',
        '--binding', 'SUPERADMIN_EMAILS=admin@contoh.test',
        '--binding', `MEDIA_BASE_URL=${MEDIA}`,
      ],
      { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'ignore', detached: true },
    );
    await waitUp();
    const rebuilt = await fetch(`${BASE}/api/admin/rebuild-catalogs`, {
      method: 'POST',
      headers: { Cookie: `__Host-sid=${ADMIN}`, Origin: BASE, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!rebuilt.ok) throw new Error(`rebuild ${rebuilt.status}`);

    // 3. Ambil tangkapan skrin pada phone 360 x 740, skala 2.
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
    await context.addCookies([{ name: '__Host-sid', value: TOKEN, domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(`${MEDIA}/`)) {
        const bytes = media.get(decodeURIComponent(new URL(url).pathname.slice(1)));
        return bytes ? route.fulfill({ contentType: 'image/webp', body: bytes }) : route.fulfill({ status: 404, body: '' });
      }
      if (url.startsWith(BASE)) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    const save = async (name) => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const webp = await toWebp(draw, await page.screenshot());
      writeFileSync(join(OUT, `${name}.webp`), webp);
      console.log(`${name}.webp ${Math.round(webp.length / 1024)} KB`);
    };

    await page.goto(`${BASE}/kuih-mak-teh`);
    await page.locator('.shop-grid img').first().waitFor();
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    await save('kedai');

    // Troli dengan beberapa item, kemudian borang hantar order.
    for (const n of [0, 0, 1, 3]) await page.locator('.p-add').nth(n).click();
    await page.locator('.cart-bar').click();
    await page.getByRole('dialog').waitFor();
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    await page.waitForTimeout(400);
    await save('troli');

    await page.getByRole('button', { name: 'Teruskan' }).click();
    const nama = page.getByLabel(/Nama/).first();
    await nama.waitFor();
    await nama.fill('Aisyah');
    await page.locator('.msg-preview').waitFor();
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    await page.waitForTimeout(300);
    await save('hantar');

    await page.goto(`${BASE}/app/`);
    await page.locator('.meter-bar').first().waitFor();
    // Papar link seperti di produksi, bukan alamat pelayan ujian.
    await page.evaluate((host) => {
      for (const el of document.querySelectorAll('.shop-link')) el.textContent = el.textContent.replace(host, 'kedai.annurpro.com');
    }, `127.0.0.1:${PORT}`);
    await save('dashboard');

    await page.goto(`${BASE}/app/#/produk`);
    await page.locator('.product-row').first().waitFor();
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    await save('produk');
    await context.close();
  } finally {
    await browser.close();
    if (server) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        /* sudah mati */
      }
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
