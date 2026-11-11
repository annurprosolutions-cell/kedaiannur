// Ujian hujung ke hujung: jalankan `wrangler pages dev` (runtime Cloudflare sebenar, D1 dan R2 local),
// kemudian pandu Chromium melalui Playwright. Butang Google dipalsukan; sesi disuntik terus ke D1
// kerana token Google sebenar tak boleh dijana dalam ujian (laluan token diuji dalam tests/*.test.js).
//
// Guna:  npm run test:e2e
// Pilihan env: WRANGLER_BIN=<path ke wrangler.js>  E2E_TMP=<folder sementara>  E2E_SHOTS=<folder screenshot>

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.E2E_PORT || 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.E2E_SHOTS || '';
const MEDIA = 'https://media.annurpro.com';

const wranglerCmd = process.env.WRANGLER_BIN
  ? [process.execPath, [process.env.WRANGLER_BIN]]
  : ['npx', ['--yes', 'wrangler@4']];

const token = (c) => c.repeat(43);
const sha = (t) => createHash('sha256').update(t).digest('hex');
const TOKEN_A = token('A'); // pengguna tanpa kedai, nama mengandungi HTML (ujian XSS dan logout)
const TOKEN_B = token('B'); // pengguna dengan kedai (dashboard)
const TOKEN_W = token('W'); // pengguna tanpa kedai untuk wizard
const TOKEN_E = token('E'); // pengguna dengan kedai untuk ujian tetapan dan banner
const TOKEN_P = token('P'); // pengguna dengan kedai untuk ujian produk dan kategori (Fasa 3)
const TOKEN_R = token('R'); // pengguna dengan kedai Pro yang tamat dalam 10 hari (Fasa 5)
const TOKEN_M = token('M'); // superadmin (Fasa 7); e-mel dalam SUPERADMIN_EMAILS
const TOKEN_X = token('X'); // pengguna dengan kedai yang akan dipadam (Fasa 8)
const TOKEN_F = token('F'); // pengguna dengan kedai Percuma yang membayar melalui BCL (Fasa 6)
const BCL_KEY = 'e2e'.repeat(16);
const BCL_PORT = PORT + 50;
const BCL_FORM_URL = 'https://annurprosolutions1.bcl.my/form/kedai-annurpro-pro';
const bclTx = {}; // transaksi yang dipulangkan oleh API BCL palsu
const PADAM_IMG = 'shops/s-x/11111111-2222-4333-8444-555555555555.webp';
const XSS_NAME = '<img src=x onerror="window.__xss=1">';
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let tmp;
let state;
let cfgDir;
let server;
let browser;
let bclServer;
let bigJpeg; // laluan fail JPEG >= 5 MB
const consoleProblems = [];
const openPages = [];

function wrangler(args, opts = {}) {
  const [cmd, base] = wranglerCmd;
  return execFileSync(cmd, [...base, ...args], { env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'pipe', ...opts });
}

// Baca objek terus daripada R2 local (bukan melalui aplikasi) untuk mengesahkan apa yang benar-benar disimpan.
function r2Get(key) {
  const out = join(tmp, `r2-${Math.random().toString(36).slice(2)}.bin`);
  wrangler(['r2', 'object', 'get', `kedai-media/${key}`, '--local', '--persist-to', state, '--file', out], { cwd: cfgDir });
  return readFileSync(out);
}

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/ping`);
      if (r.ok) return;
    } catch {
      /* belum siap */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('wrangler pages dev tak hidup dalam 60 saat');
}

async function apiGet(path, tok) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: `__Host-sid=${tok}` } });
  return { status: res.status, json: await res.json() };
}

// Jana gambar besar yang realistik (kecerunan, bentuk dan hingar halus), disimpan sebagai JPEG kualiti maksimum.
async function makeBigJpeg() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const b64 = await page.evaluate(async () => {
    const w = 4000;
    const h = 3000;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#e11d48');
    g.addColorStop(0.5, '#f59e0b');
    g.addColorStop(1, '#0ea5e9');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 80; i++) {
      x.fillStyle = `hsl(${(i * 37) % 360},70%,50%)`;
      x.beginPath();
      x.arc(Math.random() * w, Math.random() * h, 40 + Math.random() * 260, 0, 7);
      x.fill();
    }
    const img = x.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 36;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    }
    x.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 1));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  await context.close();
  const path = join(tmp, 'gambar-besar.jpg');
  writeFileSync(path, Buffer.from(b64, 'base64'));
  return path;
}

before(async () => {
  tmp = mkdtempSync(join(process.env.E2E_TMP || tmpdir(), 'kedai-e2e-'));
  cfgDir = join(tmp, 'd1cfg');
  state = join(tmp, 'state');
  mkdirSync(cfgDir);
  writeFileSync(
    join(cfgDir, 'wrangler.toml'),
    'name = "kedai-e2e"\ncompatibility_date = "2025-09-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "kedai-db"\ndatabase_id = "kedai-db-e2e"\n',
  );
  const seed = `${readFileSync(join(ROOT, 'db/0001_init.sql'), 'utf8')}
INSERT INTO users (id, google_sub, email, name) VALUES
  ('u-a', 'sub-a', 'baru@ujian.test', '${XSS_NAME.replace(/'/g, "''")}'),
  ('u-b', 'sub-b', 'wakanda@ujian.test', 'Mak Wakanda'),
  ('u-w', 'sub-w', 'wizard@ujian.test', 'Mak Cik Wizard'),
  ('u-d', 'sub-d', 'kopi@ujian.test', 'Pak Kopi'),
  ('u-e', 'sub-e', 'tetapan@ujian.test', 'Kak Tetapan'),
  ('u-p', 'sub-p', 'produk@ujian.test', 'Abang Produk'),
  ('u-r', 'sub-r', 'pro@ujian.test', 'Puan Pro'),
  ('u-m', 'sub-m', 'admin@ujian.test', 'Bos Admin'),
  ('u-x', 'sub-x', 'padam@ujian.test', 'Cik Padam'),
  ('u-l', 'sub-l', 'laju@ujian.test', 'Encik Laju'),
  ('u-f', 'sub-f', 'bayar@ujian.test', 'Puan Bayar');
INSERT INTO sessions (token_hash, user_id, expires_at) VALUES
  ('${sha(TOKEN_A)}', 'u-a', datetime('now', '+1 day')),
  ('${sha(TOKEN_B)}', 'u-b', datetime('now', '+1 day')),
  ('${sha(TOKEN_W)}', 'u-w', datetime('now', '+1 day')),
  ('${sha(TOKEN_E)}', 'u-e', datetime('now', '+1 day')),
  ('${sha(TOKEN_P)}', 'u-p', datetime('now', '+1 day')),
  ('${sha(TOKEN_R)}', 'u-r', datetime('now', '+1 day')),
  ('${sha(TOKEN_M)}', 'u-m', datetime('now', '+1 day')),
  ('${sha(TOKEN_X)}', 'u-x', datetime('now', '+1 day')),
  ('${sha(TOKEN_F)}', 'u-f', datetime('now', '+1 day'));
INSERT INTO payments (id, order_no, payer_email, amount_sen, period, quantity, status) VALUES
  ('pay-u', 'BCL-UJI-1', 'tersalah@ujian.test', 5800, 'monthly', 2, 'unmatched');
INSERT INTO shops (id, owner_user_id, slug, name, whatsapp, description) VALUES
  ('s-b', 'u-b', 'wakanda', 'Kedai Wakanda', '60123456789', ''),
  ('s-d', 'u-d', 'kopi-o', 'Kopi O Pak Kopi', '60111111111', ''),
  ('s-e', 'u-e', 'tetapan-uji', 'Kedai Tetapan', '60123456789', 'Penerangan asal'),
  ('s-p', 'u-p', 'kedai-produk', 'Kedai Produk', '60123456789', '');
INSERT INTO shops (id, owner_user_id, slug, name, whatsapp, description, plan_code, plan_expires_at) VALUES
  ('s-r', 'u-r', 'kedai-pro', 'Kedai Pro', '60198765432', '', 'pro', date('now', '+10 days'));
INSERT INTO shops (id, owner_user_id, slug, name, whatsapp, description) VALUES
  ('s-x', 'u-x', 'kedai-padam', 'Kedai Padam', '60123456789', 'Akan dipadam'),
  ('s-l', 'u-l', 'kedai-laju', 'Kedai Laju', '60123456789', 'Kedai untuk ukuran LCP'),
  ('s-f', 'u-f', 'kedai-bayar', 'Kedai Bayar', '60123456789', '');
INSERT INTO categories (id, shop_id, name) VALUES ('c-x', 's-x', 'Kuih');
INSERT INTO products (id, shop_id, category_id, name, price_sen, image_key, thumb_key, bytes) VALUES
  ('p-x', 's-x', 'c-x', 'Karipap Padam', 500, '${PADAM_IMG}', NULL, 10);
INSERT INTO shop_banners (id, shop_id, image_key, bytes) VALUES
  ('b-l', 's-l', 'shops/s-l/b_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp', 1000);
INSERT INTO products (id, shop_id, name, price_sen, image_key, thumb_key, bytes, sort_order) VALUES
  ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `('p-l${n}', 's-l', 'Produk Laju ${n}', ${1000 + n}, 'shops/s-l/0000000${n}-0000-4000-8000-000000000000.webp', 'shops/s-l/0000000${n}-0000-4000-8000-000000000000_t.webp', 10, ${n})`).join(',\n  ')};`;
  writeFileSync(join(tmp, 'seed.sql'), seed);
  wrangler(['d1', 'execute', 'kedai-db', '--local', '--persist-to', state, '--file', join(tmp, 'seed.sql')], { cwd: cfgDir });
  // Objek R2 sebenar untuk kedai yang akan dipadam: satu dirujuk produk, satu yatim.
  writeFileSync(join(tmp, 'img.webp'), PNG_1X1);
  for (const key of [PADAM_IMG, 'shops/s-x/b_99999999-2222-4333-8444-555555555555.webp']) {
    wrangler(['r2', 'object', 'put', `kedai-media/${key}`, '--local', '--persist-to', state, '--file', join(tmp, 'img.webp'), '--content-type', 'image/webp'], { cwd: cfgDir });
  }

  // API BCL palsu (GET /v1/transactions/:order) supaya aliran webhook diuji hujung ke hujung tanpa BCL sebenar.
  bclServer = createServer((req, res) => {
    const order = decodeURIComponent((req.url.split('/transactions/')[1] || '').split('?')[0]);
    const t = bclTx[order];
    const ok = t && req.headers.authorization === 'Bearer bcl_e2e';
    res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ok ? { success: true, data: { record_id: order, main_data: { order_number: order, ...t.main }, custom_fields_data: t.custom } } : { success: false }));
  }).listen(BCL_PORT, '127.0.0.1');

  const [cmd, base] = wranglerCmd;
  server = spawn(
    cmd,
    [
      ...base, 'pages', 'dev', 'public', '--port', String(PORT), '--ip', '127.0.0.1',
      '--compatibility-date', '2025-09-01', '--d1', 'DB=kedai-db-e2e', '--r2', 'MEDIA=kedai-media', '--persist-to', state,
      '--binding', 'GOOGLE_CLIENT_ID=e2e-client.apps.googleusercontent.com',
      '--binding', 'SUPERADMIN_EMAILS=admin@ujian.test',
      '--binding', 'SESSION_DAYS=30',
      '--binding', `MEDIA_BASE_URL=${MEDIA}`,
      '--binding', 'SUPPORT_EMAIL=bantuan@ujian.test',
      '--binding', `BCL_WEBHOOK_KEY=${BCL_KEY}`,
      '--binding', 'BCL_API_TOKEN=bcl_e2e',
      '--binding', `BCL_API_URL=http://127.0.0.1:${BCL_PORT}/v1`,
      '--binding', 'BCL_FORM_ID=21437',
      '--binding', `BCL_FORM_URL=${BCL_FORM_URL}`,
    ],
    { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'ignore', detached: true },
  );
  await waitUp();
  browser = await chromium.launch();
  bigJpeg = await makeBigJpeg();
});

