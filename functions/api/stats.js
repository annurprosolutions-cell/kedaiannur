// GET /api/stats?days=7|30|90 (peniaga): statistik kedai sendiri. Percuma: 7 hari; Pro: sehingga 90 hari dan produk
// paling dilihat. Sesekali membuang data lebih lama daripada RETAIN_DAYS di latar.

import { json } from '../../lib/http.js';
import { ownerShop } from '../../lib/shop.js';
import { FREE_DAYS, PRO_DAYS, pruneStats, shopStats } from '../../lib/stats.js';

export async function onRequestGet({ request, env, data, waitUntil }) {
  const { shop, plan, error } = await ownerShop(env, data.user);
  if (error) return error;
  const isPro = plan.code !== 'free';
  const asked = parseInt(new URL(request.url).searchParams.get('days') || String(FREE_DAYS), 10);
  const allowed = isPro ? PRO_DAYS : FREE_DAYS;
  const days = [7, 30, 90].includes(asked) ? Math.min(asked, allowed) : FREE_DAYS;
  const stats = await shopStats(env.DB, shop.id, days, { withProducts: isPro });
  if (Math.random() < 0.02) waitUntil(pruneStats(env.DB).catch(() => {}));
  return json({ ok: true, isPro, maxDays: allowed, ...stats }, 200, { 'Cache-Control': 'no-store' });
}
