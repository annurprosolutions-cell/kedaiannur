// /api/admin/articles/:id  GET satu artikel, PATCH kemas kini (badan penuh dari editor), DELETE padam (superadmin).
// Gambar yang tak lagi dirujuk dibersihkan oleh sweepArticleImages selepas tempoh tangguh.

import { fail, failFields, json, readJson } from '../../../../lib/http.js';
import { audit } from '../../../../lib/admin.js';
import { adminArticle, articleById, articleBySlug, deleteImagesOf, sweepArticleImages } from '../../../../lib/articles.js';
import { normalizeArticle } from '../../../../public/assets/js/artikel.js';
import { MAX_BODY_BYTES, coverMissing } from './index.js';

const notFound = () => fail(404, 'tiada', 'Artikel tak dijumpai.');

export async function onRequestGet({ env, params }) {
  const row = await articleById(env, params.id);
  return row ? json({ ok: true, article: adminArticle(row, env) }) : notFound();
}

export async function onRequestPatch({ request, env, params, data, waitUntil }) {
  const row = await articleById(env, params.id);
  if (!row) return notFound();
  const parsed = await readJson(request, MAX_BODY_BYTES);
  if (parsed.error) return fail(parsed.error === 'terlalu-besar' ? 413 : 400, 'badan-tidak-sah', 'Kandungan terlalu besar atau format tidak sah.');
  // Editor menghantar semua medan; jika tertinggal, kekalkan nilai sedia ada.
  const merged = {
    title: row.title, slug: row.slug, seoTitle: row.seo_title, description: row.description, body: row.body,
    coverKey: row.cover_key, coverAlt: row.cover_alt, focusKeyword: row.focus_keyword, author: row.author,
    status: row.status, noindex: Boolean(row.noindex), featured: Boolean(row.featured),
    ...parsed.value,
  };
  const { value, errors } = normalizeArticle(merged);
  if (errors) return failFields(errors);
  if (value.coverKey !== row.cover_key && (await coverMissing(env, value.coverKey))) return failFields({ coverKey: 'Gambar utama tak dijumpai. Muat naik semula.' });
  if (value.slug !== row.slug) {
    const other = await articleBySlug(env, value.slug);
    if (other && other.id !== row.id) return failFields({ slug: 'Slug ini sudah digunakan artikel lain.' }, 409, 'slug-diguna');
  }

  await env.DB.prepare(
    `UPDATE articles SET slug = ?2, title = ?3, seo_title = ?4, description = ?5, body = ?6, cover_key = ?7, cover_alt = ?8,
       focus_keyword = ?9, author = ?10, status = ?11, noindex = ?12, featured = ?13,
       published_at = CASE WHEN ?11 = 'published' THEN COALESCE(published_at, datetime('now')) ELSE published_at END,
       updated_at = datetime('now')
     WHERE id = ?1`,
  )
    .bind(row.id, value.slug, value.title, value.seoTitle, value.description, value.body, value.coverKey, value.coverAlt, value.focusKeyword, value.author, value.status, value.noindex ? 1 : 0, value.featured ? 1 : 0)
    .run();
  const action = row.status !== value.status ? (value.status === 'published' ? 'article_publish' : 'article_unpublish') : 'article_update';
  await audit(env.DB, data.user.email, action, null, { id: row.id, slug: value.slug, ...(value.slug !== row.slug ? { oldSlug: row.slug } : {}) });
  waitUntil(sweepArticleImages(env));
  return json({ ok: true, article: adminArticle(await articleById(env, row.id), env) });
}

export async function onRequestDelete({ env, params, data, waitUntil }) {
  const row = await articleById(env, params.id);
  if (!row) return notFound();
  await env.DB.prepare('DELETE FROM articles WHERE id = ?1').bind(row.id).run();
  await audit(env.DB, data.user.email, 'article_delete', null, { id: row.id, slug: row.slug, title: row.title });
  // Gambar artikel ini dipadam serta-merta jika tiada artikel lain merujuknya.
  waitUntil(deleteImagesOf(env, row));
  return json({ ok: true });
}
