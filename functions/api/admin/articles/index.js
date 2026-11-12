// /api/admin/articles  GET senarai semua artikel (termasuk draf), POST cipta artikel (superadmin).

import { fail, failFields, json, readJson } from '../../../../lib/http.js';
import { audit } from '../../../../lib/admin.js';
import { adminArticle, articleById, articleBySlug, listAll, mediaBase } from '../../../../lib/articles.js';
import { normalizeArticle } from '../../../../public/assets/js/artikel.js';

export const MAX_BODY_BYTES = 220 * 1024;

export async function onRequestGet({ env }) {
  const rows = await listAll(env);
  const media = mediaBase(env);
  return json({
    ok: true,
    articles: rows.map((r) => ({
      id: r.id, slug: r.slug, title: r.title, description: r.description, status: r.status,
      noindex: Boolean(r.noindex), featured: Boolean(r.featured),
      cover: r.cover_key ? `${media}/${r.cover_key}` : '',
      publishedAt: r.published_at ? `${r.published_at.replace(' ', 'T')}Z` : null,
      updatedAt: `${r.updated_at.replace(' ', 'T')}Z`,
    })),
  });
}

/** Semak gambar utama wujud dalam R2 (bukan sekadar format kunci yang betul). */
export async function coverMissing(env, key) {
  return Boolean(key) && !(await env.MEDIA.head(key));
}

export async function onRequestPost({ request, env, data }) {
  const parsed = await readJson(request, MAX_BODY_BYTES);
  if (parsed.error) return fail(parsed.error === 'terlalu-besar' ? 413 : 400, 'badan-tidak-sah', 'Kandungan terlalu besar atau format tidak sah.');
  const { value, errors } = normalizeArticle(parsed.value);
  if (errors) return failFields(errors);
  if (await coverMissing(env, value.coverKey)) return failFields({ coverKey: 'Gambar utama tak dijumpai. Muat naik semula.' });
  if (await articleBySlug(env, value.slug)) return failFields({ slug: 'Slug ini sudah digunakan artikel lain.' }, 409, 'slug-diguna');

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO articles (id, slug, title, seo_title, description, body, cover_key, cover_alt, focus_keyword, author, status, noindex, featured, published_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, CASE WHEN ?11 = 'published' THEN datetime('now') END)`,
  )
    .bind(id, value.slug, value.title, value.seoTitle, value.description, value.body, value.coverKey, value.coverAlt, value.focusKeyword, value.author, value.status, value.noindex ? 1 : 0, value.featured ? 1 : 0)
    .run();
  await audit(env.DB, data.user.email, 'article_create', null, { id, slug: value.slug, status: value.status });
  return json({ ok: true, article: adminArticle(await articleById(env, id), env) }, 201);
}
