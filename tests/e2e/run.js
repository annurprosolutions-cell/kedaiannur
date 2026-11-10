// Ujian hujung ke hujung: jalankan `wrangler pages dev` (runtime Cloudflare sebenar, D1 local),
// kemudian pandu Chromium melalui Playwright. Butang Google dipalsukan; sesi disuntik terus ke D1
// kerana token Google sebenar tak boleh dijana dalam ujian (laluan token diuji dalam tests/*.test.js).
//
// Guna:  npm run test:e2e
// Pilihan env: WRANGLER_BIN=<path ke wrangler.js>  E2E_TMP=<folder sementara>  E2E_SHOTS=<folder screenshot>

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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

const wranglerCmd = process.env.WRANGLER_BIN
  ? [process.execPath, [process.env.WRANGLER_BIN]]
  : ['npx', ['--yes', 'wrangler@4']];

const token = (c) => c.repeat(43);
const sha = (t) => createHash('sha256').update(t).digest('hex');
const TOKEN_A = token('A'); // pengguna tanpa kedai, nama mengandungi HTML
const TOKEN_B = token('B'); // pengguna dengan kedai
const XSS_NAME = '<img src=x onerror="window.__xss=1">';

let tmp;
let server;
let browser;
const consoleProblems = [];

function wrangler(args, opts = {}) {
  const [cmd, base] = wranglerCmd;
  return execFileSync(cmd, [...base, ...args], {
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    stdio: 'pipe',
    ...opts,
  });
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

before(async () => {
  tmp = mkdtempSync(join(process.env.E2E_TMP || tmpdir(), 'kedai-e2e-'));
  const cfgDir = join(tmp, 'd1cfg');
  const state = join(tmp, 'state');
  mkdirSync(cfgDir);
  writeFileSync(
    join(cfgDir, 'wrangler.toml'),
    'name = "kedai-e2e"\ncompatibility_date = "2025-09-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "kedai-db"\ndatabase_id = "kedai-db-e2e"\n',
  );
  const seed = `${readFileSync(join(ROOT, 'db/0001_init.sql'), 'utf8')}
INSERT INTO users (id, google_sub, email, name) VALUES
  ('u-a', 'sub-a', 'baru@ujian.test', '${XSS_NAME.replace(/'/g, "''")}'),
  ('u-b', 'sub-b', 'wakanda@ujian.test', 'Mak Wakanda');
INSERT INTO sessions (token_hash, user_id, expires_at) VALUES
  ('${sha(TOKEN_A)}', 'u-a', datetime('now', '+1 day')),
  ('${sha(TOKEN_B)}', 'u-b', datetime('now', '+1 day'));
INSERT INTO shops (id, owner_user_id, slug, name, whatsapp) VALUES
  ('s-b', 'u-b', 'wakanda', 'Kedai Wakanda', '60123456789');
`;
  writeFileSync(join(tmp, 'seed.sql'), seed);
  wrangler(['d1', 'execute', 'kedai-db', '--local', '--persist-to', state, '--file', join(tmp, 'seed.sql')], { cwd: cfgDir });

  const [cmd, base] = wranglerCmd;
  server = spawn(
    cmd,
    [
      ...base, 'pages', 'dev', 'public', '--port', String(PORT), '--ip', '127.0.0.1',
      '--compatibility-date', '2025-09-01', '--d1', 'DB=kedai-db-e2e', '--persist-to', state,
      '--binding', 'GOOGLE_CLIENT_ID=e2e-client.apps.googleusercontent.com',
      '--binding', 'SUPERADMIN_EMAILS=admin@ujian.test',
      '--binding', 'SESSION_DAYS=30',
    ],
    { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'ignore', detached: true },
  );
  await waitUp();
  browser = await chromium.launch();
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
    if (url.startsWith(BASE)) return route.continue();
    return route.abort(); // tiada rangkaian luar dalam ujian
  });
  const page = await context.newPage();
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

async function noHorizontalScroll(page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `skrol mendatar: ${sw} > ${cw}`);
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

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

  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/auth/google')),
    btn.click(),
  ]);
  assert.equal(resp.status(), 401, 'lepas semakan Origin dan Content-Type, ditolak oleh pengesahan token');
  await page.getByText('Login tak berjaya, cuba lagi.').waitFor();
  await context.close();
});

test('S-08: akaun baharu tanpa kedai; nama berisi HTML dipapar sebagai teks; logout', async () => {
  const { context, page } = await newPage({ sid: TOKEN_A });
  await page.goto(`${BASE}/app/`);
  await page.getByRole('heading', { name: 'Setup kedai' }).waitFor();
  const h1 = await page.getByRole('heading', { level: 1 }).textContent();
  assert.equal(h1, `Hai, ${XSS_NAME}`);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'skrip XSS tak boleh berjalan');
  assert.equal(await page.locator('.bottom-nav').count(), 0, 'tiada navigasi sebelum kedai dicipta');
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
  for (const box of await Promise.all((await links.all()).map((l) => l.boundingBox()))) {
    assert.ok(box.height >= 44, `sasaran sentuh ${box.height}px`);
  }
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

test('Tiada pelanggaran CSP atau ralat JavaScript dalam semua senario', () => {
  assert.deepEqual(consoleProblems, []);
});