after(async () => {
  if (browser) await browser.close();
  if (bclServer) bclServer.close();
  if (server) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* sudah mati */
    }
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

// Skrip GIS palsu: renderButton lukis butang biasa yang memanggil callback dengan credential.
const FAKE_GSI = `
window.google = { accounts: { id: {
  initialize(cfg) { window.__gsiCfg = cfg; },
  renderButton(el) {
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'fake-google'; b.textContent = 'Teruskan dengan Google';
    b.addEventListener('click', () => window.__gsiCfg.callback({ credential: 'a.b.c' }));
    el.appendChild(b);
  },
  disableAutoSelect() { window.__gsiDisabled = true; }
} } };`;

async function newPage({ width = 360, height = 780, sid, permissions, sw = false } = {}) {
  // Service worker disekat kecuali ujian PWA: ia memintas context.route dan boleh menyembunyikan ralat rangkaian.
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, permissions, serviceWorkers: sw ? 'allow' : 'block' });
  if (sid) {
    await context.addCookies([
      { name: '__Host-sid', value: sid, domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
    ]);
  }
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('https://accounts.google.com/gsi/client')) {
      return route.fulfill({ contentType: 'text/javascript', body: FAKE_GSI });
    }
    if (url.startsWith(`${MEDIA}/catalog/`)) {
      // Fallback 404.html membaca snapshot terus dari domain media: hidang objek sebenar dari R2 local.
      const key = decodeURIComponent(new URL(url).pathname.slice(1));
      try {
        return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r2Get(key) });
      } catch {
        return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'tiada' });
      }
    }
    if (url.startsWith(`${MEDIA}/`)) return route.fulfill({ contentType: 'image/png', body: PNG_1X1 });
    if (url.startsWith(BASE)) return route.continue();
    return route.abort(); // tiada rangkaian luar dalam ujian
  });
  const page = await context.newPage();
  openPages.push(page);
  if (process.env.E2E_DEBUG) page.on('console', (m) => console.log('[konsol]', m.type(), m.text()));
  page.on('console', (msg) => {
    const text = msg.text();
    // 401 daripada /api/me (belum login) dan 404 halaman yang sengaja diuji sebagai tak wujud ialah aliran biasa.
    // ERR_INTERNET_DISCONNECTED: simulasi offline dalam ujian PWA (setOffline), bukan ralat aplikasi.
    if (msg.type() === 'error' && !/Failed to load resource: (the server responded with a status of (401|404)|net::ERR_INTERNET_DISCONNECTED)/.test(text)) {
      consoleProblems.push(`${page.url()}: ${text}`);
    }
  });
  page.on('pageerror', (err) => consoleProblems.push(`${page.url()}: ${err.message}`));
  return { context, page };
}

// Bila ujian gagal, simpan tangkapan skrin dan teks halaman supaya punca nampak.
afterEach(async (t) => {
  const pages = openPages.splice(0);
  if (t.passed !== false) return;
  for (const [i, page] of pages.entries()) {
    try {
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `GAGAL-${t.name.slice(0, 20).replace(/\W+/g, '_')}-${i}.png`), fullPage: true });
      const text = await page.locator('body').innerText({ timeout: 2000 });
      console.log(`--- halaman (${page.url()}) ---\n${text.slice(0, 1500)}\n---`);
    } catch {
      /* halaman sudah ditutup */
    }
  }
});

async function noHorizontalScroll(page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `skrol mendatar: ${sw} > ${cw}`);
}

async function touchTargets(page, selector, min = 44) {
  for (const el of await page.locator(selector).all()) {
    if (!(await el.isVisible())) continue;
    const box = await el.boundingBox();
    assert.ok(box.height >= min - 0.5 && box.width >= min - 0.5, `${selector} ${box.width}x${box.height} kurang daripada ${min}px`);
  }
}

// Selepas pilih fail gambar, cropper dibuka: terima potongan lalai (tengah).
async function acceptCrop(page) {
  const dialog = page.getByRole('dialog', { name: /Potong/ });
  await dialog.waitFor({ timeout: 60000 });
  await dialog.getByRole('button', { name: 'Guna gambar' }).click();
  await dialog.waitFor({ state: 'detached' });
}

// Paparkan semua bahagian beranimasi (scroll-reveal) sebelum tangkapan skrin halaman penuh.
async function revealAll(page) {
  await page.evaluate(() => document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('in')));
  await page.waitForTimeout(900);
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

// ================================================================ Fasa 0 dan 1

test('S-01 landing: hero, harga daripada /api/plans, contoh kedai tersembunyi, tiada skrol mendatar', async () => {
  const { context, page } = await newPage();
  const plansResp = page.waitForResponse((r) => r.url().endsWith('/api/plans'));
  const res = await page.goto(`${BASE}/`);
  assert.equal(res.status(), 200);
  assert.ok(res.headers()['content-security-policy'].includes("frame-ancestors 'none'"));
  await page.getByRole('heading', { level: 1, name: 'Kedai online anda, order terus ke WhatsApp' }).waitFor();
  assert.equal((await plansResp).status(), 200);
  const plans = (await (await fetch(`${BASE}/api/plans`)).json()).plans;
  const pro = plans.find((p) => p.code === 'pro');
  await page.locator('[data-plan="pro.month"]').getByText(`RM${pro.priceMonthSen / 100}`).waitFor();
  assert.equal(await page.locator('[data-plan="free.products"]').textContent(), String(plans.find((p) => p.code === 'free').maxProducts));
  assert.equal(await page.locator('.hero-cta').getByRole('link', { name: 'Buka kedai percuma' }).getAttribute('href'), '/app/');
  assert.equal(await page.getByRole('link', { name: 'Lihat contoh kedai' }).isVisible(), false, '/contoh belum wujud');
  await page.locator('.site-footer a[href^="mailto:bantuan@ujian.test"]').waitFor();
  for (const href of ['/privasi', '/terma']) assert.equal(await page.locator(`.site-footer a[href="${href}"]`).count(), 1);
  // Bar CTA melekat muncul selepas hero keluar dari skrin (phone sahaja).
  assert.equal(await page.locator('.cta-bar.show').count(), 0);
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.locator('.cta-bar.show').waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.hero-shot img').evaluate((img) => img.decode());
  await noHorizontalScroll(page);
  // Gutter sisi: teks dan butang hero tak boleh melekat di tepi skrin.
  for (const sel of ['.hero h1', '.hero .lead', '.hero-cta .btn', '.hero-note']) {
    const box = await page.locator(sel).first().boundingBox();
    assert.ok(box.x >= 12 && box.x + box.width <= 360 - 12, `${sel} tiada gutter: x=${box.x} kanan=${box.x + box.width}`);
  }
  await touchTargets(page, '.hero-cta .btn, .icon-toggle, .seg button, .faq-list summary, .cta-bar .btn');
  await revealAll(page);
  await shot(page, '00-landing');
  await context.close();

  const desk = await newPage({ width: 1280, height: 900 });
  await desk.page.goto(`${BASE}/`);
  await desk.page.locator('.hero-shot img').evaluate((img) => img.decode());
  await noHorizontalScroll(desk.page);
  await revealAll(desk.page);
  await shot(desk.page, '00-landing-desktop');
  await desk.context.close();
});

test('Privasi dan terma: halaman statik (bukan Functions), e-mel sokongan daripada SUPPORT_EMAIL', async () => {
  for (const [path, title] of [['/privasi', 'Dasar Privasi'], ['/terma', 'Terma Perkhidmatan']]) {
    const { context, page } = await newPage();
    const res = await page.goto(`${BASE}${path}`);
    assert.equal(res.status(), 200, path);
    assert.ok(res.headers()['content-security-policy'], 'header _headers dikenakan (fail statik)');
    await page.getByRole('heading', { level: 1, name: title }).waitFor();
    await page.locator('main a[href="mailto:bantuan@ujian.test"]').first().waitFor();
    await noHorizontalScroll(page);
    await shot(page, `00-${path.slice(1)}`);
    await context.close();
  }
  const slug = await apiGet('/api/slug-check?slug=terma', TOKEN_B);
  assert.equal(slug.json.available, false, 'slug terma tak boleh diambil');
});

test('S-07: tanpa sesi papar login; token ditolak papar "Login tak berjaya"', async () => {
  const { context, page } = await newPage();
  await page.goto(`${BASE}/app/`);
  await page.getByRole('heading', { name: 'Log masuk peniaga' }).waitFor();
  const btn = page.locator('#fake-google');
  await btn.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Cuba semula' }).isVisible(), false, 'butang cuba semula tersembunyi bila tiada ralat');
  await noHorizontalScroll(page);
  await shot(page, '01-login');

  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/auth/google')), btn.click()]);
  assert.equal(resp.status(), 401, 'lepas semakan Origin dan Content-Type, ditolak oleh pengesahan token');
  await page.getByText('Login tak berjaya, cuba lagi.').waitFor();
  await context.close();
});

test('S-08: akaun baharu tanpa kedai nampak wizard; nama berisi HTML dipapar sebagai teks; logout', async () => {
  const { context, page } = await newPage({ sid: TOKEN_A });
  await page.goto(`${BASE}/app/`);
  await page.getByRole('heading', { level: 1, name: 'Setup kedai' }).waitFor();
  const greeting = await page.locator('#setup-greeting').textContent();
  assert.ok(greeting.startsWith(`Hai, ${XSS_NAME}.`), greeting);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'skrip XSS tak boleh berjaya');
  assert.equal(await page.locator('.bottom-nav').count(), 0, 'tiada navigasi sebelum kedai dicipta');
  await page.getByText('Langkah 1 daripada 3').waitFor();
  await noHorizontalScroll(page);
  await shot(page, '02-setup');

  await page.getByRole('button', { name: 'Log keluar' }).click();
  await page.getByRole('heading', { name: 'Log masuk peniaga' }).waitFor();
  await page.locator('#fake-google').waitFor();
  assert.equal(await page.evaluate(() => window.__gsiDisabled), true, 'auto-select Google dimatikan selepas logout');
  const cookies = await context.cookies();
  assert.equal(cookies.find((c) => c.name === '__Host-sid'), undefined, 'cookie dipadam');
  const after = await fetch(`${BASE}/api/me`, { headers: { Cookie: `__Host-sid=${TOKEN_A}` } });
  assert.equal(after.status, 401, 'sesi dipadam di D1');
  await context.close();
});

test('S-09: peniaga dengan kedai nampak dashboard dan bottom navigation di phone', async () => {
  const { context, page } = await newPage({ sid: TOKEN_B });
  await page.goto(`${BASE}/app/`);
  await page.getByRole('heading', { name: 'Kedai Wakanda' }).waitFor();
  await page.getByText(`127.0.0.1:${PORT}/wakanda`).waitFor(); // di produksi: kedai.annurpro.com/wakanda
  const links = page.locator('.bottom-nav .nav-link');
  assert.equal(await links.count(), 5);
  assert.deepEqual(await links.allTextContents(), ['Utama', 'Produk', 'Tetapan', 'Langganan', 'Akaun']);
  await touchTargets(page, '.bottom-nav .nav-link');
  await noHorizontalScroll(page);
  await shot(page, '03-dashboard');

  await page.getByRole('link', { name: 'Akaun' }).click();
  await page.getByText('wakanda@ujian.test').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Akaun' }).getAttribute('aria-current'), 'page');
  assert.equal(await page.title(), 'Akaun | Kedai AnnurPro');
  await shot(page, '04-akaun');
  await context.close();
});

test('Desktop 1280 px: navigasi menjadi sidebar', async () => {
  const { context, page } = await newPage({ width: 1280, height: 800, sid: TOKEN_B });
  await page.goto(`${BASE}/app/#/produk`);
  await page.getByRole('heading', { name: 'Produk' }).waitFor();
  const box = await page.locator('.bottom-nav').boundingBox();
  assert.ok(box.x < 10 && box.width < 260 && box.height > 600, JSON.stringify(box));
  await shot(page, '05-desktop');
  await context.close();
});

test('Sesi tamat semasa guna: kembali ke login', async () => {
  const { context, page } = await newPage({ sid: 'C'.repeat(43) });
  await page.goto(`${BASE}/app/`);
  await page.getByRole('heading', { name: 'Log masuk peniaga' }).waitFor();
  await context.close();
});

// ================================================================ Fasa 2

