// GET /api/plans: had dan harga pelan untuk landing page (awam). Sumber: jadual plans.

import { json } from '../../lib/http.js';
import { planToApi } from '../../lib/plan.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT * FROM plans ORDER BY price_month_sen, code').all();
  return json(
    { ok: true, plans: results.map((p) => ({ ...planToApi(p), priceMonthSen: p.price_month_sen, priceYearSen: p.price_year_sen })) },
    200,
    { 'Cache-Control': 'public, max-age=300' },
  );
}
