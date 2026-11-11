// GET /api/billing (S-14): pelan tersedia, status langganan semasa dan sejarah bayaran kedai sendiri.
// Butang bayar BCL dan webhook dibina dalam Fasa 6; bclUrl kekal null sehingga itu.

import { json } from '../../lib/http.js';
import { ownerShop } from '../../lib/shop.js';
import { planStatus, planToApi } from '../../lib/plan.js';

export async function onRequestGet({ env, data }) {
  const { shop, plan, error } = await ownerShop(env, data.user);
  if (error) return error;

  const [plans, payments] = await Promise.all([
    env.DB.prepare('SELECT * FROM plans ORDER BY price_month_sen, code').all(),
    env.DB
      .prepare(
        `SELECT order_no, amount_sen, period, quantity, months_added, status, created_at
         FROM payments WHERE shop_id = ?1 ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(shop.id)
      .all(),
  ]);

  return json({
    ok: true,
    planCode: shop.plan_code,
    effectivePlan: planToApi(plan),
    status: planStatus(shop, env),
    plans: plans.results.map((p) => ({ ...planToApi(p), priceMonthSen: p.price_month_sen, priceYearSen: p.price_year_sen })),
    payments: payments.results.map((p) => ({
      orderNo: p.order_no,
      amountSen: p.amount_sen,
      period: p.period,
      quantity: p.quantity,
      monthsAdded: p.months_added,
      status: p.status,
      createdAt: p.created_at,
    })),
    bclUrl: null,
  });
}