test('F-03: gambar ~5 MB dimampatkan di browser ke bawah had saiz (banner, produk, thumbnail)', async () => {
  const size = statSync(bigJpeg).size;
  console.log(`  gambar ujian: ${(size / 1048576).toFixed(1)} MB`);
  assert.ok(size >= 5 * 1048576, `gambar ujian cuma ${size} bait`);

  const { context, page } = await newPage({ sid: TOKEN_E });
  await page.goto(`${BASE}/app/`);
  const bytes = readFileSync(bigJpeg).toString('base64');
  const res = await page.evaluate(async (b64) => {
    const { compressImage } = await import('/assets/js/image.js');
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'IMG_0001.jpg', { type: 'image/jpeg' });
    const out = {};
    for (const kind of ['banner', 'product', 'thumb']) {
      const t0 = performance.now();
      const r = await compressImage(file, kind);
      const head = new Uint8Array(await r.blob.slice(0, 12).arrayBuffer());
      out[kind] = { size: r.blob.size, type: r.blob.type, width: r.width, height: r.height, ms: Math.round(performance.now() - t0), head: [...head] };
    }
    let err = null;
    try {
      await compressImage(new File(['bukan gambar'], 'a.txt', { type: 'text/plain' }), 'banner');
    } catch (e) {
      err = e.code;
    }
    return { out, err };
  }, bytes);

  for (const [kind, max] of [['banner', 500 * 1024], ['product', 400 * 1024], ['thumb', 80 * 1024]]) {
    const r = res.out[kind];
    console.log(`  ${kind}: ${Math.round(r.size / 1024)} KB ${r.type} ${r.width}x${r.height} dalam ${r.ms} ms`);
    assert.ok(r.size <= max, `${kind} ${r.size} > ${max}`);
    assert.equal(r.type, 'image/webp');
    assert.deepEqual(r.head.slice(0, 4), [0x52, 0x49, 0x46, 0x46], 'RIFF');
  }
  assert.equal(res.out.banner.width / res.out.banner.height, 2, 'banner dipotong ke nisbah 2:1');
  assert.ok(res.out.banner.width <= 1600);
  assert.ok(Math.max(res.out.product.width, res.out.product.height) <= 1000);
  assert.ok(Math.max(res.out.thumb.width, res.out.thumb.height) <= 400);
  // Sejak cropper: produk sentiasa segi empat (kedai papar 1:1); tanpa pilihan pengguna, potongan di tengah.
  assert.equal(res.out.product.width, res.out.product.height, 'produk dipotong segi empat');
  assert.equal(res.out.thumb.width, res.out.thumb.height, 'thumbnail segi empat');
  assert.equal(res.err, 'bukan-gambar', 'fail bukan gambar ditolak awal');
  await context.close();
});

test('Safari lama: toBlob tak sokong WebP (pulang PNG) jatuh balik ke JPEG yang sah', async () => {
  const { context, page } = await newPage({ sid: TOKEN_E });
  await page.goto(`${BASE}/app/`);
  const bytes = readFileSync(bigJpeg).toString('base64');
  const r = await page.evaluate(async (b64) => {
    const orig = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb, type, q) {
      return orig.call(this, cb, type === 'image/webp' ? 'image/png' : type, q); // meniru Safari lama
    };
    const { compressImage } = await import('/assets/js/image.js');
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const out = await compressImage(new File([arr], 'IMG.jpg', { type: 'image/jpeg' }), 'banner');
    return { type: out.blob.type, size: out.blob.size, head: [...new Uint8Array(await out.blob.slice(0, 3).arrayBuffer())] };
  }, bytes);
  assert.equal(r.type, 'image/jpeg');
  assert.deepEqual(r.head, [0xff, 0xd8, 0xff]);
  assert.ok(r.size <= 500 * 1024);
  await context.close();
});

test('S-08 wizard: 3 langkah dengan semakan slug, normalisasi WhatsApp dan banner; kedai dan gambar sebenar tersimpan', async () => {
  const { context, page } = await newPage({ sid: TOKEN_W });
  await page.goto(`${BASE}/app/`);
  await page.getByText('Langkah 1 daripada 3').waitFor();
  const next = page.getByRole('button', { name: 'Seterusnya' });
  assert.equal(await next.isDisabled(), true);

  // Langkah 1: slug dicadangkan daripada nama, disemak serta-merta
  await page.getByLabel('Nama kedai').fill('Kuih Mak Cik');
  assert.equal(await page.getByLabel('Nama dalam link').inputValue(), 'kuih-mak-cik');
  await page.locator('#f-slug-msg', { hasText: 'Tersedia' }).waitFor();
  assert.equal(await next.isDisabled(), false);
  await page.getByText('kedai.annurpro.com/kuih-mak-cik').waitFor();

  // reserved, sudah diambil (huruf besar dinormalkan), format salah
  const slug = page.getByLabel('Nama dalam link');
  await slug.fill('admin');
  await page.locator('#f-slug-msg', { hasText: 'Nama ini tak boleh digunakan, cuba yang lain.' }).waitFor();
  assert.equal(await next.isDisabled(), true);
  await slug.fill('Kopi-O');
  assert.equal(await slug.inputValue(), 'kopi-o', 'huruf besar ditukar ke huruf kecil');
  await page.locator('#f-slug-msg', { hasText: 'tak boleh digunakan' }).waitFor();
  assert.equal(await next.isDisabled(), true);
  await slug.fill('kedai mak');
  await page.locator('#f-slug-msg', { hasText: 'huruf kecil, nombor dan sempang' }).waitFor();
  await slug.fill('ab');
  await slug.blur();
  await page.locator('#f-slug-msg', { hasText: '3 hingga 30 aksara' }).waitFor();
  await shot(page, '10-wizard-1-ralat');
  await slug.fill('kuih-mak-cik');
  await page.locator('#f-slug-msg', { hasText: 'Tersedia' }).waitFor();
  await next.click();

  // Langkah 2: WhatsApp
  await page.getByText('Langkah 2 daripada 3').waitFor();
  const wa = page.getByLabel('Nombor WhatsApp');
  const next2 = page.getByRole('button', { name: 'Seterusnya' });
  assert.equal(await next2.isDisabled(), true);
  await wa.fill('0123');
  await wa.blur();
  await page.locator('#f-wa-msg', { hasText: 'Nombor WhatsApp tak sah' }).waitFor();
  await wa.fill('012-345 6789');
  await page.locator('#wa-preview', { hasText: '+60 12-345 6789' }).waitFor();
  assert.equal(await next2.isDisabled(), false);
  await shot(page, '11-wizard-2');

  // Kembali mengekalkan nilai
  await page.getByRole('button', { name: 'Kembali' }).click();
  await page.getByText('Langkah 1 daripada 3').waitFor();
  assert.equal(await page.getByLabel('Nama kedai').inputValue(), 'Kuih Mak Cik');
  assert.equal(await page.getByLabel('Nama dalam link').inputValue(), 'kuih-mak-cik');
  await page.locator('#f-slug-msg', { hasText: 'Tersedia' }).waitFor();
  await page.getByRole('button', { name: 'Seterusnya' }).click();
  assert.equal(await page.getByLabel('Nombor WhatsApp').inputValue(), '012-345 6789');
  await page.getByRole('button', { name: 'Seterusnya' }).click();

  // Langkah 3: warna dan banner (gambar ~5 MB dari "phone")
  await page.getByText('Langkah 3 daripada 3').waitFor();
  await page.getByRole('radio', { name: 'Merah jambu' }).click();
  assert.equal(await page.getByRole('radio', { name: 'Merah jambu' }).getAttribute('aria-checked'), 'true');
  assert.equal(await page.getByRole('radio', { name: 'Teal' }).getAttribute('aria-checked'), 'false');
  await touchTargets(page, '.swatch');
  await page.locator('#f-banner').setInputFiles(bigJpeg);
  await acceptCrop(page);
  await page.locator('#banner-msg', { hasText: 'Siap dimampatkan' }).waitFor({ timeout: 60000 });
  await page.locator('.banner-preview img').waitFor();
  const kb = Number(/\((\d+) KB\)/.exec(await page.locator('#banner-msg').textContent())[1]);
  assert.ok(kb <= 500, `banner ${kb} KB`);
  await noHorizontalScroll(page);
  await shot(page, '12-wizard-3');

  await page.getByRole('button', { name: 'Simpan kedai' }).click();
  await page.getByRole('heading', { name: 'Kuih Mak Cik' }).waitFor({ timeout: 30000 });
  await page.getByText('Kedai siap.').waitFor();
  assert.equal(await page.locator('.bottom-nav .nav-link').count(), 5, 'masuk ke dashboard penuh');
  await shot(page, '13-wizard-siap');

  // Pengesahan di server: D1 dan R2 sebenar
  const shop = (await apiGet('/api/shop', TOKEN_W)).json;
  assert.equal(shop.shop.slug, 'kuih-mak-cik');
  assert.equal(shop.shop.whatsapp, '60123456789');
  assert.equal(shop.shop.themeColor, '#BE123C');
  assert.equal(shop.banners.length, 1);
  const { key, bytes } = shop.banners[0];
  assert.ok(bytes <= 500 * 1024, `banner tersimpan ${bytes} bait`);
  assert.equal(shop.shop.storageBytes, bytes);
  assert.match(key, /^shops\/[0-9a-f-]{36}\/b_[0-9a-f-]{36}\.webp$/);
  const stored = r2Get(key);
  assert.equal(stored.length, bytes, 'saiz objek R2 sama dengan rekod');
  assert.equal(stored.subarray(0, 4).toString(), 'RIFF');
  assert.equal(stored.subarray(8, 12).toString(), 'WEBP');
  console.log(`  banner tersimpan: ${Math.round(bytes / 1024)} KB`);
  const snapW = JSON.parse(r2Get('catalog/kuih-mak-cik.json').toString());
  assert.equal(snapW.shop.name, 'Kuih Mak Cik');
  assert.deepEqual(snapW.banners, [{ k: key }], 'snapshot awam diterbitkan semasa kedai dicipta');
  await context.close();
});

test('S-13: tetapan (nama, slug, warna, suis) dan pengurusan banner dengan had pelan Percuma', async () => {
  const { context, page } = await newPage({ sid: TOKEN_E });
  await page.goto(`${BASE}/app/#/tetapan`);
  await page.getByRole('heading', { level: 1, name: 'Tetapan kedai' }).waitFor();
  await page.getByLabel('Nama kedai').waitFor();
  const save = page.getByRole('button', { name: 'Simpan perubahan' });

  assert.equal(await page.getByLabel('Nama kedai').inputValue(), 'Kedai Tetapan');
  assert.equal(await page.getByLabel('Nombor WhatsApp').inputValue(), '+60 12-345 6789');
  assert.equal(await page.getByLabel('Penerangan ringkas').inputValue(), 'Penerangan asal');
  assert.equal(await save.isDisabled(), true, 'tiada perubahan, tiada butang simpan');
  await page.getByText('Boleh ditukar 3 kali lagi').waitFor();
  assert.equal(await page.getByRole('switch', { name: /Kedai sedang buka/ }).isChecked(), true);
  assert.equal(await page.getByRole('switch', { name: /Minta alamat/ }).isChecked(), false);
  await touchTargets(page, '.switch-row', 56);
  await noHorizontalScroll(page);
  await shot(page, '20-tetapan');

  // slug diambil ditolak, slug baharu dengan amaran link lama
  const slug = page.getByLabel('Nama dalam link');
  await slug.fill('kopi-o');
  await page.locator('#s-slug-msg', { hasText: 'tak boleh digunakan' }).waitFor();
  assert.equal(await save.isDisabled(), true);
  await slug.fill('Tetapan-Baru');
  await page.locator('#s-slug-msg', { hasText: 'Tersedia' }).waitFor();
  await page.getByText('Menukar nama link akan mematikan link lama').waitFor();
  assert.equal(await save.isDisabled(), false);

  await page.getByLabel('Nama kedai').fill('Kedai Tetapan Baru');
  await page.getByLabel('Penerangan ringkas').fill('Buka setiap hari, 9 pagi hingga 9 malam.');
  await page.getByRole('radio', { name: 'Oren' }).click();
  await page.getByRole('switch', { name: /Minta alamat/ }).check();
  await page.getByRole('switch', { name: /Kedai sedang buka/ }).uncheck();
  await shot(page, '21-tetapan-diubah');
  await save.click();
  await page.getByText('Tetapan disimpan.').waitFor();

  const after = (await apiGet('/api/shop', TOKEN_E)).json.shop;
  assert.equal(after.name, 'Kedai Tetapan Baru');
  assert.equal(after.slug, 'tetapan-baru');
  assert.equal(after.slugChangesLeft, 2);
  assert.equal(after.themeColor, '#C2410C');
  assert.equal(after.askAddress, true);
  assert.equal(after.isOpen, false);
  assert.equal(after.planCode, 'free');
  assert.equal(after.description, 'Buka setiap hari, 9 pagi hingga 9 malam.');
  await page.getByText('Boleh ditukar 2 kali lagi').waitFor();
  const snapE = JSON.parse(r2Get('catalog/tetapan-baru.json').toString());
  assert.equal(snapE.shop.name, 'Kedai Tetapan Baru');
  assert.equal(snapE.shop.open, false);
  assert.equal(snapE.shop.theme, '#C2410C');
  assert.equal(await page.getByLabel('Nama dalam link').inputValue(), 'tetapan-baru');
  assert.equal(await page.getByRole('switch', { name: /Kedai sedang buka/ }).isChecked(), false);

  // banner: tambah (gambar ~5 MB), penuh pada had 1, buang
  const addBtn = page.getByRole('button', { name: 'Tambah banner' });
  assert.equal(await addBtn.isDisabled(), false);
  await page.locator('#s-banner-file').setInputFiles(bigJpeg);
  await acceptCrop(page);
  await page.locator('.banner-item').waitFor({ timeout: 60000 });
  await page.locator('#banner-msg', { hasText: 'Banner ditambah.' }).waitFor();
  assert.equal(await addBtn.isDisabled(), true, 'had 1 banner pelan Percuma');
  await page.getByText('Had 1 banner pelan Percuma dicapai.').waitFor();
  await page.getByRole('link', { name: 'Lihat pelan Pro' }).waitFor();
  assert.match(await page.locator('.banner-item img').getAttribute('src'), new RegExp(`^${MEDIA}/shops/[^/]+/b_[0-9a-f-]{36}\\.webp$`));
  await touchTargets(page, '.icon-btn');
  await noHorizontalScroll(page);
  await shot(page, '22-tetapan-banner');

  const withBanner = (await apiGet('/api/shop', TOKEN_E)).json;
  assert.equal(withBanner.banners.length, 1);
  const key = withBanner.banners[0].key;
  assert.equal(withBanner.shop.storageBytes, withBanner.banners[0].bytes);
  assert.equal(r2Get(key).length, withBanner.banners[0].bytes);
  await page.locator('#storage-note', { hasText: 'daripada 10 MB' }).waitFor();

  await page.getByRole('button', { name: 'Buang banner 1' }).click();
  await page.locator('#banner-msg', { hasText: 'Banner dibuang.' }).waitFor();
  assert.equal(await page.locator('.banner-item').count(), 0);
  assert.equal(await addBtn.isDisabled(), false);
  const cleared = (await apiGet('/api/shop', TOKEN_E)).json;
  assert.deepEqual(cleared.banners, []);
  assert.equal(cleared.shop.storageBytes, 0, 'storage dikembalikan');
  assert.throws(() => r2Get(key), 'objek dipadam daripada R2');
  await context.close();
});

