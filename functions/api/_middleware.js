// Middleware untuk semua /api/*: tangkap ralat, semak Origin dan Content-Type untuk mutasi,
// muat sesi, dan semak superadmin. Akses ditolak secara lalai; laluan awam disenaraikan di bawah.

import { fail, MSG } from '../../lib/http.js';
import { userFromRequest, isSuperadmin } from '../../lib/session.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Laluan yang tidak memerlukan sesi.
const PUBLIC_EXACT = new Set(['/api/ping', '/api/config', '/api/plans', '/api/market', '/api/auth/google', '/api/auth/logout']);
const PUBLIC_PREFIX = ['/api/webhooks/']; // webhook BCL (Fasa 6) disahkan dengan kunci dalam path

// Laluan mutasi yang menerima badan bukan JSON (gambar binari, Fasa 2).
const NON_JSON_BODY = new Set(['/api/upload']);

// Awam tetapi tetap melalui semakan Origin dan Content-Type (dihantar oleh halaman kedai sendiri).
const PUBLIC_BROWSER_PREFIX = ['/api/track/'];

function isPublic(path) {
  return PUBLIC_EXACT.has(path) || PUBLIC_PREFIX.some((p) => path.startsWith(p)) || PUBLIC_BROWSER_PREFIX.some((p) => path.startsWith(p));
}

function isServerToServer(path) {
  return PUBLIC_PREFIX.some((p) => path.startsWith(p));
}

async function errorHandler(context) {
  try {
    return await context.next();
  } catch (err) {
    // Termasuk ralat D1 bila had harian dicapai. Jangan dedahkan butiran kepada client.
    console.error('API error', context.request.method, new URL(context.request.url).pathname, err && err.stack ? err.stack : err);
    return fail(500, 'sistem-sibuk', MSG.sistemSibuk);
  }
}

async function requestGuard(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (MUTATING.has(request.method) && !isServerToServer(path)) {
    // CSRF: cookie SameSite=Lax + Origin mesti sama dengan origin laman ini.
    // Di produksi origin = https://kedai.annurpro.com; di preview atau local, origin deployment itu sendiri.
    const origin = request.headers.get('Origin');
    if (!origin || origin !== url.origin) {
      return fail(403, 'origin-ditolak', MSG.originDitolak);
    }
    // Borang HTML silang laman tak boleh hantar application/json tanpa preflight CORS.
    const type = (request.headers.get('Content-Type') || '').toLowerCase();
    if (!NON_JSON_BODY.has(path) && !type.startsWith('application/json')) {
      return fail(415, 'jenis-kandungan', MSG.jenisKandungan);
    }
  }

  context.data.user = null;
  if (!isPublic(path)) {
    const user = await userFromRequest(context.env.DB, request);
    if (!user) return fail(401, 'perlu-login', MSG.perluLogin);
    context.data.user = user;

    if (path === '/api/admin' || path.startsWith('/api/admin/')) {
      if (!isSuperadmin(context.env, user.email)) return fail(403, 'bukan-admin', MSG.bukanAdmin);
    }
  }

  return context.next();
}

export const onRequest = [errorHandler, requestGuard];
