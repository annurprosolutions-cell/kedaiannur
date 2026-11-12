// Halaman awam /artikel/ (senarai) dan /artikel/<slug> dijana dari D1 ke dalam templat public/article.html.
// Fungsi tulen (tiada binding) supaya boleh diuji dalam Node; functions/artikel/[slug].js menyambungkannya.

import { escapeHtml, readingMinutes, renderMarkdown } from '../public/assets/js/artikel.js';
import { PAGE_CSP, PAGE_HEADERS, safeJson } from './shoppage.js';
import { isoOf, mediaBase } from './articles.js';

export const HEAD_MARKER = '<!--HEAD-->';
export const MAIN_MARKER = '<!--MAIN-->';
const TITLE_RE = /<title>[^<]*<\/title>/;
const SITE = 'Kedai AnnurPro';
const DEFAULT_OG = '/assets/og-default.png';
const INDEX_DESC = 'Panduan praktikal untuk peniaga kecil: katalog online, gambar produk, kod QR, iklan dan jualan melalui WhatsApp.';

// Gambar dalam artikel boleh datang dari mana-mana https (contoh gambar dari laman rasmi); skrip kekal ketat.
export const ARTICLE_CSP = PAGE_CSP.replace(/img-src ([^;]+)/, (_, v) => `img-src ${v} https:`);
export const ARTICLE_HEADERS = { ...PAGE_HEADERS, 'Content-Security-Policy': ARTICLE_CSP };

