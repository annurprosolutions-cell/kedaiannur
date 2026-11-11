// POST /api/webhooks/bcl/:key (Fasa 6). Kunci rawak panjang dalam path = satu-satunya pengesahan penghantar, kerana
// webhook BCL tak ditandatangan; setiap transaksi disahkan semula melalui API BCL sebelum Pro diberi (lib/bcl.js).
// Middleware membenarkan laluan ini tanpa sesi dan tanpa semakan Origin (server ke server).

import { json } from '../../../../lib/http.js';
import { processBcl, safeEqual } from '../../../../lib/bcl.js';

export async function onRequestPost({ request, env, params, waitUntil }) {
  // Kunci salah atau belum ditetapkan: 404 supaya endpoint tak kelihatan wujud.
  if (!env.BCL_WEBHOOK_KEY || !safeEqual(String(params.key || ''), env.BCL_WEBHOOK_KEY)) {
    return json({ ok: false, error: 'tidak-dijumpai' }, 404);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'json-tidak-sah' }, 400);
  }
  // Balas 200 segera; kerja diteruskan di latar. BCL tak mengulang webhook yang gagal, jadi semua keputusan dilog
  // (Cloudflare, Workers & Pages, projek, Functions, Real-time logs) dan boleh dihantar semula dari BCL > Webhook Logs.
  const work = processBcl(body, env).then(
    (r) => console.log('webhook BCL', JSON.stringify(r)),
    (err) => console.error('webhook BCL ralat', err && err.stack ? err.stack : err),
  );
  waitUntil(work);
  return json({ ok: true, received: true });
}

export function onRequest() {
  return json({ ok: false, error: 'kaedah-tidak-disokong' }, 405, { Allow: 'POST' });
}
