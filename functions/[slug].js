// GET /<slug>: halaman kedai awam. Baca catalog/<slug>.json dari R2 (bukan D1), suntik meta OG untuk
// pratonton link WhatsApp dan data katalog ke dalam HTML. Slug tak sah diserahkan kepada fail statik (404.html).

import { isReservedLocally, normalizeSlug, slugFormatError } from '../public/assets/js/rules.js';
import { snapshotKey } from '../lib/catalog.js';
import { pageHeaders, renderShopPage, reportLink } from '../lib/shoppage.js';

let templateCache = null;

async function loadTemplate(env, request) {
  if (templateCache) return templateCache;
  // /shop ialah laluan Pages untuk shop.html (URL tanpa .html).
  const res = await env.ASSETS.fetch(new URL('/shop', request.url));
  if (!res.ok) throw new Error(`Templat shop.html tiada (${res.status})`);
  templateCache = await res.text();
  return templateCache;
}

export async function onRequestGet({ request, env, params, next }) {
  const raw = String(params.slug || '');
  const slug = normalizeSlug(raw);
  if (slugFormatError(slug) || isReservedLocally(slug)) return next();

  const url = new URL(request.url);
  // Satu URL kanonik: huruf kecil, tanpa garis miring di hujung.
  if (url.pathname !== `/${slug}`) {
    return Response.redirect(`${url.origin}/${slug}${url.search}`, 301);
  }

  let catalog = null;
  let status = 200;
  try {
    const obj = await env.MEDIA.get(snapshotKey(slug));
    if (obj) catalog = JSON.parse(await obj.text());
    else status = 404;
  } catch (err) {
    console.error('Baca snapshot gagal', slug, err && err.message ? err.message : err);
    status = 503;
  }

  const media = String(env.MEDIA_BASE_URL || '').replace(/\/+$/, '');
  const html = renderShopPage(await loadTemplate(env, request), {
    slug, origin: url.origin, media, report: reportLink(env, slug), catalog,
  });
  return new Response(html, {
    status,
    headers: { ...pageHeaders(catalog), 'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-cache' },
  });
}

// Sesetengah perangkak pratonton link menghantar HEAD dahulu.
export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
