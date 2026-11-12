// Artikel diurus superadmin (jadual articles, migrasi 0007). Dibaca oleh /artikel, /api/articles dan /sitemap.xml.
// Kandungan ialah Markdown ringkas yang ditukar ke HTML selamat oleh public/assets/js/artikel.js.

import { ARTICLE_IMAGE_RE } from '../public/assets/js/artikel.js';

// Gambar artikel yang dimuat naik tetapi tak dirujuk oleh mana-mana artikel selepas tempoh ini dipadam.
export const ARTICLE_ORPHAN_GRACE_MS = 6 * 3600 * 1000;
export const ARTICLE_UPLOAD_LIMITS = { cover: 300 * 1024, inline: 300 * 1024 };

const COLS = 'id, slug, title, seo_title, description, body, cover_key, cover_alt, focus_keyword, author, status, noindex, featured, published_at, created_at, updated_at';
const LIST_COLS = 'slug, title, description, cover_key, cover_alt, featured, published_at, updated_at';

export const mediaBase = (env) => String(env.MEDIA_BASE_URL || '').replace(/\/+$/, '');

/** Tarikh D1 (UTC, 'YYYY-MM-DD HH:MM:SS') kepada ISO 8601. */
export const isoOf = (d) => (d ? `${String(d).replace(' ', 'T')}Z` : null);

export function adminArticle(row, env) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    seoTitle: row.seo_title,
    description: row.description,
    body: row.body,
    coverKey: row.cover_key,
    coverUrl: row.cover_key ? `${mediaBase(env)}/${row.cover_key}` : '',
    coverAlt: row.cover_alt,
    focusKeyword: row.focus_keyword,
    author: row.author,
    status: row.status,
    noindex: Boolean(row.noindex),
    featured: Boolean(row.featured),
    publishedAt: isoOf(row.published_at),
    createdAt: isoOf(row.created_at),
    updatedAt: isoOf(row.updated_at),
  };
}

export function publicArticle(row, env) {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    cover: row.cover_key ? `${mediaBase(env)}/${row.cover_key}` : '',
    coverAlt: row.cover_alt || '',
    featured: Boolean(row.featured),
    publishedAt: isoOf(row.published_at),
    updatedAt: isoOf(row.updated_at),
  };
}

/** Artikel diterbitkan. featuredFirst = susunan sale page (Pilihan dahulu), jika tidak terbaru dahulu. */
export async function listPublished(env, { limit = 100, featuredFirst = false, indexableOnly = false } = {}) {
  const order = featuredFirst ? 'featured DESC, published_at DESC' : 'published_at DESC';
  const where = `status = 'published'${indexableOnly ? ' AND noindex = 0' : ''}`;
  const { results } = await env.DB.prepare(`SELECT ${LIST_COLS} FROM articles WHERE ${where} ORDER BY ${order} LIMIT ?1`).bind(limit).all();
  return results;
}

export async function articleBySlug(env, slug) {
  return env.DB.prepare(`SELECT ${COLS} FROM articles WHERE slug = ?1`).bind(slug).first();
}

export async function articleById(env, id) {
  return env.DB.prepare(`SELECT ${COLS} FROM articles WHERE id = ?1`).bind(id).first();
}

export async function listAll(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, slug, title, description, cover_key, status, noindex, featured, published_at, updated_at FROM articles ORDER BY COALESCE(published_at, created_at) DESC',
  ).all();
  return results;
}

/** Kunci R2 gambar yang dirujuk oleh artikel (gambar utama dan gambar dalam kandungan). */
export function imageKeysOf(row) {
  const keys = new Set();
  if (row.cover_key) keys.add(row.cover_key);
  for (const m of String(row.body || '').matchAll(ARTICLE_IMAGE_RE)) keys.add(m[0]);
  return keys;
}

/**
 * Padam gambar articles/* yang tiada artikel merujuknya dan lebih lama daripada tempoh tangguh
 * (gambar yang diganti, dibuang dari kandungan, atau artikel yang dipadam). Kegagalan hanya dilog.
 */
export async function sweepArticleImages(env, now = Date.now(), graceMs = ARTICLE_ORPHAN_GRACE_MS) {
  try {
    const objects = [];
    let cursor;
    for (let page = 0; page < 5; page++) {
      const listed = await env.MEDIA.list({ prefix: 'articles/', limit: 1000, cursor });
      objects.push(...listed.objects);
      if (!listed.truncated) break;
      cursor = listed.cursor;
    }
    const old = objects.filter((o) => now - new Date(o.uploaded).getTime() > graceMs);
    if (!old.length) return 0;
    const { results } = await env.DB.prepare('SELECT cover_key, body FROM articles').all();
    const used = new Set();
    for (const r of results) for (const k of imageKeysOf(r)) used.add(k);
    const orphans = old.map((o) => o.key).filter((k) => !used.has(k));
    if (orphans.length) await env.MEDIA.delete(orphans);
    return orphans.length;
  } catch (err) {
    console.error('Pembersihan gambar artikel gagal', err && err.message ? err.message : err);
    return 0;
  }
}

/** Selepas artikel dipadam: padam gambarnya yang tidak dirujuk oleh artikel lain. */
export async function deleteImagesOf(env, row) {
  try {
    const mine = imageKeysOf(row);
    if (!mine.size) return 0;
    const { results } = await env.DB.prepare('SELECT cover_key, body FROM articles').all();
    for (const r of results) for (const k of imageKeysOf(r)) mine.delete(k);
    if (mine.size) await env.MEDIA.delete([...mine]);
    return mine.size;
  } catch (err) {
    console.error('Padam gambar artikel gagal', err && err.message ? err.message : err);
    return 0;
  }
}
