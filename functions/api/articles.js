// GET /api/articles?limit=3 (awam): artikel diterbitkan untuk seksyen "Artikel terkini" di sale page.
// Artikel Pilihan didahulukan, kemudian yang terbaru. Tiada data dalaman (draf, kata kunci, penulis).

import { json } from '../../lib/http.js';
import { listPublished, publicArticle } from '../../lib/articles.js';

export async function onRequestGet({ request, env }) {
  const n = Number(new URL(request.url).searchParams.get('limit'));
  const limit = Number.isInteger(n) && n >= 1 && n <= 12 ? n : 3;
  const rows = await listPublished(env, { limit, featuredFirst: true });
  return json({ ok: true, articles: rows.map((r) => publicArticle(r, env)) }, 200, { 'Cache-Control': 'public, max-age=300' });
}