test('API dengan sesi peniaga lain: IDOR melalui upload dan banner (kunci kedai orang lain ditolak)', async () => {
  const shopW = (await apiGet('/api/shop', TOKEN_W)).json;
  const otherKey = shopW.banners[0].key; // banner kedai wizard
  const res = await fetch(`${BASE}/api/shop/banners`, {
    method: 'PUT',
    headers: { Cookie: `__Host-sid=${TOKEN_E}`, 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ keys: [otherKey] }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'gambar-tak-sah');
  assert.equal((await apiGet('/api/shop', TOKEN_W)).json.banners.length, 1, 'banner kedai wizard tak terjejas');

  // objek palsu: dihantar sebagai JPEG tetapi sebenarnya .exe
  const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(2000)]);
  const up = await fetch(`${BASE}/api/upload?kind=banner`, {
    method: 'POST',
    headers: { Cookie: `__Host-sid=${TOKEN_E}`, 'Content-Type': 'image/jpeg', Origin: BASE },
    body: exe,
  });
  assert.equal(up.status, 415);
});

// ================================================================ Fasa 3

async function apiCall(method, path, tok, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: `__Host-sid=${tok}`, 'Content-Type': 'application/json', Origin: BASE },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('S-12 kategori: tambah, nama semula, susun', async () => {
  const { context, page } = await newPage({ sid: TOKEN_P });
  await page.goto(`${BASE}/app/#/kategori`);
  await page.getByRole('heading', { level: 1, name: 'Kategori' }).waitFor();
  await page.getByText('Belum ada kategori').waitFor();
  const input = page.getByLabel('Nama kategori baharu');
  for (const n of ['Kuih', 'Minuman']) {
    await input.fill(n);
    await page.getByRole('button', { name: 'Tambah' }).click();
    await page.locator('.cat-name', { hasText: n }).waitFor();
  }
  await page.getByRole('button', { name: 'Nama semula Kuih' }).click();
  const edit = page.getByLabel('Nama baharu untuk Kuih');
  await edit.fill('Kuih Muih');
  await page.getByRole('button', { name: 'Simpan' }).click();
  await page.locator('.cat-name', { hasText: 'Kuih Muih' }).waitFor();
  await page.getByRole('button', { name: 'Naikkan Minuman' }).click();
  await page.waitForFunction(() => document.querySelector('.cat-row .cat-name')?.textContent === 'Minuman');
  await page.getByText('2 daripada 5 kategori').waitFor();
  await touchTargets(page, '.cat-actions .icon-btn');
  await noHorizontalScroll(page);
  await shot(page, '30-kategori');
  const cats = (await apiCall('GET', '/api/categories', TOKEN_P)).json.categories.map((c) => c.name);
  assert.deepEqual(cats, ['Minuman', 'Kuih Muih']);
  await context.close();
});

test('S-10/S-11 produk: tambah dengan gambar ~5 MB, tanpa harga, habis stok, susun, cari, padam; snapshot dikemas kini', async () => {
  const { context, page } = await newPage({ sid: TOKEN_P });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/app/#/produk`);
  await page.getByRole('heading', { name: 'Belum ada produk' }).waitFor();
  await shot(page, '31-produk-kosong');
  await page.getByRole('link', { name: 'Tambah produk pertama' }).click();
  await page.getByRole('heading', { level: 1, name: 'Tambah produk' }).waitFor();

  await page.locator('#p-image').setInputFiles(bigJpeg);
  await acceptCrop(page);
  await page.locator('#img-msg', { hasText: 'Siap dimampatkan' }).waitFor({ timeout: 60000 });
  await page.getByLabel('Nama produk').fill('Teh Tarik');
  const price = page.getByLabel('Harga (RM)');
  await price.fill('abc');
  await price.blur();
  await page.locator('#p-price-msg', { hasText: 'Harga tak sah' }).waitFor();
  await price.fill('3.5');
  await price.blur();
  await page.locator('#p-price-msg', { hasText: 'RM3.50' }).waitFor();
  await page.getByLabel('Kategori').selectOption({ label: 'Minuman' });
  await page.getByLabel('Penerangan (pilihan)').fill('Kurang manis boleh.');
  await noHorizontalScroll(page);
  await shot(page, '32-borang-produk');
  await page.getByRole('button', { name: 'Simpan produk' }).click();
  await page.locator('.product-row', { hasText: 'Teh Tarik' }).waitFor({ timeout: 30000 });
  await page.getByText('Produk ditambah.').waitFor();

  // produk kedua tanpa gambar dan harga; nama berisi HTML
  await page.getByRole('link', { name: 'Tambah produk' }).click();
  await page.getByLabel('Nama produk').fill('<img src=x onerror="window.__xss=2"> Kuih Lapis');
  await page.getByRole('button', { name: 'Simpan produk' }).click();
  const row2 = page.locator('.product-row', { hasText: 'Kuih Lapis' });
  await row2.waitFor();
  assert.ok((await row2.textContent()).includes('Hubungi untuk harga'));
  assert.ok((await row2.textContent()).includes('<img src=x'), 'HTML dipapar sebagai teks');
  assert.equal(await page.evaluate(() => window.__xss), undefined);

  // habis stok, susun, cari, tapis
  await row2.getByRole('switch').uncheck();
  await page.getByText('ditanda habis stok').waitFor();
  await row2.locator('.badge', { hasText: 'Habis' }).waitFor();
  await page.getByRole('button', { name: /^Naikkan <img/ }).click();
  await page.waitForFunction(() => document.querySelector('.product-row .product-name')?.textContent.includes('Kuih Lapis'));
  await page.getByLabel('Cari produk').fill('teh');
  assert.equal(await page.locator('.product-row').count(), 1);
  await page.getByLabel('Cari produk').fill('');
  await page.getByRole('button', { name: 'Minuman' }).click();
  assert.equal(await page.locator('.product-row').count(), 1);
  await page.getByRole('button', { name: 'Semua' }).click();
  assert.equal(await page.locator('.product-row').count(), 2);
  await touchTargets(page, '.product-actions .icon-btn');
  await noHorizontalScroll(page);
  await shot(page, '33-senarai-produk');

  // semak data sebenar: D1, R2 dan snapshot awam
  const data = (await apiCall('GET', '/api/products', TOKEN_P)).json;
  const [first, second] = data.products;
  assert.equal(first.name.includes('Kuih Lapis'), true, 'susunan disimpan');
  assert.equal(first.isAvailable, false);
  assert.equal(second.name, 'Teh Tarik');
  assert.equal(second.priceSen, 350);
  assert.equal(second.description, 'Kurang manis boleh.');
  const big = r2Get(second.imageKey);
  const thumb = r2Get(second.thumbKey);
  assert.ok(big.length <= 400 * 1024 && thumb.length <= 80 * 1024, `${big.length} / ${thumb.length}`);
  assert.equal(big.subarray(8, 12).toString(), 'WEBP');
  assert.equal(second.bytes, big.length + thumb.length);
  assert.equal(data.usage.storageBytes, second.bytes);
  console.log(`  gambar produk: ${Math.round(big.length / 1024)} KB + thumbnail ${Math.round(thumb.length / 1024)} KB`);

  const snap = JSON.parse(r2Get('catalog/kedai-produk.json').toString());
  assert.equal(snap.items.length, 2);
  assert.equal(snap.items[0].a, false);
  assert.deepEqual(
    { n: snap.items[1].n, p: snap.items[1].p, i: snap.items[1].i, t: snap.items[1].t },
    { n: 'Teh Tarik', p: 350, i: second.imageKey, t: second.thumbKey },
  );
  assert.equal(snap.items[1].c, data.categories.find((c) => c.name === 'Minuman').id);
  assert.ok(!JSON.stringify(snap).includes('produk@ujian.test'), 'tiada e-mel dalam snapshot awam');

  // ubah harga, padam produk kedua
  await page.locator('.product-row', { hasText: 'Teh Tarik' }).locator('.product-link').click();
  await page.getByRole('heading', { level: 1, name: 'Ubah produk' }).waitFor();
  assert.equal(await page.getByLabel('Harga (RM)').inputValue(), '3.50');
  await page.getByLabel('Harga (RM)').fill('4');
  await page.getByRole('button', { name: 'Simpan perubahan' }).click();
  await page.locator('.product-row', { hasText: 'RM4.00' }).waitFor();
  await page.locator('.product-row', { hasText: 'Kuih Lapis' }).locator('.product-link').click();
  await page.getByRole('button', { name: 'Padam produk' }).click();
  await page.getByText('Produk dipadam.').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.product-row').length === 1); // senarai dimuat semula

  // dashboard: meter penggunaan
  await page.getByRole('link', { name: 'Utama' }).click();
  await page.getByRole('heading', { name: 'Penggunaan pelan' }).waitFor();
  await page.locator('.meter', { hasText: 'Produk' }).getByText('1 / 20').waitFor();
  await page.locator('.meter', { hasText: 'Kategori' }).getByText('2 / 5').waitFor();
  await noHorizontalScroll(page);
  await shot(page, '34-dashboard-meter');
  await context.close();
});

test('IPD "Had produk": produk ke-21 ditolak oleh server; UI papar had dan butang naik taraf', async () => {
  const existing = (await apiCall('GET', '/api/products', TOKEN_P)).json.usage.products;
  for (let i = existing; i < 20; i++) {
    assert.equal((await apiCall('POST', '/api/products', TOKEN_P, { name: `Produk ${i + 1}` })).status, 201);
  }
  const over = await apiCall('POST', '/api/products', TOKEN_P, { name: 'Produk 21' });
  assert.equal(over.status, 409);
  assert.equal(over.json.code, 'had-produk');

  const { context, page } = await newPage({ sid: TOKEN_P });
  await page.goto(`${BASE}/app/#/produk`);
  await page.getByText('Had 20 produk pelan Percuma dicapai.').waitFor();
  assert.equal(await page.getByRole('link', { name: 'Tambah produk' }).count(), 0);
  await page.getByRole('link', { name: 'Naik taraf' }).waitFor();
  await page.goto(`${BASE}/app/#/produk/baru`);
  await page.getByRole('link', { name: 'Lihat pelan Pro' }).waitFor();
  const snap = JSON.parse(r2Get('catalog/kedai-produk.json').toString());
  assert.equal(snap.items.length, 20);
  await context.close();
});

