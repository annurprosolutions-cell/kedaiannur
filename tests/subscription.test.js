import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extendExpiry, isIsoDate, monthsFor } from '../lib/subscription.js';

const env = { GRACE_DAYS: '7' };
const at = (iso) => new Date(`${iso}T12:00:00Z`);
const shop = (plan_code, plan_expires_at, plan_anchor_day = null) => ({ plan_code, plan_expires_at, plan_anchor_day });

test('IPD 6.4: 31 Jan tambah 1 bulan = 28 Feb, pembaharuan seterusnya kembali ke 31hb', () => {
  const first = extendExpiry(shop('pro', '2027-01-31', 31), 1, env, at('2027-01-20'));
  assert.deepEqual(first, { expiresAt: '2027-02-28', anchorDay: 31 });
  const second = extendExpiry(shop('pro', first.expiresAt, first.anchorDay), 1, env, at('2027-02-20'));
  assert.deepEqual(second, { expiresAt: '2027-03-31', anchorDay: 31 });
  const third = extendExpiry(shop('pro', second.expiresAt, 31), 1, env, at('2027-03-25'));
  assert.equal(third.expiresAt, '2027-04-30');
});

test('IPD 6.4: tahun lompat 2028: 31 Jan + 1 bulan = 29 Feb', () => {
  assert.equal(extendExpiry(shop('pro', '2028-01-31', 31), 1, env, at('2028-01-15')).expiresAt, '2028-02-29');
  assert.equal(extendExpiry(shop('pro', '2028-02-29', 29), 12, env, at('2028-02-01')).expiresAt, '2029-02-28');
});

test('IPD 6.4: kuantiti lebih daripada 1 dan tahunan', () => {
  assert.equal(monthsFor('monthly', 3), 3);
  assert.equal(monthsFor('yearly', 2), 24);
  assert.equal(monthsFor('yearly'), 12);
  assert.equal(monthsFor('pelik', 2), 0);
  assert.equal(extendExpiry(shop('pro', '2026-12-15', 15), monthsFor('monthly', 3), env, at('2026-12-01')).expiresAt, '2027-03-15');
  assert.equal(extendExpiry(shop('pro', '2026-12-15', 15), monthsFor('yearly', 2), env, at('2026-12-01')).expiresAt, '2028-12-15');
});

test('masih aktif: tambah dari tarikh tamat semasa (bukan hari ini)', () => {
  assert.equal(extendExpiry(shop('pro', '2026-12-20', 20), 1, env, at('2026-11-11')).expiresAt, '2027-01-20');
});

test('dalam toleransi: masih dikira dari tarikh tamat (BSD: termasuk toleransi)', () => {
  assert.equal(extendExpiry(shop('pro', '2026-11-08', 8), 1, env, at('2026-11-11')).expiresAt, '2026-12-08');
});

test('sudah tamat melepasi toleransi atau pelan Percuma: dari hari ini, anchor baharu', () => {
  assert.deepEqual(extendExpiry(shop('pro', '2026-09-30', 30), 1, env, at('2026-11-11')), { expiresAt: '2026-12-11', anchorDay: 11 });
  assert.deepEqual(extendExpiry(shop('free', null), 1, env, at('2026-01-31')), { expiresAt: '2026-02-28', anchorDay: 31 });
  assert.deepEqual(extendExpiry(shop('free', null), 12, env, at('2026-11-11')), { expiresAt: '2027-11-11', anchorDay: 11 });
});

test('anchor tiada dalam data lama: guna hari tarikh tamat', () => {
  assert.equal(extendExpiry(shop('pro', '2027-01-31', null), 1, env, at('2027-01-10')).expiresAt, '2027-02-28');
});

test('melintasi tahun dan bilangan bulan besar', () => {
  assert.equal(extendExpiry(shop('pro', '2026-11-30', 30), 3, env, at('2026-11-11')).expiresAt, '2027-02-28');
  assert.equal(extendExpiry(shop('pro', '2026-11-30', 30), 120, env, at('2026-11-11')).expiresAt, '2036-11-30');
});

test('bilangan bulan tak sah dibaling', () => {
  for (const m of [0, -1, 1.5, '1', null]) assert.throws(() => extendExpiry(shop('free', null), m, env));
});

test('isIsoDate', () => {
  for (const ok of ['2026-02-28', '2028-02-29', '2026-12-31']) assert.ok(isIsoDate(ok), ok);
  for (const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '26-01-01', '2026/01/01', '', null, '2026-01-32']) assert.ok(!isIsoDate(bad), String(bad));
});
