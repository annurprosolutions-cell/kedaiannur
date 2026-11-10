// Pengesahan Google ID token (RS256) tanpa library luar.
// Rujukan: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

import { base64UrlDecode } from './crypto.js';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_SEC = 60;
const MAX_TOKEN_LENGTH = 4096;
const MIN_REFETCH_MS = 5 * 60 * 1000; // kid tak dijumpai: ambil semula JWKS paling kerap sekali 5 minit

export class TokenError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'TokenError';
    this.reason = reason;
  }
}

// Cache per isolate. Kunci Google bertukar beberapa kali seminggu; max-age dari header dihormati.
let jwksCache = { keys: new Map(), expiresAt: 0, fetchedAt: 0 };

export function _resetJwksCache() {
  jwksCache = { keys: new Map(), expiresAt: 0, fetchedAt: 0 };
}

async function loadJwks(now) {
  // cf.cacheTtl: cache subrequest di edge Cloudflare (diabaikan di Node).
  const res = await fetch(GOOGLE_JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`);
  const body = await res.json();
  if (!body || !Array.isArray(body.keys)) throw new Error('JWKS tidak sah');

  const keys = new Map();
  for (const jwk of body.keys) {
    if (jwk.kty !== 'RSA' || !jwk.kid || !jwk.n || !jwk.e) continue;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    keys.set(jwk.kid, key);
  }

  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  const ttlMs = Math.min(Math.max(maxAge ? Number(maxAge[1]) * 1000 : 3600_000, 60_000), 24 * 3600_000);
  jwksCache = { keys, expiresAt: now + ttlMs, fetchedAt: now };
}

async function getKey(kid, now) {
  if (now >= jwksCache.expiresAt) await loadJwks(now);
  let key = jwksCache.keys.get(kid);
  if (!key && now - jwksCache.fetchedAt >= MIN_REFETCH_MS) {
    await loadJwks(now);
    key = jwksCache.keys.get(kid);
  }
  return key || null;
}

function decodeJsonPart(part) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));
  } catch {
    throw new TokenError('format');
  }
}

/**
 * Sahkan ID token daripada Google Identity Services.
 * Pulangkan { sub, email, name } jika sah; baling TokenError jika token ditolak.
 * Ralat lain (contoh JWKS gagal dimuat) dibaling sebagai Error biasa.
 */
export async function verifyGoogleIdToken(token, clientId, now = Date.now()) {
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID belum ditetapkan');
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) throw new TokenError('format');

  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('format');
  const [h, p, s] = parts;

  const header = decodeJsonPart(h);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new TokenError('alg');

  const key = await getKey(header.kid, now);
  if (!key) throw new TokenError('kid');

  let signature;
  try {
    signature = base64UrlDecode(s);
  } catch {
    throw new TokenError('format');
  }
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature,
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) throw new TokenError('signature');

  const claims = decodeJsonPart(p);
  const nowSec = Math.floor(now / 1000);

  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new TokenError('iss');
  const audOk = Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId;
  if (!audOk) throw new TokenError('aud');
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SEC < nowSec) throw new TokenError('exp');
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SEC > nowSec) throw new TokenError('iat');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new TokenError('email_verified');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new TokenError('sub');
  if (typeof claims.email !== 'string' || !claims.email.includes('@') || claims.email.length > 254) {
    throw new TokenError('email');
  }

  const name = typeof claims.name === 'string' ? claims.name.trim().slice(0, 100) : null;
  return { sub: claims.sub, email: claims.email.trim().toLowerCase(), name: name || null };
}
