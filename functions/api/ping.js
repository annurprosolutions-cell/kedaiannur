// GET /api/ping: semakan kesihatan Fasa 0. Tidak menyentuh D1.

import { json } from '../../lib/http.js';

export function onRequestGet() {
  return json({ ok: true, service: 'kedai-annurpro', time: new Date().toISOString() });
}
