// GET /api/me: pengguna semasa, kedai (jika ada) dan status superadmin.
// Sesi sudah disahkan oleh _middleware.js.

import { json } from '../../lib/http.js';
import { buildMe } from '../../lib/session.js';

export async function onRequestGet({ env, data }) {
  return json(await buildMe(env.DB, env, data.user));
}
