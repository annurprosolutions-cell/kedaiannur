// Fasa 6: webhook BCL (IPD 6.2, 6.3, 6.4 dan ujian seksyen 6: webhook berganda, webhook palsu, bayaran tak padan).

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser, insertShop, SHOP_BODY } from './helpers/seed.js';
import { processBcl, pickEmail, monthsFromItems, safeEqual } from '../lib/bcl.js';
import { extendExpiry } from '../lib/subscription.js';

const KEY = 'k'.repeat(48);
const FORM = 21437;
let env;
let calls;
let txs;
let realFetch;

// API BCL palsu: GET /transactions/{order} memulangkan transaksi daripada `txs`.
function fakeFetch(url, init) {
  calls.push({ url: String(url), auth: init && init.headers && init.headers.authorization, ua: init && init.headers && init.headers['user-agent'] });
  const order = decodeURIComponent(String(url).split('/transactions/')[1] || '');
  const t = txs[order];
  if (!t) return Promise.resolve(new Response(JSON.stringify({ success: false }), { status: 404 }));
  return Promise.resolve(Response.json({ success: true, data: { record_id: order, main_data: { order_number: order, ...t.main }, custom_fields_data: t.custom } }));
}

const ITEM_M = 'KEDAI PRO BULANAN';
const ITEM_Y = 'KEDAI PRO TAHUNAN';

function tx(order, { items = [{ name: ITEM_Y, quantity: 1, amount: '200.00' }], subtotal = '200.00', email = 'Pemilik@Ujian.test', status = 3, type = 'live' } = {}) {
  const total = (parseFloat(subtotal) + 1).toFixed(2);
  txs[order] = {
    main: { status, is_paid: status === 3 ? 1 : 0, amount: total, subtotal_amount: subtotal, items, payer_email: 'pembayar@lain.test', transaction_type: type },
    custom: { 'E-mel akaun Google untuk log masuk': email },
  };
  return {
    event: 'payment-success',
    data: {
      formable_type: 'payment_form', formable_id: FORM, record_type: 'Transaction', record_id: order,
      main_data: { order_number: order, amount: total, subtotal_amount: subtotal, payer_email: 'pembayar@lain.test', transaction_type: type, status, items },
      custom_fields_data: { 'E-mel akaun Google untuk log masuk': email },
    },
  };
}

const hook = (body, key = KEY) => callApi(env, 'POST', `/api/webhooks/bcl/${key}`, { body, origin: null });
const today = () => new Date().toISOString().slice(0, 10);
const plus = (months) => extendExpiry({ plan_code: 'free', plan_expires_at: null }, months, env).expiresAt;
const payments = () => env.DB.sqlite.prepare('SELECT order_no, shop_id, payer_email, amount_sen, period, quantity, months_added, status FROM payments ORDER BY order_no').all().map((r) => ({ ...r }));
const shopRow = (id) => ({ ...env.DB.sqlite.prepare('SELECT plan_code, plan_expires_at, plan_anchor_day FROM shops WHERE id = ?').get(id) });

