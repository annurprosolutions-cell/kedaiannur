// GET /sitemap.xml: halaman awam platform dan kedai yang disenaraikan di Marketplace (persetujuan peniaga).
// Kedai yang tak disenaraikan masih boleh diindeks melalui pautan biasa, cuma tak diiklankan dalam sitemap.

import { getMarketIndex } from '../lib/market.js';
import { ARTICLES } from '../lib/articles.js';

const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

export async function onRequestGet({ request, env, waitUntil }) {
  const origin = new URL(request.url).origin;
  let shops = [];
  try {
    shops = (await getMarketIndex(env, waitUntil)).shops || [];
  } catch (err) {
    console.error('sitemap: indeks marketplace gagal', err && err.message ? err.message : err);
  }
  const urls = [
    { loc: `${origin}/`, priority: '1.0' },
    { loc: `${origin}/marketplace`, priority: '0.9' },
    ...shops.map((s) => ({ loc: `${origin}/${encodeURIComponent(s.s)}`, lastmod: String(s.u || '').slice(0, 10), priority: '0.7' })),
    { loc: `${origin}/artikel/`, priority: '0.6' },
    ...ARTICLES.map((a) => ({ loc: `${origin}/artikel/${a.slug}`, lastmod: a.date, priority: '0.5' })),
    { loc: `${origin}/privasi`, priority: '0.2' },
    { loc: `${origin}/terma`, priority: '0.2' },
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => `  <url><loc>${esc(u.loc)}</loc>${/^\d{4}-\d{2}-\d{2}$/.test(u.lastmod || '') ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`)
  .join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
