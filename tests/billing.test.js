import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callApi } from './helpers/pages.js';
import { makeEnv, makeUser, insertShop } from './helpers/seed.js';

let env;
let a;

beforeEach(async () => {
  env = makeEnv();
  a = await makeUser(env, 'a');
});

const billing = (user = a) => callApi(env, 'GET', '/api/billing', { headers: user.headers });

test('GET /api/billing: pelan dengan harga, status, sejarah bayaran kedai sendiri sahaja', async () => {
  const shopId = insertShop(env, a, { slug: 'kedai-a', plan: 'pro', expires: '2099-01-01' });
  const b = await makeUser(env, 'b');
  const shopB = insertShop(env, b, { slug: 'kedai-b' });
  env.DB.sqlite.prepare("INSERT INTO payments (id, order_no, shop_id, amount_sen, period, quantity, months_added, status) VALUES ('p1','ORD1',?,2900,'monthly',1,1,'applied')").run(shopId);
  env.DB.sqlite.prepare("INSERT INTO payments (id, order_no, shop_id, amount_sen, period, quantity, months_added, status) VALUES ('p2','ORD2',?,29000,'yearly',1,12,'applied')").run(shopB);

  const res = await billing();
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.plans.map((p) => [p.code, p.priceMonthSen, p.priceYearSen]), [['free', 0, 0], ['pro', 2900, 29000]]);
  assert.equal(res.json.planCode, 'pro');
  assert.equal(res.json.effectivePlan.code, 'pro');
  assert.equal(res.json.status.state, 'active');
  assert.deepEqual(res.json.payments.map((p) => p.orderNo), ['ORD1'], 'bayaran kedai lain tak bocor');
  assert.equal(res.json.bclUrl, null);
});

test('GET /api/billing: tanpa sesi 401, tanpa kedai 404', async () => {
  assert.equal((await callApi(env, 'GET', '/api/billing')).status, 401);
  assert.equal((await billing()).status, 404);
});
