// /api/admin/reserved-slugs  GET senarai, POST { slug } tambah  (S-18)

import { fail, json, readJson } from '../../../../lib/http.js';
import { audit } from '../../../../lib/admin.js';
import { normalizeSlug, slugFormatError } from '../../../../public/assets/js/rules.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT slug FROM reserved_slugs ORDER BY slug').all();
  return json({ ok: true, slugs: results.map((r) => r.slug) });
}

export async function onRequestPost({ request, env, data }) {
  const parsed = await readJson(request);
  if (parsed.error) return fail(400, 'badan-tidak-sah', 'Format permintaan tidak sah.');
  const slug = normalizeSlug(parsed.value.slug);
  if (!slug || slug.length > 30 || /[^a-z0-9-]/.test(slug)) return fail(400, 'slug-tak-sah', 'Slug hanya huruf kecil, nombor dan sempang.');
  const res = await env.DB.prepare('INSERT OR IGNORE INTO reserved_slugs (slug) VALUES (?1)').bind(slug).run();
  const inUse = await env.DB.prepare('SELECT name FROM shops WHERE slug = ?1').bind(slug).first();
  if (res.meta.changes) await audit(env.DB, data.user.email, 'add_reserved_slug', null, { slug });
  return json({
    ok: true,
    slug,
    added: res.meta.changes === 1,
    // Kedai sedia ada tak terjejas; slug hanya disekat untuk pendaftaran atau tukar slug baharu.
    warning: inUse ? `Slug ini sedang digunakan oleh "${inUse.name}". Kedai itu tak terjejas.` : null,
    formatNote: slugFormatError(slug),
  });
}
