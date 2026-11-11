// GET /api/admin/shops?q=&plan=free|pro&status=active|suspended&page=  (S-16)

import { json } from '../../../../lib/http.js';
import { listShops, summary } from '../../../../lib/admin.js';

export async function onRequestGet({ request, env }) {
  const sp = new URL(request.url).searchParams;
  const page = parseInt(sp.get('page') || '1', 10);
  const [list, stats] = await Promise.all([
    listShops(env.DB, env, {
      q: (sp.get('q') || '').trim().slice(0, 100),
      plan: sp.get('plan') || '',
      status: sp.get('status') || '',
      page: Number.isFinite(page) && page > 0 ? Math.min(page, 10000) : 1,
    }),
    summary(env.DB, env),
  ]);
  return json({ ok: true, ...list, summary: stats });
}
