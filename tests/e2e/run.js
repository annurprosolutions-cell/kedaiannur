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
const XSS_NAME = '<img src=x onerror="window.__xss=1">';
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let tmp;
let state;
let cfgDir;
let server;
let browser;
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
  ('u-r', 'sub-r', 'pro@ujian.test', 'Puan Pro');
INSERT INTO sessions (token_hash, user_id, expires_at) VALUES
  ('${sha(TOKEN_A)}', 'u-a', datetime('now', '+1 day')),
  ('${sha(TOKEN_B)}', 'u-b', datetime('now', '+1 day')),
  ('${sha(TOKEN_W)}', 'u-w', datetime('now', '+1 day')),
  ('${sha(TOKEN_E)}', 'u-e', datetime('now', '+1 day')),
  ('${sha(TOKEN_P)}', 'u-p', datetime('now', '+1 day')),
  ('${sha(TOKEN_R)}', 'u-r', datetime('now', '+1 day'));
INSERT INTO shops (id, owner_user_id, slug, name, whatsapp, description) VALUES
  ('s-b', 'u-b', 'wakanda', 'Kedai Wakanda', '60123456789', ''),
  ('s-d', 'u-d', 'kopi-o', 'Kopi O Pak Kopi', '60111111111', ''),
  ('s-e', 'u-e', 'tetapan-uji', 'Kedai Tetapan', '60123456789', 'Penerangan asal'),
  ('s-p', 'u-p', 'kedai-produk', 'Kedai Produk', '60123456789', '');
INSERT INTO shops (id, owner_user_id, slug, name, whatsapp, description, plan_code, plan_expires_at) VALUES
  ('s-r', 'u-r', 'kedai-pro', 'Kedai Pro', '60198765432', '', 'pro', date('now', '+10 days'));
`;
  writeFileSync(join(tmp, 'seed.sql'), seed);
  wrangler(['d1', 'execute', 'kedai-db', '--local', '--persist-to', state, '--file', join(tmp, 'seed.sql')], { cwd: cfgDir });

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
    ],
    { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'ignore', detached: true },
  );
  await waitUp();
  browser = await chromium.launch();
  bigJpeg = await makeBigJpeg();
});

after(async () => {
  if (browser) await browser.close();
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

async function newPage({ width = 360, height = 780, sid, permissions } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, permissions });
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
    if (msg.type() === 'error' && !/Failed to load resource: the server responded with a status of (401|404)/.test(text)) {
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

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

// ================================================================ Fasa 0 dan 1

test('Fasa 0: laman "Hello" dimuatkan di phone 360 px', async () => {
  const { context, page } = await newPage();
  const res = await page.goto(`${BASE}/`);
  assert.equal(res.status(), 200);
  assert.ok(res.headers()['content-security-policy'].includes("frame-ancestors 'none'"));
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Log masuk peniaga' }).getAttribute('href'), '/app/');
  await noHorizontalScroll(page);
  await shot(page, '00-hello');
  await context.close();
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
  assert.ok(Math.abs(res.out.product.width / res.out.product.height - 4 / 3) < 0.01, 'produk kekal nisbah asal 4:3 (tak dipotong)');
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
  await page.getByRole('cell', { name: 'RM29.00 sebulan atau RM290.00 setahun' }).waitFor();
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

test('Tiada pelanggaran CSP atau ralat JavaScript dalam semua senario', () => {
  assert.deepEqual(consoleProblems, []);
});