// ================================================================ Fasa 4

const SHOP_W = 'kuih-mak-cik';

test('Fasa 4 sediakan: kategori dan produk untuk kedai wizard', async () => {
  const kuih = (await apiCall('POST', '/api/categories', TOKEN_W, { name: 'Kuih' })).json.category.id;
  const minum = (await apiCall('POST', '/api/categories', TOKEN_W, { name: 'Minuman' })).json.category.id;
  for (const body of [
    { name: 'Karipap', priceSen: 100, categoryId: kuih, description: 'Inti kentang, 3 biji.' },
    { name: 'Kuih Lapis', priceSen: 150, categoryId: kuih },
    { name: 'Teh O Ais', priceSen: null, categoryId: minum },
    { name: 'Roti Habis', priceSen: 200, isAvailable: false },
  ]) {
    assert.equal((await apiCall('POST', '/api/products', TOKEN_W, body)).status, 201, body.name);
  }
});

test('S-02 halaman kedai: meta OG untuk pratonton WhatsApp, banner, grid 2 lajur di 360 px, label Habis', async () => {
  const res = await fetch(`${BASE}/${SHOP_W}`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-security-policy').includes("script-src 'self'"));
  const html = await res.text();
  const banner = (await apiGet('/api/shop', TOKEN_W)).json.banners[0].key;
  assert.ok(html.includes('<meta property="og:title" content="Kuih Mak Cik">'));
  assert.ok(html.includes(`<meta property="og:image" content="${MEDIA}/${banner}">`), 'banner sebagai gambar pratonton');
  assert.ok(html.includes(`<meta property="og:url" content="${BASE}/${SHOP_W}">`));

  const { context, page } = await newPage();
  await page.goto(`${BASE}/${SHOP_W}`);
  await page.getByRole('heading', { level: 1, name: 'Kuih Mak Cik' }).waitFor();
  assert.equal(await page.locator('.shop-banner').getAttribute('src'), `${MEDIA}/${banner}`);
  assert.equal(await page.locator('.p-card').count(), 4);
  const [b1, b2, b3] = await Promise.all([0, 1, 2].map((i) => page.locator('.p-card').nth(i).boundingBox()));
  assert.ok(Math.abs(b1.y - b2.y) < 1 && b2.x > b1.x && b3.y > b1.y, 'grid 2 lajur');
  const sold = page.locator('.p-card', { hasText: 'Roti Habis' });
  await sold.getByText('Habis', { exact: true }).waitFor();
  assert.equal(await sold.getByRole('button', { name: /^Tambah/ }).isDisabled(), true);
  assert.ok((await page.locator('.p-card', { hasText: 'Teh O Ais' }).textContent()).includes('Hubungi untuk harga'));
  await touchTargets(page, '.p-add');
  const chip = await page.getByRole('button', { name: 'Semua' }).evaluate((el) => getComputedStyle(el).borderRadius);
  assert.equal(chip, '999px', 'cip kategori bergaya');
  await noHorizontalScroll(page);
  await shot(page, '40-kedai');

  // carian dan tapis kategori
  await page.getByLabel('Cari produk').fill('lapis');
  assert.equal(await page.locator('.p-card').count(), 1);
  await page.getByLabel('Cari produk').fill('');
  await page.getByRole('button', { name: 'Minuman' }).click();
  assert.equal(await page.locator('.p-card').count(), 1);
  await page.getByRole('button', { name: 'Semua' }).click();
  await context.close();
});

test('IPD Mesej WhatsApp dan Troli: 3 item (1 tanpa harga), nota, refresh kekal, nama wajib, wa.me dengan mesej tepat', async () => {
  const { context, page } = await newPage();
  await page.goto(`${BASE}/${SHOP_W}`);
  await page.getByRole('heading', { level: 1, name: 'Kuih Mak Cik' }).waitFor();
  assert.equal(await page.locator('.cart-bar').isVisible(), false, 'troli kosong: bar tersembunyi');

  await page.getByRole('button', { name: 'Tambah Karipap ke troli' }).click();
  await page.getByRole('button', { name: 'Lihat Kuih Lapis' }).click();
  const sheet = page.getByRole('dialog', { name: 'Kuih Lapis' });
  await sheet.waitFor();
  assert.ok(!/\bnull\b/.test(await sheet.textContent()), 'tiada teks "null" bila produk tiada penerangan');
  await sheet.getByRole('button', { name: 'Tambah Kuih Lapis' }).click();
  await sheet.getByLabel('Nota (pilihan)').fill('tak manis');
  await sheet.getByRole('button', { name: /Tambah ke troli · RM3\.00/ }).click();
  await sheet.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Tambah Teh O Ais ke troli' }).click();
  const bar = page.locator('.cart-bar');
  await bar.getByText('4 item').waitFor();
  assert.ok((await bar.textContent()).includes('RM4.00 +'), await bar.textContent());
  await shot(page, '41-kedai-troli');

  await page.reload();
  await page.locator('.cart-bar').getByText('4 item').waitFor();

  await page.locator('.cart-bar').click();
  const cart = page.getByRole('dialog', { name: 'Troli' });
  await cart.waitFor();
  await cart.getByRole('button', { name: 'Tambah Karipap' }).click();
  await cart.locator('.c-sum', { hasText: 'RM5.00' }).waitFor();
  await cart.getByText('Item tanpa harga tak dikira').waitFor();
  await touchTargets(page, '.c-bottom .icon-btn');
  await noHorizontalScroll(page);
  await shot(page, '42-troli');
  await cart.getByRole('button', { name: 'Teruskan' }).click();

  const co = page.getByRole('dialog', { name: 'Semak dan hantar' });
  await co.waitFor();
  const send = co.getByRole('link', { name: 'Hantar ke WhatsApp' });
  await send.click(); // tanpa nama: tiada popup, ralat dipaparkan
  await co.getByText('Nama diperlukan.').waitFor();
  assert.equal(context.pages().length, 1, 'WhatsApp tak dibuka sebelum nama diisi');
  await co.getByLabel('Nama', { exact: true }).fill('Ali');
  await co.getByLabel('Nota untuk kedai (pilihan)').fill('Ambil pukul 5');
  const expected = [
    'Hai Kuih Mak Cik, saya nak order:',
    '',
    '1. Karipap x2 = RM2.00',
    '2. Kuih Lapis x2 = RM3.00',
    '   Nota: tak manis',
    '3. Teh O Ais x1 (harga belum ditetapkan)',
    '',
    'Jumlah: RM5.00 (belum termasuk item tanpa harga)',
    '',
    'Nama: Ali',
    'Nota: Ambil pukul 5',
  ].join('\n');
  assert.equal(await co.locator('.msg-preview').textContent(), expected);
  assert.ok(!/\bnull\b/.test(await co.textContent()), 'tiada teks "null" dalam lembaran');
  const href = await send.getAttribute('href');
  const link = new URL(href);
  assert.equal(`${link.origin}${link.pathname}`, 'https://wa.me/60123456789');
  assert.equal(link.searchParams.get('text'), expected, 'mesej dalam link sama dengan pratonton');
  await noHorizontalScroll(page);
  await shot(page, '43-semak-hantar');

  // Rangkaian luar disekat dalam ujian: semak permintaan yang popup cuba buka.
  const [req] = await Promise.all([context.waitForEvent('request', (r) => r.url().startsWith('https://wa.me/')), send.click()]);
  assert.equal(new URL(req.url()).searchParams.get('text'), expected);
  for (const p of context.pages().slice(1)) await p.close();
  await co.getByRole('button', { name: 'Kosongkan troli' }).click();
  await page.getByText('Troli dikosongkan').waitFor();
  assert.equal(await page.locator('.cart-bar').isVisible(), false);
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), `kedai:troli:${SHOP_W}`), null);
  await context.close();
});

test('IPD Kedai tutup: troli dilumpuhkan dan notis dipaparkan; kedai tak wujud: S-06 404', async () => {
  assert.equal((await apiCall('PATCH', '/api/shop', TOKEN_W, { isOpen: false })).status, 200);
  const { context, page } = await newPage();
  await page.goto(`${BASE}/${SHOP_W}`);
  await page.getByText('Kedai sedang tutup.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Tambah Karipap ke troli' }).isDisabled(), true);
  await shot(page, '44-kedai-tutup');
  assert.equal((await apiCall('PATCH', '/api/shop', TOKEN_W, { isOpen: true })).status, 200);

  const res = await page.goto(`${BASE}/tiada-kedai-xyz`);
  assert.equal(res.status(), 404);
  await page.getByRole('heading', { name: 'Kedai tak dijumpai' }).waitFor();
  await context.close();
});

test('IPD XSS: nama kedai dengan </script> dan HTML di halaman awam dipapar sebagai teks', async () => {
  const evil = '</script><img src=x onerror="window.__xss=3">';
  assert.equal((await apiCall('PATCH', '/api/shop', TOKEN_E, { name: evil })).status, 200);
  const { context, page } = await newPage();
  await page.goto(`${BASE}/tetapan-baru`);
  await page.locator('h1').waitFor();
  assert.equal(await page.locator('h1').textContent(), evil);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await context.close();
});

test('IPD 4.2 fallback (Functions tak berjalan): 404.html memuat snapshot dari domain media', async () => {
  const fallback = await (await fetch(`${BASE}/a/b`)).text();
  assert.ok(fallback.includes('id="page-data">null'), '404.html ialah kerangka kedai');
  const { context, page } = await newPage();
  await page.route(`${BASE}/${SHOP_W}`, (route) => route.fulfill({ status: 404, contentType: 'text/html', body: fallback }));
  await page.goto(`${BASE}/${SHOP_W}`);
  await page.getByRole('heading', { level: 1, name: 'Kuih Mak Cik' }).waitFor();
  assert.equal(await page.locator('.p-card').count(), 4);
  await page.getByRole('button', { name: 'Tambah Karipap ke troli' }).click();
  await page.locator('.cart-bar').getByText('1 item').waitFor();
  await page.goto(`${BASE}/a/b`);
  await page.getByRole('heading', { name: 'Halaman tidak dijumpai' }).waitFor();
  await context.close();
});

test('Desktop: grid 4 lajur', async () => {
  const { context, page } = await newPage({ width: 1280, height: 900 });
  await page.goto(`${BASE}/${SHOP_W}`);
  await page.locator('.p-card').first().waitFor();
  const ys = await Promise.all([0, 1, 2, 3].map(async (i) => (await page.locator('.p-card').nth(i).boundingBox()).y));
  assert.ok(ys.every((y) => Math.abs(y - ys[0]) < 1), '4 kad sebaris');
  await shot(page, '45-kedai-desktop');
  await context.close();
});

