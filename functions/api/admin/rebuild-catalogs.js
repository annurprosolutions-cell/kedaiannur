// POST /api/admin/rebuild-catalogs  { onlyDirty?: boolean, after?: shopId }
// Bina semula snapshot dalam kumpulan kecil (8 kedai setiap panggilan) supaya kekal dalam had CPU dan
// subrequest Functions percuma. Panel memanggil berulang kali dengan `next` sehingga `next` = null.

import { fail, json, readJson } from '../../../lib/http.js';
import { audit } from '../../../lib/admin.js';
import { publishSnapshot } from '../../../lib/catalog.js';

const BATCH = 8;

export async function onRequestPost({ request, env, data }) {
  const parsed = await readJson(request);
  if (parsed.error) return fail(400, 'badan-tidak-sah', 'Format permintaan tidak sah.');
  const onlyDirty = parsed.value.onlyDirty === true;
  const after = typeof parsed.value.after === 'string' ? parsed.value.after : '';

  const { results } = await env.DB
    .prepare(`SELECT id, slug FROM shops WHERE id > ?1 ${onlyDirty ? 'AND catalog_dirty = 1' : ''} ORDER BY id LIMIT ?2`)
    .bind(after, BATCH)
    .all();

  if (!after) await audit(env.DB, data.user.email, 'rebuild_catalogs', null, { onlyDirty });
  const failed = [];
  for (const s of results) {
    if (!(await publishSnapshot(env, s.id))) failed.push(s.slug);
  }
  const next = results.length === BATCH ? results[results.length - 1].id : null;
  return json({ ok: true, processed: results.length, failed, next });
}
