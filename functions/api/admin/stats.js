// GET /api/admin/stats: siri harian 30 hari, jumlah hasil, kadar Pro dan senarai Pro yang hampir tamat (superadmin).

import { json } from '../../../lib/http.js';
import { stats } from '../../../lib/admin.js';

export async function onRequestGet({ env }) {
  return json({ ok: true, ...(await stats(env.DB, env)) });
}
