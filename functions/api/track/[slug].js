// POST /api/track/:slug (awam): kumpulan acara pelawat halaman kedai. Tiada data peribadi disimpan.
// Middleware masih menyemak Origin (mesti dari laman ini) dan Content-Type JSON, jadi laman lain tak boleh menghantar.

import { json } from '../../../lib/http.js';
import { cleanEvents, isBot, recordEvents } from '../../../lib/stats.js';

const OK = () => json({ ok: true }, 200, { 'Cache-Control': 'no-store' });

export async function onRequestPost({ request, env, params }) {
  if (isBot(request.headers.get('User-Agent'))) return OK();
  let body;
  try {
    body = await request.json();
  } catch {
    return OK();
  }
  const ev = cleanEvents(body);
  if (!ev) return OK();
  const slug = String(params.slug || '').toLowerCase();
  if (!/^[a-z0-9-]{3,30}$/.test(slug)) return OK();
  const shop = await env.DB.prepare("SELECT id FROM shops WHERE slug = ?1 AND status = 'active'").bind(slug).first();
  if (shop) await recordEvents(env.DB, shop.id, ev);
  // Sentiasa 200 tanpa butiran: tiada cara meneka slug wujud atau tidak.
  return OK();
}
