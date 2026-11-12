// GET /api/market: senarai kedai Marketplace (awam). Dibaca daripada indeks R2; dibina semula di latar bila lama.

import { json } from '../../lib/http.js';
import { getMarketIndex } from '../../lib/market.js';

export async function onRequestGet({ env, waitUntil }) {
  const data = await getMarketIndex(env, waitUntil);
  return json({ ok: true, ...data }, 200, { 'Cache-Control': 'public, max-age=120' });
}