test('F-09 dashboard: salin link, kongsi ke WhatsApp, buka kedai', async () => {
  const { context, page } = await newPage({ sid: TOKEN_W, permissions: ['clipboard-read', 'clipboard-write'] });
  await page.goto(`${BASE}/app/`);
  await page.getByRole('button', { name: 'Salin link' }).click();
  await page.getByText('Link disalin.').waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${BASE}/${SHOP_W}`);
  const share = await page.getByRole('link', { name: 'Kongsi' }).getAttribute('href');
  assert.equal(new URL(share).searchParams.get('text'), `Jemput tengok dan order di Kuih Mak Cik: ${BASE}/${SHOP_W}`);
  assert.equal(await page.getByRole('link', { name: 'Buka kedai' }).getAttribute('href'), `${BASE}/${SHOP_W}`);
  await touchTargets(page, '.share-row .btn');
  await noHorizontalScroll(page);
  await shot(page, '46-dashboard-kongsi');
  await context.close();
});

// ================================================================ Fasa 5

async function uploadFakeBanner(tok) {
  const body = Buffer.alloc(3000);
  Buffer.from('RIFF').copy(body, 0);
  Buffer.from('WEBP').copy(body, 8);
  const res = await fetch(`${BASE}/api/upload?kind=banner`, {
    method: 'POST', headers: { Cookie: `__Host-sid=${tok}`, 'Content-Type': 'image/webp', Origin: BASE }, body,
  });
  assert.equal(res.status, 200);
  return (await res.json()).key;
}

test('IPD 5.3 notis: Pro tamat dalam 10 hari dipaparkan di dashboard dan Langganan', async () => {
  const { context, page } = await newPage({ sid: TOKEN_R });
  await page.goto(`${BASE}/app/`);
  await page.getByText(/Langganan Pro tamat dalam 10 hari \(\d{2}\/\d{2}\/\d{4}\)/).waitFor();
  await page.locator('.shop-head .badge', { hasText: 'Pro' }).waitFor();
  await page.locator('.meter', { hasText: 'Produk' }).getByText('0 / 500').waitFor();
  await shot(page, '50-dashboard-pro-tamat');

  await page.getByRole('link', { name: 'Langganan' }).first().click();
  await page.getByRole('heading', { level: 2, name: 'Pelan Pro' }).waitFor();
  await page.getByText(/Aktif sehingga \d{2}\/\d{2}\/\d{4}/).waitFor();
  await page.getByRole('cell', { name: 'RM20.00 sebulan atau RM200.00 setahun' }).waitFor();
  await page.getByText('Belum ada bayaran.').waitFor();
  await noHorizontalScroll(page);
  await shot(page, '51-langganan');
  await context.close();
});

test('IPD 5.2 Pro: templat mesej sendiri dengan pratonton, 2 banner berputar, tiada branding; mesej order guna templat', async () => {
  assert.equal((await apiCall('POST', '/api/products', TOKEN_R, { name: 'Kek Coklat', priceSen: 4500 })).status, 201);
  const keys = [await uploadFakeBanner(TOKEN_R), await uploadFakeBanner(TOKEN_R)];
  assert.equal((await apiCall('PUT', '/api/shop/banners', TOKEN_R, { keys })).status, 200, 'Pro boleh 2 banner');

  const { context, page } = await newPage({ sid: TOKEN_R });
  await page.goto(`${BASE}/app/#/tetapan`);
  const tpl = page.getByLabel('Templat mesej order');
  await tpl.waitFor();
  assert.equal(await tpl.isDisabled(), false);
  const preview = page.locator('#tpl-preview');
  assert.ok((await preview.textContent()).startsWith('Hai Kedai Pro, saya nak order:'), 'templat lalai bila kosong');
  await tpl.fill('Salam {kedai}!\nTempahan:\n');
  await page.getByRole('button', { name: '{senarai_item}' }).click();
  await tpl.press('End');
  await tpl.type('\nJumlah {jumlah}\nDaripada {nama}');
  await preview.getByText('Salam Kedai Pro!').waitFor();
  assert.ok((await preview.textContent()).includes('1. Nasi Lemak Ayam x2 = RM17.00'));
  assert.ok((await preview.textContent()).includes('Daripada Ali'));
  await tpl.fill('Tiada item di sini');
  await page.locator('#s-tpl-msg', { hasText: 'mesti mengandungi {senarai_item}' }).waitFor();
  await tpl.fill('Salam {kedai}!\nTempahan:\n{senarai_item}\nJumlah {jumlah}\nDaripada {nama}');
  await noHorizontalScroll(page);
  await shot(page, '52-templat');
  await page.getByRole('button', { name: 'Simpan perubahan' }).click();
  await page.getByText('Tetapan disimpan.').waitFor();
  assert.equal((await apiGet('/api/shop', TOKEN_R)).json.shop.messageTemplate, 'Salam {kedai}!\nTempahan:\n{senarai_item}\nJumlah {jumlah}\nDaripada {nama}');
  await context.close();

  const shop = await newPage();
  const sp = shop.page;
  await sp.goto(`${BASE}/kedai-pro`);
  await sp.getByRole('heading', { level: 1, name: 'Kedai Pro' }).waitFor();
  assert.equal(await sp.locator('.banner-track .shop-banner').count(), 2);
  const dots = sp.locator('.banner-dot');
  assert.equal(await dots.count(), 2);
  assert.equal(await dots.nth(0).getAttribute('aria-current'), 'true');
  await dots.nth(1).click();
  await sp.waitForFunction(() => document.querySelectorAll('.banner-dot')[1].getAttribute('aria-current') === 'true');
  await touchTargets(sp, '.banner-dot');
  assert.equal(await sp.getByText('Dikuasakan oleh Kedai AnnurPro').count(), 0, 'Pro: tiada branding');
  assert.ok(!(await sp.title()).includes('Kedai AnnurPro'), 'tajuk tanpa nama platform');
  await shot(sp, '53-kedai-pro');

  await sp.getByRole('button', { name: 'Tambah Kek Coklat ke troli' }).click();
  await sp.locator('.cart-bar').click();
  await sp.getByRole('dialog', { name: 'Troli' }).getByRole('button', { name: 'Teruskan' }).click();
  const co = sp.getByRole('dialog', { name: 'Semak dan hantar' });
  await co.getByLabel('Nama', { exact: true }).fill('Siti');
  assert.equal(await co.locator('.msg-preview').textContent(), 'Salam Kedai Pro!\nTempahan:\n1. Kek Coklat x1 = RM45.00\nJumlah RM45.00\nDaripada Siti');
  await shop.context.close();
});

test('Pelan Percuma: templat mesej dikunci dengan pautan ke pelan Pro', async () => {
  const { context, page } = await newPage({ sid: TOKEN_P });
  await page.goto(`${BASE}/app/#/tetapan`);
  const tpl = page.getByLabel('Templat mesej order');
  await tpl.waitFor();
  assert.equal(await tpl.isDisabled(), true);
  await page.getByText('Templat mesej sendiri untuk pelan Pro.').waitFor();
  assert.ok((await page.locator('#tpl-preview').textContent()).startsWith('Hai Kedai Produk, saya nak order:'));
  await context.close();
});

test('IPD 5.3 tempoh toleransi: notis dan lencana Toleransi; ciri Pro kekal', async () => {
  wrangler(['d1', 'execute', 'kedai-db', '--local', '--persist-to', state, '--command', "UPDATE shops SET plan_expires_at = date('now', '-3 days') WHERE id = 's-r'"], { cwd: cfgDir });
  const { context, page } = await newPage({ sid: TOKEN_R });
  await page.goto(`${BASE}/app/`);
  await page.getByText(/tempoh toleransi/).waitFor();
  await page.locator('.shop-head .badge', { hasText: 'Toleransi' }).waitFor();
  await shot(page, '54-toleransi');
  assert.equal((await apiGet('/api/me', TOKEN_R)).json.shop.plan.code, 'pro', 'masih Pro dalam toleransi');

  wrangler(['d1', 'execute', 'kedai-db', '--local', '--persist-to', state, '--command', "UPDATE shops SET plan_expires_at = date('now', '-30 days') WHERE id = 's-r'"], { cwd: cfgDir });
  await page.reload();
  await page.getByText(/Langganan Pro sudah tamat/).waitFor();
  await page.getByText('1 banner tidak dipaparkan di kedai awam').waitFor();
  assert.equal((await apiGet('/api/me', TOKEN_R)).json.shop.plan.code, 'free');
  await context.close();
});

// ================================================================ Fasa 7

test('IPD "Peniaga cuba jadi admin": /admin/ papar Akses ditolak dan API 403', async () => {
  const { context, page } = await newPage({ sid: TOKEN_B });
  await page.goto(`${BASE}/admin/`);
  await page.getByRole('heading', { name: 'Akses ditolak' }).waitFor();
  assert.equal((await apiGet('/api/admin/shops', TOKEN_B)).status, 403);
  await context.close();
});

test('S-16 superadmin: ringkasan kiraan, carian, butiran kedai', async () => {
  const { context, page } = await newPage({ width: 1280, height: 900, sid: TOKEN_M });
  await page.goto(`${BASE}/admin/`);
  await page.getByRole('heading', { level: 1, name: 'Kedai' }).waitFor();
  const api = (await apiGet('/api/admin/shops', TOKEN_M)).json;
  const total = page.locator('.tile', { hasText: 'Jumlah kedai' }).locator('.tile-value');
  await total.getByText(String(api.summary.shops), { exact: true }).waitFor();
  assert.ok(api.summary.shops >= 6, `${api.summary.shops} kedai`); // 5 seed + 1 dari wizard
  await page.getByLabel('Cari kedai').fill('kopi');
  await page.waitForFunction(() => document.querySelectorAll('.data-table tbody tr').length === 1);
  await page.getByRole('link', { name: 'Kopi O Pak Kopi' }).waitFor();
  await page.getByLabel('Cari kedai').fill('');
  await page.getByLabel('Tapis pelan').selectOption('pro'); // serta-merta selepas mengosongkan carian
  await page.getByRole('link', { name: 'Kedai Pro' }).waitFor();
  await page.waitForTimeout(600); // biar carian tertunda (debounce) selesai; keputusan mesti kekal
  const rows = await page.locator('.data-table tbody tr').allTextContents();
  assert.ok(rows.length >= 1 && rows.every((r) => !r.includes('Percuma')), rows.join(' | '));
  assert.ok(rows.some((r) => r.includes('Kedai Pro')));
  await shot(page, '60-admin-senarai');
  await context.close();

  const phone = await newPage({ sid: TOKEN_M });
  await phone.page.goto(`${BASE}/admin/`);
  await phone.page.locator('.data-table').waitFor();
  await noHorizontalScroll(phone.page);
  await phone.context.close();
});

test('S-17: tetapkan Pro dengan tarikh, tambah bulan, gantung (kedai awam 404) dan buka gantung; audit direkod', async () => {
  const { context, page } = await newPage({ width: 1280, height: 900, sid: TOKEN_M });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/admin/#/kedai/s-d`);
  await page.getByRole('heading', { level: 1, name: 'Kopi O Pak Kopi' }).waitFor();
  await page.getByLabel('Pelan', { exact: true }).selectOption('pro');
  await page.getByLabel('Tarikh tamat').fill('2099-01-31');
  await page.getByRole('button', { name: 'Simpan pelan' }).click();
  await page.getByText('Pelan dikemas kini.').waitFor();
  await page.getByText('Tamat 31/01/2099').waitFor();
  await page.getByRole('button', { name: '+1 bulan' }).click();
  await page.getByText('Tamat 28/02/2099').waitFor(); // 31 Jan + 1 bulan = 28 Feb (BSD peraturan 4)
  await page.getByRole('button', { name: '+1 bulan' }).click();
  await page.getByText('Tamat 31/03/2099').waitFor(); // kembali ke 31hb
  assert.equal((await fetch(`${BASE}/kopi-o`)).status, 200, 'snapshot diterbitkan selepas tukar pelan');

  await page.getByLabel('Sebab gantung (dipaparkan kepada peniaga)').fill('Ujian penggantungan');
  await page.getByRole('button', { name: 'Gantung kedai' }).click();
  await page.getByText('Digantung. Sebab: Ujian penggantungan').waitFor();
  assert.equal((await fetch(`${BASE}/kopi-o`)).status, 404, 'halaman awam ditutup');
  await shot(page, '61-admin-butiran');
  await page.getByRole('button', { name: 'Buka gantung' }).click();
  await page.getByText('Gantungan dibuka.').waitFor();
  assert.equal((await fetch(`${BASE}/kopi-o`)).status, 200);

  const audit = await page.locator('.audit-list li').allTextContents();
  for (const label of ['Tetapkan pelan', 'Tambah bulan', 'Gantung', 'Buka gantung']) assert.ok(audit.some((t) => t.includes(label)), label);
  assert.ok(audit.every((t) => t.includes('admin@ujian.test')));
  await context.close();
});

