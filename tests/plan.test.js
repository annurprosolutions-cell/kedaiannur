import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectivePlanCode, graceDays, loadPlan, formatMb, planStatus } from '../lib/plan.js';
import { FakeD1 } from './helpers/d1.js';

const env = { GRACE_DAYS: '7' };
const at = (iso) => new Date(`${iso}T12:00:00Z`);
const shop = (plan_code, plan_expires_at) => ({ plan_code, plan_expires_at });

test('free kekal free walaupun ada tarikh', () => {
  assert.equal(effectivePlanCode(shop('free', null), env), 'free');
  assert.equal(effectivePlanCode(shop('free', '2099-01-01'), env), 'free');
});

test('pro aktif sehingga tarikh tamat', () => {
  assert.equal(effectivePlanCode(shop('pro', '2026-12-01'), env, at('2026-11-10')), 'pro');
  assert.equal(effectivePlanCode(shop('pro', '2026-12-01'), env, at('2026-12-01')), 'pro');
});

test('toleransi 7 hari selepas tamat: hari ke-7 masih pro, hari ke-8 jatuh ke free (BSD peraturan 1)', () => {
  const s = shop('pro', '2026-12-01');
  assert.equal(effectivePlanCode(s, env, at('2026-12-08')), 'pro');
  assert.equal(effectivePlanCode(s, env, at('2026-12-09')), 'free');
});

test('pro tanpa tarikh tamat atau tarikh rosak dianggap free', () => {
  assert.equal(effectivePlanCode(shop('pro', null), env), 'free');
  assert.equal(effectivePlanCode(shop('pro', 'bukan-tarikh'), env), 'free');
  assert.equal(effectivePlanCode(shop('pro', '2026-13-45'), env), 'free');
});

test('toleransi melintasi hujung bulan dan tahun', () => {
  const s = shop('pro', '2026-12-28');
  assert.equal(effectivePlanCode(s, env, at('2027-01-04')), 'pro');
  assert.equal(effectivePlanCode(s, env, at('2027-01-05')), 'free');
});

test('GRACE_DAYS boleh diubah; nilai rosak guna 7', () => {
  assert.equal(graceDays({ GRACE_DAYS: '3' }), 3);
  assert.equal(graceDays({ GRACE_DAYS: '0' }), 0);
  assert.equal(graceDays({}), 7);
  assert.equal(graceDays({ GRACE_DAYS: 'abc' }), 7);
  assert.equal(graceDays({ GRACE_DAYS: '-1' }), 7);
  assert.equal(effectivePlanCode(shop('pro', '2026-12-01'), { GRACE_DAYS: '0' }, at('2026-12-02')), 'free');
});

test('loadPlan baca had daripada jadual plans dan jatuh balik ke free', async () => {
  const db = new FakeD1();
  assert.equal((await loadPlan(db, 'pro')).max_products, 500);
  assert.equal((await loadPlan(db, 'tiada')).code, 'free');
  db.sqlite.exec("UPDATE plans SET max_products = 25 WHERE code = 'free'");
  assert.equal((await loadPlan(db, 'free')).max_products, 25, 'had boleh diubah tanpa deploy');
});

test('formatMb', () => {
  assert.equal(formatMb(10485760), '10 MB');
  assert.equal(formatMb(157286400), '150 MB');
  assert.equal(formatMb(1572864), '1.5 MB');
});

test('planStatus: free, active, ending (14 hari dan kurang), grace, expired', () => {
  const now = at('2026-11-10');
  assert.deepEqual(planStatus(shop('free', null), env, now), { state: 'free', daysLeft: null, expiresAt: null, graceEndsAt: null });
  assert.equal(planStatus(shop('pro', null), env, now).state, 'free', 'pro tanpa tarikh dianggap free');
  assert.deepEqual(planStatus(shop('pro', '2026-12-31'), env, now), { state: 'active', daysLeft: 51, expiresAt: '2026-12-31', graceEndsAt: '2027-01-07' });
  assert.equal(planStatus(shop('pro', '2026-11-24'), env, now).state, 'ending', 'tepat 14 hari');
  assert.equal(planStatus(shop('pro', '2026-11-24'), env, now).daysLeft, 14);
  assert.equal(planStatus(shop('pro', '2026-11-25'), env, now).state, 'active', '15 hari');
  assert.deepEqual(planStatus(shop('pro', '2026-11-10'), env, now), { state: 'ending', daysLeft: 0, expiresAt: '2026-11-10', graceEndsAt: '2026-11-17' });
  assert.deepEqual(planStatus(shop('pro', '2026-11-09'), env, now), { state: 'grace', daysLeft: 6, expiresAt: '2026-11-09', graceEndsAt: '2026-11-16' });
  assert.equal(planStatus(shop('pro', '2026-11-03'), env, now).state, 'grace', 'hari terakhir toleransi');
  assert.equal(planStatus(shop('pro', '2026-11-03'), env, now).daysLeft, 0);
  assert.equal(planStatus(shop('pro', '2026-11-02'), env, now).state, 'expired');
});

test('planStatus selaras dengan effectivePlanCode pada setiap hari sekitar tarikh tamat', () => {
  const s = shop('pro', '2026-11-10');
  for (let d = -20; d <= 20; d++) {
    const now = new Date(Date.UTC(2026, 10, 10 + d, 12));
    const st = planStatus(s, env, now).state;
    const eff = effectivePlanCode(s, env, now);
    assert.equal(eff === 'pro', ['active', 'ending', 'grace'].includes(st), `hari ${d}: ${st} vs ${eff}`);
  }
});
