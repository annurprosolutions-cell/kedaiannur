// Google palsu untuk ujian: jana kunci RSA, tandatangan ID token, dan jawab JWKS melalui fetch tiruan.

import { base64UrlEncode } from '../../lib/crypto.js';
import { GOOGLE_JWKS_URL, _resetJwksCache } from '../../lib/google.js';

export const CLIENT_ID = 'test-client.apps.googleusercontent.com';

async function rsaKey() {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
}

const enc = (obj) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));

export async function createFakeGoogle() {
  const key = await rsaKey();
  const otherKey = await rsaKey(); // untuk ujian tandatangan palsu
  const kid = 'kid-ujian-1';
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', key.publicKey)), kid, alg: 'RS256', use: 'sig' };

  const state = { jwksCalls: 0, jwksFail: false };
  const realFetch = globalThis.fetch;

  function install() {
    _resetJwksCache();
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === GOOGLE_JWKS_URL) {
        state.jwksCalls++;
        if (state.jwksFail) return new Response('down', { status: 503 });
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=21600' },
        });
      }
      throw new Error(`fetch tidak dijangka dalam ujian: ${url}`);
    };
  }

  function restore() {
    globalThis.fetch = realFetch;
    _resetJwksCache();
  }

  async function sign(overrides = {}, { header = {}, signWith = key.privateKey } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: '1234567890',
      email: 'Peniaga@Gmail.com',
      email_verified: true,
      name: 'Peniaga Ujian',
      iat: now,
      exp: now + 3600,
      ...overrides,
    };
    for (const k of Object.keys(claims)) if (claims[k] === undefined) delete claims[k];
    const head = enc({ alg: 'RS256', kid, typ: 'JWT', ...header });
    const body = enc(claims);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signWith, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${base64UrlEncode(new Uint8Array(sig))}`;
  }

  return { install, restore, sign, state, otherPrivateKey: otherKey.privateKey, kid };
}