test('S-18: padankan bayaran tak padan, urus slug reserved, bina semula katalog', async () => {
  const { context, page } = await newPage({ width: 1280, height: 900, sid: TOKEN_M });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/admin/#/selenggara`);
  await page.getByText('BCL-UJI-1').waitFor();
  assert.equal(await page.getByLabel('Bilangan bulan untuk BCL-UJI-1').inputValue(), '2');
  await page.getByLabel('Slug kedai untuk BCL-UJI-1').fill('kedai-produk');
  await page.getByRole('button', { name: 'Padankan' }).click();
  await page.getByText(/Dipadankan\. Pro tamat \d{2}\/\d{2}\/\d{4}/).waitFor();
  await page.getByText('Tiada bayaran tak padan.').waitFor();
  const prod = (await apiGet('/api/me', TOKEN_P)).json.shop;
  assert.equal(prod.plan.code, 'pro', 'kedai yang dipadankan kini Pro');
  assert.equal((await apiGet('/api/billing', TOKEN_P)).json.payments[0].orderNo, 'BCL-UJI-1', 'peniaga nampak bayaran dalam sejarah');

  await page.getByLabel('Slug reserved baharu').fill('BankPalsu');
  await page.getByRole('button', { name: 'Tambah' }).click();
  await page.locator('.slug-chip', { hasText: 'bankpalsu' }).waitFor();
  const reserved = await fetch(`${BASE}/api/slug-check?slug=bankpalsu`, { headers: { Cookie: `__Host-sid=${TOKEN_A}` } });
  assert.equal(reserved.status, 401, 'pengguna A sudah log keluar dalam ujian awal');
  assert.equal((await apiGet('/api/slug-check?slug=bankpalsu', TOKEN_P)).json.reason, 'reserved');
  await page.getByRole('button', { name: 'Buang bankpalsu' }).click();
  await page.locator('.slug-chip', { hasText: 'bankpalsu' }).waitFor({ state: 'detached' });
  await touchTargets(page, '.slug-x');

  await page.getByRole('button', { name: 'Bina semula semua' }).click();
  await page.getByText(/Selesai: \d+ katalog dibina semula\./).waitFor({ timeout: 30000 });
  await shot(page, '62-admin-selenggara');
  await context.close();
});

// ================================================================ Fasa 8

test('S-15 Akaun: eksport JSON, padam kedai dengan pengesahan slug; R2, snapshot dan halaman awam dibuang', async () => {
  // Pastikan snapshot wujud dahulu supaya pemadaman snapshot benar-benar diuji.
  const rebuild = await fetch(`${BASE}/api/admin/rebuild-catalogs`, {
    method: 'POST',
    headers: { Cookie: `__Host-sid=${TOKEN_M}`, Origin: BASE, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(rebuild.status, 200);
  assert.equal((await fetch(`${BASE}/kedai-padam`)).status, 200);
  assert.ok(r2Get('catalog/kedai-padam.json').length > 0);
  assert.ok(r2Get(PADAM_IMG).length > 0);

  const { context, page } = await newPage({ sid: TOKEN_X });
  await page.goto(`${BASE}/app/#/akaun`);
  await page.getByRole('heading', { name: 'Data anda' }).waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Muat turun data saya/ }).click()]);
  assert.match(download.suggestedFilename(), /^kedai-kedai-padam-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(data.akaun.email, 'padam@ujian.test');
  assert.equal(data.kedai.slug, 'kedai-padam');
  assert.equal(data.kedai.produk[0].nama, 'Karipap Padam');
  await page.getByText('Data dimuat turun.').waitFor();

  const del = page.getByRole('button', { name: 'Padam kedai selama-lamanya' });
  assert.equal(await del.isDisabled(), true);
  await page.getByLabel('Taip "kedai-padam" untuk sahkan').fill('kedai-salah');
  assert.equal(await del.isDisabled(), true, 'slug salah: butang kekal dilumpuhkan');
  await page.getByLabel('Taip "kedai-padam" untuk sahkan').fill('Kedai-Padam ');
  assert.equal(await del.isDisabled(), false);
  await noHorizontalScroll(page);
  await shot(page, '70-akaun');

  // API menolak pengesahan yang salah walaupun UI dipintas.
  const bad = await fetch(`${BASE}/api/shop`, {
    method: 'DELETE',
    headers: { Cookie: `__Host-sid=${TOKEN_X}`, Origin: BASE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmSlug: 'wakanda' }),
  });
  assert.equal(bad.status, 400);

  page.once('dialog', (d) => d.accept());
  await del.click();
  await page.getByRole('heading', { level: 1, name: 'Setup kedai' }).waitFor();
  assert.equal((await apiGet('/api/me', TOKEN_X)).json.shop, null);
  assert.throws(() => r2Get(PADAM_IMG), 'gambar produk dipadam');
  assert.throws(() => r2Get('shops/s-x/b_99999999-2222-4333-8444-555555555555.webp'), 'objek yatim pun dipadam');
  assert.throws(() => r2Get('catalog/kedai-padam.json'), 'snapshot dipadam');
  assert.equal((await fetch(`${BASE}/kedai-padam`)).status, 404);
  assert.equal((await apiGet('/api/me', TOKEN_B)).json.shop.slug, 'wakanda', 'kedai lain tak terjejas');
  await context.close();
});

test('IPD LCP halaman kedai: Slow 4G (1.6 Mbps, RTT 150 ms) dan CPU 4x, banner WebP sebenar', async () => {
  // Gambar sebenar: banner 1600x800 dan gambar produk 400x400, WebP kualiti 0.8 seperti selepas mampatan di browser.
  const gen = await newPage();
  const make = (w, h) => gen.page.evaluate(async ([w, h]) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0f766e');
    g.addColorStop(1, '#f59e0b');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      x.fillStyle = `hsla(${(i * 47) % 360},70%,55%,0.7)`;
      x.beginPath();
      x.arc(Math.random() * w, Math.random() * h, 20 + Math.random() * w * 0.12, 0, 7);
      x.fill();
    }
    const img = x.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    x.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, [w, h]);
  const banner = Buffer.from(await make(1600, 800));
  const product = Buffer.from(await make(400, 400));
  await gen.context.close();

  // Throttle CDP tak terpakai pada request yang dipintas oleh context.route, jadi rangkaian dimodelkan sendiri:
  // semua respons berkongsi satu pautan 1.6 Mbps (dihantar bergilir), setiap request tambah 1 RTT, dan request
  // pertama tambah 3 RTT lagi untuk DNS, TCP dan TLS. Saiz HTML/JS/CSS tanpa mampatan (Cloudflare guna brotli),
  // jadi anggaran ini condong ke arah lebih perlahan.
  const BW = 1.6e6 / 8; // bait sesaat
  const RTT = 150;
  let linkFree = 0;
  let first = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const throttled = async (bytes) => {
    const start = Date.now() + RTT + (first ? 3 * RTT : 0);
    first = false;
    const done = Math.max(start, linkFree) + (bytes / BW) * 1000;
    linkFree = done;
    await sleep(done - Date.now());
  };
  const { context, page } = await newPage({ width: 412, height: 823 });
  await context.route(`${BASE}/**`, async (route) => {
    const resp = await route.fetch();
    const body = await resp.body();
    await throttled(body.length);
    await route.fulfill({ response: resp, body });
  });
  await context.route(`${MEDIA}/shops/**`, async (route) => {
    const body = route.request().url().includes('/b_') ? banner : product;
    await throttled(body.length);
    await route.fulfill({ contentType: 'image/webp', body });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  await page.goto(`${BASE}/kedai-laju`, { waitUntil: 'load' });
  await page.locator('.shop-banner').evaluate((img) => (img.complete ? null : new Promise((r) => img.addEventListener('load', r, { once: true }))));
  await page.waitForTimeout(500);
  const lcp = await page.evaluate(() => new Promise((resolve) => {
    new PerformanceObserver((list) => {
      const e = list.getEntries().at(-1);
      resolve({ ms: Math.round(e.startTime), el: e.element ? `${e.element.tagName}.${e.element.className}` : '?' });
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  }));
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return { ttfb: Math.round(n.responseStart), html: n.encodedBodySize };
  });
  console.log(`# LCP kedai (Slow 4G + CPU 4x): ${lcp.ms} ms, elemen ${lcp.el}; TTFB ${nav.ttfb} ms; HTML ${nav.html} B; banner ${Math.round(banner.length / 1024)} KB; produk ${Math.round(product.length / 1024)} KB`);
  assert.ok(lcp.ms <= 2500, `LCP ${lcp.ms} ms melebihi 2.5 s`);

  // Troli dengan item berharga sahaja: tiada teks "null" daripada nod kosong.
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.locator('.p-add').first().click();
  await page.locator('.cart-bar').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByText('Jumlah').waitFor();
  assert.ok(!/\bnull\b/.test(await sheet.innerText()), await sheet.innerText());
  await context.close();
});



// ================================================================ Fasa 6

test('S-14 + webhook BCL: butang Bayar ke borang, e-mel untuk disalin, kembali ?bayar=berjaya dan Pro aktif sendiri; webhook berganda tak tambah masa', async () => {
  const { context, page } = await newPage({ sid: TOKEN_F });
  await page.goto(`${BASE}/app/#/langganan`);
  await page.getByRole('heading', { name: 'Naik taraf ke Pro' }).waitFor();
  const pay = page.getByRole('link', { name: 'Bayar melalui BCL' });
  assert.equal(await pay.getAttribute('href'), BCL_FORM_URL);
  assert.equal(await pay.getAttribute('target'), '_blank');
  assert.equal(await page.locator('#pay-email').textContent(), 'bayar@ujian.test');
  await page.getByText('RM20.00 sebulan atau RM200.00 setahun', { exact: false }).first().waitFor();
  await touchTargets(page, '.pay-card .btn');
  await noHorizontalScroll(page);
  await shot(page, '52-langganan-bayar');

  // Pembeli kembali dari BCL sebelum webhook sampai: halaman menunggu dan menyemak sendiri.
  await page.goto(`${BASE}/app/?bayar=berjaya#/langganan`);
  await page.getByText('Bayaran sedang disahkan dengan BCL').waitFor();
  assert.equal(new URL(page.url()).search, '', '?bayar dibuang daripada URL');

  const order = 'E2E-ORD-1';
  bclTx[order] = {
    main: { status: 3, is_paid: 1, amount: '201.00', subtotal_amount: '200.00', items: [{ name: 'KEDAI PRO TAHUNAN', quantity: 1 }], payer_email: 'suami@lain.test', transaction_type: 'live' },
    custom: { 'E-mel akaun Google untuk log masuk': 'Bayar@Ujian.test' },
  };
  const body = { event: 'payment-success', data: { formable_type: 'payment_form', formable_id: 21437, record_type: 'Transaction', record_id: order,
    main_data: { order_number: order, amount: '201.00', subtotal_amount: '200.00', transaction_type: 'live', status: 3 }, custom_fields_data: bclTx[order].custom } };
  const send = (key = BCL_KEY) => fetch(`${BASE}/api/webhooks/bcl/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await send('salah')).status, 404);
  const r = await send();
  assert.equal(r.status, 200);

  await page.getByText(/Terima kasih\. Pro aktif sehingga \d{2}\/\d{2}\/\d{4}\./).waitFor({ timeout: 20000 });
  await page.locator('.pay-list').getByText('Tahunan x1').waitFor();
  const me = (await apiGet('/api/me', TOKEN_F)).json.shop;
  assert.equal(me.plan.code, 'pro');
  const expires = me.planStatus.expiresAt;
  await shot(page, '53-langganan-aktif');

  // Resend dari BCL: tiada tambahan masa.
  assert.equal((await send()).status, 200);
  await new Promise((res) => setTimeout(res, 800));
  assert.equal((await apiGet('/api/me', TOKEN_F)).json.shop.planStatus.expiresAt, expires);
  assert.equal((await apiGet('/api/billing', TOKEN_F)).json.payments.length, 1);

  // Kembali dengan ?bayar=gagal: notis gagal, tiada perubahan.
  await page.goto(`${BASE}/app/?bayar=gagal#/langganan`);
  await page.getByText('Bayaran tak berjaya atau dibatalkan').waitFor();
  await context.close();
});

// ================================================================ Tema dan PWA

// Nisbah kontras WCAG antara warna teks dan latar sebenar (naik ke ibu bapa sehingga jumpa latar legap).
async function contrastOf(page, selector) {
  return page.evaluate((sel) => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const el = document.querySelector(sel);
    const fg = parse(getComputedStyle(el).color);
    let node = el;
    let bg = [0, 0, 0, 0];
    while (node) {
      bg = parse(getComputedStyle(node).backgroundColor);
      if (bg.length === 3 || bg[3] === undefined || bg[3] > 0.95) break;
      node = node.parentElement;
    }
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  }, selector);
}

test('Tema landing: cerah lalai (tak ikut sistem), tukar ke gelap dan kekal selepas muat semula, kontras teks >= 4.5:1 dalam kedua-dua tema', async () => {
  const { context, page } = await newPage();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${BASE}/`);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light', 'sistem gelap pun tetap cerah');
  await revealAll(page);
  const checks = ['.hero .lead', '.hero-cta .btn', '.eyebrow', '.card p', '.faq-list summary', '.accent', '.site-footer', '.seg button[aria-pressed="false"]'];
  for (const sel of checks) {
    const ratio = await contrastOf(page, sel);
    assert.ok(ratio >= 4.5, `cerah ${sel}: ${ratio.toFixed(2)}`);
  }
  await shot(page, '00-landing-cerah');
  await page.getByRole('button', { name: 'Tukar tema cerah atau gelap' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  for (const sel of checks) {
    const ratio = await contrastOf(page, sel);
    assert.ok(ratio >= 4.5, `gelap ${sel}: ${ratio.toFixed(2)}`);
  }
  await shot(page, '00-landing-gelap');
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'pilihan tema diingat');
  await page.getByRole('button', { name: 'Tukar tema cerah atau gelap' }).click();
  await context.close();
});

test('Landing: animasi scroll (bahagian muncul bila masuk skrin), dimatikan untuk prefers-reduced-motion', async () => {
  const { context, page } = await newPage();
  await page.goto(`${BASE}/`);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('motion')), true);
  const faq = page.locator('.faq-list details').first();
  const opacity = () => faq.evaluate((el) => Number(getComputedStyle(el).opacity));
  assert.equal(await opacity(), 0, 'bawah skrin: belum muncul');
  await faq.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.faq-list details').classList.contains('in'));
  await page.waitForTimeout(900);
  assert.equal(await opacity(), 1);
  const py = await page.locator('.device-wrap').evaluate((el) => el.style.getPropertyValue('--py'));
  assert.match(py, /^-\d+px$/, `parallax hero bergerak: ${py}`);
  await context.close();

  const calm = await newPage();
  await calm.page.emulateMedia({ reducedMotion: 'reduce' });
  await calm.page.goto(`${BASE}/`);
  assert.equal(await calm.page.evaluate(() => document.documentElement.classList.contains('motion')), false);
  assert.equal(await calm.page.locator('.faq-list details').first().evaluate((el) => getComputedStyle(el).opacity), '1');
  await calm.context.close();
});

test('Cropper: gambar potret dalam bingkai segi empat; seret, zum dan Batal; hasil potongan mengikut pilihan', async () => {
  const { context, page } = await newPage({ sid: TOKEN_B });
  await page.goto(`${BASE}/app/`);
  await page.locator('.bottom-nav').waitFor();
  const result = await page.evaluate(async () => {
    const { openCropper } = await import('/assets/js/cropper.js');
    // Gambar potret 400 x 800: separuh atas merah, separuh bawah biru.
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 800;
    const x = c.getContext('2d');
    x.fillStyle = '#f00';
    x.fillRect(0, 0, 400, 400);
    x.fillStyle = '#00f';
    x.fillRect(0, 400, 400, 400);
    const bmp = await createImageBitmap(c);
    window.__crop = openCropper(bmp, 'product');
    return { w: bmp.width, h: bmp.height };
  });
  assert.deepEqual(result, { w: 400, h: 800 });
  const dialog = page.getByRole('dialog', { name: 'Potong gambar produk' });
  await dialog.waitFor();
  const frame = dialog.locator('.crop-frame');
  const box = await frame.boundingBox();
  assert.ok(Math.abs(box.width - box.height) < 2, `bingkai segi empat ${box.width}x${box.height}`);
  await touchTargets(page, '.crop-actions .btn');
  await noHorizontalScroll(page);
  await shot(page, '14-cropper');

  // Seret ke bawah sejauh mungkin: bahagian atas (merah) dipilih.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 3, { steps: 8 });
  await page.mouse.up();
  await dialog.getByLabel('Zum gambar').fill('2');
  await dialog.getByRole('button', { name: 'Guna gambar' }).click();
  const crop = await page.evaluate(() => window.__crop);
  assert.ok(Math.abs(crop.sw - crop.sh) < 1, 'potongan segi empat');
  assert.ok(Math.abs(crop.sw - 200) < 2, `zum 2x: lebar sumber 200, dapat ${crop.sw}`);
  assert.ok(crop.sy < 150, `potongan di bahagian atas gambar (sy=${crop.sy})`);

  // Batal (Escape) memulangkan null.
  await page.evaluate(async () => {
    const { openCropper } = await import('/assets/js/cropper.js');
    const bmp = await createImageBitmap(Object.assign(document.createElement('canvas'), { width: 300, height: 100 }));
    window.__crop2 = openCropper(bmp, 'banner');
  });
  await page.getByRole('dialog', { name: 'Potong banner' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__crop2), null);
  await context.close();
});

test('Landing: menu phone, harga bulanan/tahunan dengan jimat dikira daripada /api/plans, FAQ boleh dibuka', async () => {
  const { context, page } = await newPage();
  await page.goto(`${BASE}/`);
  const menu = page.getByRole('button', { name: 'Buka menu' });
  await menu.click();
  const panel = page.locator('#menu-panel');
  await panel.waitFor();
  await touchTargets(page, '#menu-panel a');
  await shot(page, '00-landing-menu');
  await panel.getByRole('link', { name: 'Harga' }).click();
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Buka menu' }).getAttribute('aria-expanded'), 'false');

  const pro = (await (await fetch(`${BASE}/api/plans`)).json()).plans.find((p) => p.code === 'pro');
  await page.getByRole('button', { name: 'Tahunan' }).click();
  await page.locator('[data-plan="pro.year"]').getByText(`RM${pro.priceYearSen / 100}`).waitFor();
  assert.equal(await page.locator('[data-price="month"]').isVisible(), false);
  const save = (pro.priceMonthSen * 12 - pro.priceYearSen) / 100;
  await page.getByText(`Jimat RM${save}`).waitFor();
  await page.getByRole('button', { name: 'Bulanan' }).click();
  assert.equal(await page.locator('[data-save]').isVisible(), false);

  const first = page.locator('.faq-list details').first();
  await first.locator('summary').click();
  assert.equal(await first.evaluate((d) => d.open), true);
  await noHorizontalScroll(page);
  await context.close();
});

test('PWA: manifest sah, ikon wujud dengan saiz sebenar, scope merangkumi start_url, kedai awam tak dimasukkan dalam cache', async () => {
  const res = await fetch(`${BASE}/manifest.webmanifest`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/manifest\+json/);
  const m = await res.json();
  assert.equal(m.display, 'standalone');
  assert.equal(m.lang, 'ms');
  assert.ok(m.name && m.short_name.length <= 12);
  assert.ok(new URL(m.start_url, BASE).pathname.startsWith(m.scope === '/' ? '/' : m.scope), 'start_url dalam scope');
  assert.match(m.theme_color, /^#[0-9A-Fa-f]{6}$/);
  const purposes = new Set(m.icons.map((i) => i.purpose));
  assert.ok(purposes.has('any') && purposes.has('maskable'));
  for (const icon of m.icons) {
    const r = await fetch(`${BASE}${icon.src}`);
    assert.equal(r.status, 200, icon.src);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.readUInt32BE(16), Number(icon.sizes.split('x')[0]), `lebar PNG ${icon.src}`);
    assert.equal(buf.readUInt32BE(20), Number(icon.sizes.split('x')[1]), `tinggi PNG ${icon.src}`);
  }
  for (const s of m.screenshots) assert.equal((await fetch(`${BASE}${s.src}`)).status, 200, s.src);
  assert.ok(m.screenshots.some((s) => s.form_factor === 'wide') && m.screenshots.some((s) => s.form_factor === 'narrow'));
  for (const sc of m.shortcuts) assert.equal(new URL(sc.url, BASE).pathname, '/app/');
  assert.equal((await fetch(`${BASE}/assets/icons/apple-touch-icon.png`)).status, 200);

  const sw = await fetch(`${BASE}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('cache-control') || '', /no-cache/);
  assert.match(sw.headers.get('content-type') || '', /javascript/);

  // Halaman yang menggunakan PWA menyambung manifest dan ikon sentuh Apple.
  for (const path of ['/', '/app/', '/privasi', '/terma']) {
    const html = await (await fetch(`${BASE}${path}`)).text();
    assert.ok(html.includes('rel="manifest" href="/manifest.webmanifest"'), `${path} tiada manifest`);
    assert.ok(html.includes('rel="apple-touch-icon"'), `${path} tiada apple-touch-icon`);
  }
});

