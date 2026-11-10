// POST /api/auth/logout: padam sesi semasa (jika ada) dan kosongkan cookie.
// Awam supaya cookie lama atau tamat tempoh tetap boleh dibersihkan.

import { json, clearSessionCookie } from '../../../lib/http.js';
import { deleteSession } from '../../../lib/session.js';

export async function onRequestPost({ request, env }) {
  await deleteSession(env.DB, request);
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}
