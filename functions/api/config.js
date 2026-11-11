// GET /api/config: nilai awam untuk frontend (bukan secret).
// GOOGLE_CLIENT_ID memang awam; ia dibaca dari tetapan Pages supaya tak perlu commit bila berubah.

import { json } from '../../lib/http.js';

export function onRequestGet({ env }) {
  return json(
    {
      ok: true,
      googleClientId: env.GOOGLE_CLIENT_ID || '',
      mediaBaseUrl: env.MEDIA_BASE_URL || '',
      // E-mel sokongan untuk landing, privasi dan terma; tak ditulis dalam repo awam.
      supportEmail: /^[^\s@<>"']+@[^\s@<>"']+$/.test(String(env.SUPPORT_EMAIL || '').trim()) ? String(env.SUPPORT_EMAIL).trim() : '',
    },
    200,
    { 'Cache-Control': 'public, max-age=300' },
  );
}
