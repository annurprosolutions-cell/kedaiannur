// GET /api/slug-check?slug=  Semak slug tersedia (format, reserved, sudah diambil).
// Slug kedai sendiri dianggap tersedia (skrin tetapan menyemak slug semasa).

import { fail, json } from '../../lib/http.js';
import { MSG as RULE_MSG, isReservedLocally, normalizeSlug, slugFormatError } from '../../public/assets/js/rules.js';

export async function onRequestGet({ request, env, data }) {
  const raw = new URL(request.url).searchParams.get('slug');
  if (raw === null || raw.length > 200) return fail(400, 'tidak-sah', 'Slug diperlukan.');

  const slug = normalizeSlug(raw);
  const formatError = slugFormatError(slug);
  if (formatError) return json({ ok: true, available: false, reason: 'format', message: formatError });
  if (isReservedLocally(slug)) return json({ ok: true, available: false, reason: 'reserved', message: RULE_MSG.slugTakBoleh });

  const row = await env.DB
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM reserved_slugs WHERE slug = ?1) AS reserved,
              (SELECT owner_user_id FROM shops WHERE slug = ?1) AS owner`,
    )
    .bind(slug)
    .first();

  if (row.reserved) return json({ ok: true, available: false, reason: 'reserved', message: RULE_MSG.slugTakBoleh });
  if (row.owner && row.owner !== data.user.id) {
    return json({ ok: true, available: false, reason: 'taken', message: RULE_MSG.slugTakBoleh });
  }
  return json({ ok: true, available: true, slug });
}