beforeEach(() => {
  env = makeEnv({ BCL_WEBHOOK_KEY: KEY, BCL_API_TOKEN: 'bcl_ujian', BCL_FORM_ID: String(FORM), BCL_API_URL: 'https://bcl.test/v1' });
  calls = [];
  txs = {};
  realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch; // endpoint memanggil fetch global; processBcl langsung boleh terima fetchFn
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('kunci webhook: salah, kosong atau tak ditetapkan = 404; GET = 405; tiada semakan Origin atau sesi', async () => {
  assert.equal((await hook(tx('A1'), 'salah')).status, 404);
  assert.equal((await hook(tx('A1'), `${KEY}x`)).status, 404);
  const noKey = makeEnv({ BCL_API_TOKEN: 'x' });
  assert.equal((await callApi(noKey, 'POST', `/api/webhooks/bcl/${KEY}`, { body: tx('A1'), origin: null })).status, 404);
  assert.equal((await callApi(env, 'GET', `/api/webhooks/bcl/${KEY}`, { origin: null })).status, 405);
  assert.equal((await callApi(env, 'POST', `/api/webhooks/bcl/${KEY}`, { body: '{rosak', origin: null, headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal(calls.length, 0, 'API BCL tak dipanggil bila kunci salah');
  assert.equal(safeEqual('', ''), false);
});

test('tahunan: disahkan melalui API, Pro 12 bulan untuk e-mel medan tersuai (bukan pembayar), sekali sahaja', async () => {
  const u = await makeUser(env, 'p', { email: 'pemilik@ujian.test' });
  const shopId = insertShop(env, u, { slug: 'kedai-p' });
  const res = await hook(tx('ORD-Y1'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true, received: true });
  assert.equal(calls[0].url, 'https://bcl.test/v1/transactions/ORD-Y1');
  assert.equal(calls[0].auth, 'Bearer bcl_ujian');
  assert.match(calls[0].ua, /KedaiAnnurPro/);

  assert.deepEqual(shopRow(shopId), { plan_code: 'pro', plan_expires_at: plus(12), plan_anchor_day: Number(today().slice(8)) });
  assert.deepEqual(payments(), [{ order_no: 'ORD-Y1', shop_id: shopId, payer_email: 'pemilik@ujian.test', amount_sen: 20000, period: 'yearly', quantity: 1, months_added: 12, status: 'applied' }]);
  assert.ok(env.MEDIA.objects.has('catalog/kedai-p.json'), 'snapshot dibina semula dengan ciri Pro');

  // Webhook yang sama dihantar semula (BCL > Webhook Logs > Resend): tiada tambahan masa.
  await hook(tx('ORD-Y1'));
  assert.equal(shopRow(shopId).plan_expires_at, plus(12));
  assert.equal(payments().length, 1);
  const audit = env.DB.sqlite.prepare("SELECT actor_email, action FROM audit_log WHERE action = 'bcl_payment'").all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_email, 'webhook-bcl');
});

test('kuantiti dan troli bercampur: 3 x bulanan = 3 bulan; 1 tahunan + 2 bulanan = 14 bulan; dilanjutkan dari tarikh tamat semasa', async () => {
  const u = await makeUser(env, 'q', { email: 'pemilik@ujian.test' });
  const shopId = insertShop(env, u, { slug: 'kedai-q' });
  await hook(tx('ORD-M3', { items: [{ name: ITEM_M, quantity: 3, amount: '60.00' }], subtotal: '60.00' }));
  assert.equal(shopRow(shopId).plan_expires_at, plus(3));
  assert.deepEqual(payments()[0], { order_no: 'ORD-M3', shop_id: shopId, payer_email: 'pemilik@ujian.test', amount_sen: 6000, period: 'monthly', quantity: 3, months_added: 3, status: 'applied' });

  await hook(tx('ORD-MIX', { items: [{ name: ITEM_Y, quantity: 1 }, { name: ITEM_M, quantity: 2 }], subtotal: '240.00' }));
  assert.equal(shopRow(shopId).plan_expires_at, plus(17), 'masih aktif: tambah dari tarikh tamat, bukan dari hari ini');
  const mix = payments().find((p) => p.order_no === 'ORD-MIX');
  assert.deepEqual([mix.period, mix.quantity, mix.months_added], ['yearly', 3, 14]);
});

test('bayar dahulu, daftar kemudian: unmatched, kemudian Pro diterapkan bila kedai dicipta (IPD 6.3)', async () => {
  await hook(tx('ORD-U1', { email: 'Baru@Ujian.test' }));
  assert.deepEqual(payments(), [{ order_no: 'ORD-U1', shop_id: null, payer_email: 'baru@ujian.test', amount_sen: 20000, period: 'yearly', quantity: 1, months_added: 12, status: 'unmatched' }]);

  const u = await makeUser(env, 'baru', { email: 'baru@ujian.test' });
  const res = await callApi(env, 'POST', '/api/shop', { headers: u.headers, body: { ...SHOP_BODY, slug: 'kedai-baru' } });
  assert.equal(res.status, 201);
  assert.equal(res.json.shop.plan.code, 'pro', 'respons cipta kedai sudah Pro');
  const shopId = res.json.shop.id;
  assert.equal(shopRow(shopId).plan_expires_at, plus(12));
  assert.deepEqual([payments()[0].status, payments()[0].shop_id], ['applied', shopId]);
  const audit = env.DB.sqlite.prepare("SELECT action FROM audit_log WHERE action = 'apply_unmatched'").all();
  assert.equal(audit.length, 1);
});

test('ditolak tanpa sebarang rekod: order palsu, belum dibayar, jumlah tak padan, item borang lain, tiada token API', async () => {
  const u = await makeUser(env, 'r', { email: 'pemilik@ujian.test' });
  const shopId = insertShop(env, u, { slug: 'kedai-r' });

  // Order tak wujud di BCL (webhook palsu).
  const fake = tx('ORD-FAKE');
  delete txs['ORD-FAKE'];
  assert.deepEqual(await processBcl(fake, env, { fetchFn: fakeFetch }), { ok: false, reason: 'api-404', orderNo: 'ORD-FAKE' });

  assert.equal((await processBcl(tx('ORD-PEND', { status: 2 }), env, { fetchFn: fakeFetch })).reason, 'belum-dibayar');

  // Nombor order sebenar tetapi jumlah dalam body diubah.
  const tampered = tx('ORD-AMT');
  tampered.data.main_data.amount = '1.00';
  tampered.data.main_data.subtotal_amount = '1.00';
  assert.equal((await processBcl(tampered, env, { fetchFn: fakeFetch })).reason, 'jumlah-tidak-sepadan');

  // Transaksi berbayar sebenar daripada borang lain (kursus), body dipalsukan dengan formable_id Kedai.
  assert.equal((await processBcl(tx('ORD-KURSUS', { items: [{ name: 'PROMPT2CLAUDE', quantity: 1 }], subtotal: '200.00' }), env, { fetchFn: fakeFetch })).reason, 'item-tidak-dikenali');

  const noToken = { ...env, BCL_API_TOKEN: '' };
  assert.equal((await processBcl(tx('ORD-NT'), noToken, { fetchFn: fakeFetch })).reason, 'tiada-token-api');

  assert.deepEqual(payments(), []);
  assert.equal(shopRow(shopId).plan_code, 'free');
});

test('diabaikan: borang lain, transaksi ujian (kecuali BCL_ACCEPT_TEST=1), acara lain, direct debit', async () => {
  const u = await makeUser(env, 's', { email: 'pemilik@ujian.test' });
  const shopId = insertShop(env, u, { slug: 'kedai-s' });
  const other = tx('ORD-OF');
  other.data.formable_id = 999;
  assert.equal((await processBcl(other, env, { fetchFn: fakeFetch })).ignored, 'borang-lain');
  assert.equal((await processBcl({ ...tx('ORD-F'), event: 'payment-failed' }, env, { fetchFn: fakeFetch })).ignored, 'payment-failed');
  const dd = tx('ORD-DD');
  dd.data.record_type = 'DirectDebit';
  assert.equal((await processBcl(dd, env, { fetchFn: fakeFetch })).ignored, 'jenis-DirectDebit');

  assert.equal((await processBcl(tx('ORD-T', { type: 'test' }), env, { fetchFn: fakeFetch })).ignored, 'transaksi-ujian');
  assert.equal(calls.length, 0, 'tiada panggilan API untuk yang diabaikan awal');
  assert.equal(shopRow(shopId).plan_code, 'free');

  const r = await processBcl(tx('ORD-T2', { type: 'test' }), { ...env, BCL_ACCEPT_TEST: '1' }, { fetchFn: fakeFetch });
  assert.equal(r.applied, true, 'ujian RM1 sebelum launch diterima bila BCL_ACCEPT_TEST=1');
});

test('pickEmail dan monthsFromItems', () => {
  assert.equal(pickEmail({ Nama: 'Ali', 'E-mel akaun Google untuk log masuk': ' X@Y.COM ' }, 'p@q.com'), 'x@y.com');
  assert.equal(pickEmail({ e_mel_akaun_google_untuk_log_masuk: 'a@b.my' }, 'p@q.com'), 'a@b.my');
  assert.equal(pickEmail({ Nama: 'Ali' }, 'P@Q.com'), 'p@q.com');
  assert.equal(pickEmail({}, 'bukan-emel'), '');
  assert.deepEqual(monthsFromItems([{ name: 'KEDAI PRO TAHUNAN', quantity: 2 }]), { months: 24, period: 'yearly', quantity: 2 });
  assert.deepEqual(monthsFromItems([{ item: 'Kedai Pro', option: 'Bulanan', quantity: '1' }]), { months: 1, period: 'monthly', quantity: 1 });
  assert.equal(monthsFromItems([{ name: 'LANGGANAN TAHUNAN' }]), null, 'item Jadual Sekolah tanpa "kedai pro" ditolak');
  assert.equal(monthsFromItems(null), null);
});

test('GET /api/billing: URL borang BCL dan e-mel log masuk untuk diisi dalam borang', async () => {
  const u = await makeUser(env, 'b', { email: 'pemilik@ujian.test' });
  insertShop(env, u, { slug: 'kedai-b' });
  const none = await callApi(env, 'GET', '/api/billing', { headers: u.headers });
  assert.equal(none.json.bclUrl, null);
  assert.equal(none.json.email, 'pemilik@ujian.test');
  env.BCL_FORM_URL = 'https://annurprosolutions1.bcl.my/form/kedai-annurpro-pro';
  assert.equal((await callApi(env, 'GET', '/api/billing', { headers: u.headers })).json.bclUrl, env.BCL_FORM_URL);
  env.BCL_FORM_URL = 'javascript:alert(1)';
  assert.equal((await callApi(env, 'GET', '/api/billing', { headers: u.headers })).json.bclUrl, null);
});
