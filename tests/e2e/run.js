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
  ('u-e', 'sub-e', 'tetapan@ujian.test', 'Kak Tetapan');
INSERT INTO sessions (token_hash, user_id, expires_at) VALUES
  ('${sha(TOKEN_A)}', 'u-a', datetime('now', '+1 day')),
  ('${sha(TOKEN_B)}', 'u-b', datetime('now', '+1 day')),
  ('${sha(TOKEN_W)}', 'u-w', datetime('now', '+1 day')),
  ('${sha(TOKEN_E)}', 'u-e', datetime('now', '+1 day'));
INSERT INTO shops (id, owner_user_id, slug, name, whatsapp, description) VALUES
  ('s-b', 'u-b', 'wakanda', 'Kedai Wakanda', '60123456789', ''),
  ('s-d', 'u-d', 'kopi-o', 'Kopi O Pak Kopi', '60111111111', ''),
  ('s-e', 'u-e', 'tetapan-uji', 'Kedai Tetapan', '60123456789', 'Penerangan asal');
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

async function newPage({ width = 360, height = 780, sid } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
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
    if (url.startsWith(`${MEDIA}/`)) return route.fulfill({ contentType: 'image/png', body: PNG_1X1 });
    if (url.startsWith(BASE)) return route.continue();
    return route.abort(); // tiada rangkaian luar dalam ujian
  });
  const page = await context.newPage();
  openPages.push(page);
  if (process.env.E2E_DEBUG) page.on('console', (m) => console.log('[konsol]', m.type(), m.text()));
  page.on('console', (msg) => {
    const text = msg.text();
    // 401 daripada /api/me ialah aliran biasa (belum login); yang lain dikira masalah.
    if (msg.type() === 'error' && !/Failed to load resource: the server responded with a status of 401/.test(text)) {
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
  await page.getByText('kedai.annurpro.com/wakanda').waitFor();
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

test('Tiada pelanggaran CSP atau ralat JavaScript dalam semua senario', () => {
  assert.deepEqual(consoleProblems, []);
});