test('PWA offline: service worker aktif, halaman yang pernah dibuka dipaparkan tanpa internet, halaman baharu dapat offline.html, /api dan kedai tak di-cache', async () => {
  const { context, page } = await newPage({ sw: true });
  await page.goto(`${BASE}/privasi`);
  // Tunggu SW mengawal halaman (clients.claim) dan muat semula supaya semua aset melaluinya dan masuk cache.
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
  await page.reload();
  await page.goto(`${BASE}/`);
  await page.goto(`${BASE}/terma`);
  await page.goto(`${BASE}/app/`);
  await page.getByRole('heading', { name: 'Log masuk peniaga' }).waitFor();

  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls = [];
    for (const k of keys) for (const r of await (await caches.open(k)).keys()) urls.push(new URL(r.url).pathname);
    return { keys, urls };
  });
  assert.ok(cached.keys.some((k) => k.startsWith('kedai-')));
  assert.ok(cached.urls.includes('/offline.html') && cached.urls.includes('/privasi') && cached.urls.includes('/app/'), cached.urls.join(','));
  assert.ok(!cached.urls.some((u) => u.startsWith('/api/')), 'tiada /api dalam cache');
  assert.ok(!cached.urls.some((u) => u.startsWith('/kedai-')), 'tiada halaman kedai dalam cache');

  await context.setOffline(true);
  await page.goto(`${BASE}/privasi`);
  await page.getByRole('heading', { level: 1, name: 'Dasar Privasi' }).waitFor();
  await page.goto(`${BASE}/app/`);
  await page.locator('#app').waitFor();
  await page.goto(`${BASE}/terma`);
  await page.getByRole('heading', { level: 1, name: 'Terma Perkhidmatan' }).waitFor();
  await page.goto(`${BASE}/`); // landing pernah dibuka
  await page.getByRole('heading', { level: 1 }).waitFor();
  await shot(page, '00-offline-cache');
  await context.setOffline(false);
  await context.close();

  // Penyemak imbas baharu (cache kosong kecuali precache): halaman yang belum pernah dibuka offline -> offline.html
  const fresh = await newPage({ sw: true });
  await fresh.page.goto(`${BASE}/terma`);
  await fresh.page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
  await fresh.context.setOffline(true);
  await fresh.page.goto(`${BASE}/app/`).catch(() => {});
  await fresh.page.getByRole('heading', { name: 'Tiada sambungan internet' }).waitFor();
  assert.equal(await fresh.page.getByRole('link', { name: 'Cuba lagi' }).getAttribute('href'), '/app/');
  await shot(fresh.page, '00-offline-html');
  await fresh.context.setOffline(false);
  await fresh.context.close();
});

test('PWA dashboard: kad "Pasang app" muncul hanya bila pelayar menawarkan pemasangan, dan memanggil prompt()', async () => {
  const { context, page } = await newPage({ sid: TOKEN_B });
  await page.goto(`${BASE}/app/#/akaun`);
  await page.getByRole('heading', { name: 'Data anda' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Pasang app' }).isVisible(), false, 'tiada tawaran: kad tersembunyi');
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => {
      window.__prompted = (window.__prompted || 0) + 1;
      return Promise.resolve();
    };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await page.getByRole('heading', { name: 'Pasang app' }).waitFor();
  await page.locator('section', { hasText: 'Pasang app' }).getByRole('button', { name: 'Pasang app' }).click();
  await page.waitForFunction(() => window.__prompted === 1);
  await page.getByRole('heading', { name: 'Pasang app' }).waitFor({ state: 'hidden' });
  await context.close();
});

test('PWA desktop: dashboard di 1280 px guna sidebar, tiada skrol mendatar; landing di desktop tanpa bar CTA melekat', async () => {
  const { context, page } = await newPage({ width: 1280, height: 800, sid: TOKEN_B });
  await page.goto(`${BASE}/app/`);
  await page.locator('.bottom-nav').waitFor();
  const nav = await page.locator('.bottom-nav').boundingBox();
  assert.ok(nav.width < 300 && nav.x === 0, `sidebar ${nav.width}x${nav.height}`);
  await noHorizontalScroll(page);
  await page.goto(`${BASE}/`);
  assert.equal(await page.locator('.cta-bar').isVisible(), false);
  assert.equal(await page.locator('.site-nav').isVisible(), true);
  assert.equal(await page.locator('.menu-toggle').isVisible(), false);
  await context.close();
});

test('Tiada pelanggaran CSP atau ralat JavaScript dalam semua senario', () => {
  assert.deepEqual(consoleProblems, []);
});
