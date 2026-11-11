// GET /api/admin/payments?status=unmatched|applied|ignored  (S-18)
// Membuka S-18 juga membersihkan audit_log lebih 12 bulan (BSD seksyen 8).

import { json } from '../../../../lib/http.js';
import { paymentToApi } from '../../../../lib/admin.js';

export async function onRequestGet({ request, env, waitUntil }) {
  const status = new URL(request.url).searchParams.get('status');
  const filter = ['unmatched', 'applied', 'ignored'].includes(status) ? status : null;
  const rows = await env.DB
    .prepare(
      `SELECT p.*, s.slug AS shop_slug FROM payments p LEFT JOIN shops s ON s.id = p.shop_id
       ${filter ? 'WHERE p.status = ?1' : ''} ORDER BY p.created_at DESC LIMIT 100`,
    )
    .bind(...(filter ? [filter] : []))
    .all();
  waitUntil(env.DB.prepare("DELETE FROM audit_log WHERE created_at < datetime('now', '-12 months')").run());
  return json({ ok: true, payments: rows.results.map(paymentToApi) });
}
