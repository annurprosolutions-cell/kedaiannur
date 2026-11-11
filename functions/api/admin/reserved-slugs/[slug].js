// DELETE /api/admin/reserved-slugs/:slug

import { json } from '../../../../lib/http.js';
import { audit } from '../../../../lib/admin.js';
import { normalizeSlug } from '../../../../public/assets/js/rules.js';

export async function onRequestDelete({ env, data, params }) {
  const slug = normalizeSlug(params.slug);
  const res = await env.DB.prepare('DELETE FROM reserved_slugs WHERE slug = ?1').bind(slug).run();
  if (res.meta.changes) await audit(env.DB, data.user.email, 'remove_reserved_slug', null, { slug });
  return json({ ok: true, removed: res.meta.changes === 1 });
}
