// GET /artikel/<slug>: halaman artikel dari D1 (diterbitkan). Superadmin yang log masuk boleh melihat draf
// (noindex, tanpa cache). /artikel/rss.xml ialah suapan RSS. /artikel/ (slug kosong) ialah halaman senarai.

import { articleBySlug, listPublished } from '../../lib/articles.js';
import { ARTICLE_HEADERS, renderArticlePage, renderIndexPage, renderRss } from '../../lib/articlepage.js';
import { userFromRequest, isSuperadmin } from '../../lib/session.js';

let templateCache = null;

async function loadTemplate(env, request) {
  if (templateCache) return templateCache;
  // /article ialah laluan Pages untuk public/article.html (URL tanpa .html).
  const res = await env.ASSETS.fetch(new URL('/article', request.url));
  if (!res.ok) throw new Error(`Templat article.html tiada (${res.status})`);
  templateCache = await res.text();
  return templateCache;
}

const html = (body, status, cache) => new Response(body, { status, headers: { ...ARTICLE_HEADERS, 'Cache-Control': cache } });

async function isAdmin(env, request) {
  if (!(request.headers.get('Cookie') || '').includes('__Host-sid=')) return false;
  const user = await userFromRequest(env.DB, request);
  return Boolean(user && isSuperadmin(env, user.email));
}

export async function renderIndex({ request, env }) {
  const url = new URL(request.url);
  const articles = await listPublished(env, { limit: 100 });
  return html(renderIndexPage(await loadTemplate(env, request), { origin: url.origin, articles, env }), 200, 'public, max-age=300');
}

export async function onRequestGet(context) {
  const { request, env, params, next } = context;
  const url = new URL(request.url);
  const raw = String(params.slug || '');
  if (!raw) return renderIndex(context);

  if (raw === 'rss.xml') {
    const articles = await listPublished(env, { limit: 30, indexableOnly: true });
    return new Response(renderRss({ origin: url.origin, articles }), {
      headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=1800', 'X-Content-Type-Options': 'nosniff' },
    });
  }
  // Laluan lama /artikel/<slug>.html (fail statik dahulu) dan huruf besar dihala ke URL kanonik.
  const slug = raw.toLowerCase().replace(/\.html$/, '');
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return next();
  if (slug !== raw) return Response.redirect(`${url.origin}/artikel/${slug}${url.search}`, 301);

  const article = await articleBySlug(env, slug);
  const admin = article && (article.status !== 'published' || url.searchParams.has('pratonton')) ? await isAdmin(env, request) : false;
  if (!article || (article.status !== 'published' && !admin)) {
    const articles = await listPublished(env, { limit: 100 });
    return html(renderIndexPage(await loadTemplate(env, request), { origin: url.origin, articles, env, notFound: true }), 404, 'no-cache');
  }

  const others = (await listPublished(env, { limit: 4 })).filter((r) => r.slug !== slug).slice(0, 3);
  const page = renderArticlePage(await loadTemplate(env, request), { origin: url.origin, article, related: others, preview: admin, env });
  return html(page, 200, admin ? 'private, no-store' : 'public, max-age=300');
}

export async function onRequestHead(context) {
  const res = await onRequestGet(context);
  return new Response(null, { status: res.status, headers: res.headers });
}