/** Tarikh paparan DD/MM/YYYY dalam waktu Malaysia daripada tarikh D1 (UTC). */
export function myDate(d) {
  const iso = isoOf(d);
  if (!iso) return '';
  const t = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  if (Number.isNaN(t.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}

function fill(template, { title, head, main }) {
  return template
    .replace(TITLE_RE, `<title>${escapeHtml(title)}</title>`)
    .replace(HEAD_MARKER, head.join('\n  '))
    .replace(MAIN_MARKER, main);
}

const meta = (name, content) => `<meta name="${name}" content="${escapeHtml(content)}">`;
const prop = (name, content) => `<meta property="${name}" content="${escapeHtml(content)}">`;

function card(a, env) {
  const media = mediaBase(env);
  const img = a.cover_key
    ? `<img class="article-thumb" src="${escapeHtml(`${media}/${a.cover_key}`)}" alt="${escapeHtml(a.cover_alt || '')}" loading="lazy" decoding="async" width="1200" height="630">`
    : '';
  return `<li class="card article-card">${img}<div class="article-card-body"><a href="/artikel/${escapeHtml(a.slug)}"><h2>${escapeHtml(a.title)}</h2></a><p class="muted">${escapeHtml(a.description)}</p><p class="caption">${myDate(a.published_at)}</p></div></li>`;
}

/** Halaman senarai /artikel/ */
export function renderIndexPage(template, { origin, articles, env, notFound = false }) {
  const url = `${origin}/artikel/`;
  const head = [
    ...(notFound ? [meta('robots', 'noindex')] : []),
    meta('description', INDEX_DESC),
    `<link rel="canonical" href="${url}">`,
    `<link rel="alternate" type="application/rss+xml" title="Artikel ${SITE}" href="${origin}/artikel/rss.xml">`,
    prop('og:type', 'website'),
    prop('og:site_name', SITE),
    prop('og:locale', 'ms_MY'),
    prop('og:title', 'Artikel untuk peniaga online'),
    prop('og:description', INDEX_DESC),
    prop('og:url', url),
    prop('og:image', `${origin}${DEFAULT_OG}`),
    meta('twitter:card', 'summary_large_image'),
  ];
  const list = articles.length
    ? `<ul class="article-list">${articles.map((a) => card(a, env)).join('\n')}</ul>`
    : '<p class="muted">Belum ada artikel. Datang semula nanti.</p>';
  const main = `    <p class="eyebrow">Artikel</p>
    ${notFound
    ? '<h1>Artikel tak dijumpai</h1>\n    <p class="muted">Artikel ini mungkin telah dipindah atau dipadam. Cuba artikel lain di bawah.</p>'
    : '<h1>Panduan untuk peniaga online</h1>\n    <p class="muted">Tips praktikal untuk membina katalog, mengambil gambar produk, dan mendapatkan order melalui WhatsApp.</p>'}
    ${list}`;
  return fill(template, { title: notFound ? `Artikel tak dijumpai | ${SITE}` : `Artikel untuk peniaga online | ${SITE}`, head, main });
}

/**
 * Halaman satu artikel /artikel/<slug>.
 * @param a        baris D1 artikel
 * @param related  baris artikel lain (senarai ringkas)
 * @param preview  true bila superadmin melihat draf (noindex, sepanduk draf)
 */
export function renderArticlePage(template, { origin, article: a, related = [], preview = false, env }) {
  const url = `${origin}/artikel/${a.slug}`;
  const media = mediaBase(env);
  const md = renderMarkdown(a.body, { origin });
  const cover = a.cover_key ? `${media}/${a.cover_key}` : '';
  const ogImage = cover || `${origin}${DEFAULT_OG}`;
  const title = a.seo_title || a.title;
  const desc = a.description || md.firstParagraph.slice(0, 160);
  const published = isoOf(a.published_at);
  const modified = isoOf(a.updated_at);

  const head = [
    meta('description', desc),
    `<link rel="canonical" href="${url}">`,
    ...(a.noindex || preview ? [meta('robots', 'noindex, follow')] : [meta('robots', 'index, follow, max-image-preview:large')]),
    prop('og:type', 'article'),
    prop('og:site_name', SITE),
    prop('og:locale', 'ms_MY'),
    prop('og:title', title),
    prop('og:description', desc),
    prop('og:url', url),
    prop('og:image', ogImage),
    ...(cover ? [prop('og:image:width', '1200'), prop('og:image:height', '630'), prop('og:image:alt', a.cover_alt || a.title)] : []),
    ...(published ? [prop('article:published_time', published)] : []),
    ...(modified ? [prop('article:modified_time', modified)] : []),
    meta('twitter:card', 'summary_large_image'),
    meta('twitter:title', title),
    meta('twitter:description', desc),
    meta('twitter:image', ogImage),
  ];
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: a.title.slice(0, 110),
      description: desc,
      image: [ogImage],
      ...(published ? { datePublished: published } : {}),
      ...(modified ? { dateModified: modified } : {}),
      author: { '@type': 'Organization', name: a.author || SITE, url: origin },
      publisher: { '@type': 'Organization', name: SITE, logo: { '@type': 'ImageObject', url: `${origin}/assets/brand/annurpro-logo.png` } },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      inLanguage: 'ms-MY',
      wordCount: md.words,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Utama', item: `${origin}/` },
        { '@type': 'ListItem', position: 2, name: 'Artikel', item: `${origin}/artikel/` },
        { '@type': 'ListItem', position: 3, name: a.title, item: url },
      ],
    },
  ];
  head.push(`<script type="application/ld+json">${safeJson(ld)}</script>`);

  const h2 = md.headings.filter((x) => x.level === 2);
  const toc = h2.length >= 3
    ? `<nav class="article-toc card" aria-label="Kandungan artikel"><p class="caption">Kandungan</p><ol>${h2.map((x) => `<li><a href="#${x.id}">${escapeHtml(x.text)}</a></li>`).join('')}</ol></nav>`
    : '';
  const coverHtml = cover
    ? `<figure class="article-cover"><img src="${escapeHtml(cover)}" alt="${escapeHtml(a.cover_alt || '')}" width="1200" height="630" fetchpriority="high" decoding="async"></figure>`
    : '';
  const date = myDate(a.published_at);
  const updated = a.published_at && a.updated_at && myDate(a.updated_at) !== date ? ` · Dikemas kini ${myDate(a.updated_at)}` : '';
  const banner = preview
    ? `<p class="article-draft" role="status">${a.status === 'published' ? 'Pratonton superadmin.' : 'DRAF: belum diterbitkan. Hanya superadmin boleh melihat halaman ini.'}</p>`
    : '';
  const relatedHtml = related.length
    ? `<section class="article-related" aria-labelledby="related-h"><h2 id="related-h">Artikel lain</h2><ul class="article-list">${related.map((r) => card(r, env)).join('')}</ul></section>`
    : '';

  const main = `    ${banner}
    <p class="crumb caption"><a href="/artikel/">Artikel</a></p>
    <h1>${escapeHtml(a.title)}</h1>
    <p class="updated">${date || 'Belum diterbitkan'}${updated} · ${escapeHtml(a.author || SITE)} · ${readingMinutes(md.words)} min bacaan</p>
    ${coverHtml}
    ${toc}
    <div class="article-body">
${md.html}
    </div>
    <aside class="card article-cta">
      <h2>Cuba Kedai AnnurPro</h2>
      <p>Katalog online percuma: tambah produk, kongsi satu link, dan terima order siap tersusun di WhatsApp.</p>
      <a class="btn" href="/app/">Buka kedai percuma</a>
    </aside>
    ${relatedHtml}`;
  return fill(template, { title: `${title} | ${SITE}`, head, main });
}

/** Suapan RSS 2.0 untuk /artikel/rss.xml (pembaca suapan dan Google Discover). */
export function renderRss({ origin, articles }) {
  const x = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
  const items = articles
    .map((a) => `    <item><title>${x(a.title)}</title><link>${origin}/artikel/${x(a.slug)}</link><guid isPermaLink="true">${origin}/artikel/${x(a.slug)}</guid><description>${x(a.description)}</description>${a.published_at ? `<pubDate>${new Date(isoOf(a.published_at)).toUTCString()}</pubDate>` : ''}</item>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Artikel ${SITE}</title>
    <link>${origin}/artikel/</link>
    <description>${x(INDEX_DESC)}</description>
    <language>ms-MY</language>
${items}
  </channel>
</rss>
`;
}
