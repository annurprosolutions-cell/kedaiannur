// POST /api/auth/google  { credential: "<Google ID token>" }
// Sahkan ID token, cipta atau kemas kini pengguna, cipta sesi dan set cookie.

import { fail, json, readJson, sessionCookie, MSG } from '../../../lib/http.js';
import { verifyGoogleIdToken, TokenError } from '../../../lib/google.js';
import { loginWithGoogleProfile, buildMe } from '../../../lib/session.js';

export async function onRequestPost({ request, env }) {
  const { value: body, error } = await readJson(request);
  if (error || typeof body.credential !== 'string' || !body.credential) {
    return fail(400, 'login-gagal', MSG.loginGagal);
  }

  if (!env.GOOGLE_CLIENT_ID) {
    console.error('GOOGLE_CLIENT_ID belum ditetapkan dalam tetapan Pages');
    return fail(500, 'konfigurasi', 'Login belum dikonfigurasi. Hubungi sokongan.');
  }

  let profile;
  try {
    profile = await verifyGoogleIdToken(body.credential, env.GOOGLE_CLIENT_ID);
  } catch (err) {
    if (err instanceof TokenError) {
      console.warn('Token Google ditolak:', err.reason);
      return fail(401, 'login-gagal', MSG.loginGagal);
    }
    throw err; // contoh: JWKS Google gagal dimuat -> 500 oleh middleware
  }

  let session;
  try {
    session = await loginWithGoogleProfile(env.DB, env, profile);
  } catch (err) {
    // E-mel sama sudah dipautkan kepada akaun Google lain (google_sub berbeza).
    if (/UNIQUE constraint failed: users\.email/i.test(String(err && err.message))) {
      return fail(409, 'emel-konflik', 'E-mel ini sudah didaftarkan dengan akaun Google lain. Hubungi sokongan.');
    }
    throw err;
  }

  const me = await buildMe(env.DB, env, session.user);
  return json(me, 200, { 'Set-Cookie': sessionCookie(session.token, session.maxAge) });
}
