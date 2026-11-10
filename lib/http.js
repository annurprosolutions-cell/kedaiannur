// Pembantu HTTP untuk Pages Functions: respons JSON, ralat standard dan cookie.
// Header _headers tidak terpakai pada respons Function, jadi header keselamatan diletak di sini.

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(BASE_HEADERS);
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (Array.isArray(v)) v.forEach((item) => headers.append(k, item));
    else headers.set(k, v);
  }
  return new Response(JSON.stringify(data), { status, headers });
}

// Format ralat seragam: { ok: false, code, message } supaya frontend papar mesej BM.
export function fail(status, code, message, extraHeaders = {}) {
  return json({ ok: false, code, message }, status, extraHeaders);
}

// Ralat validasi dengan mesej setiap medan: { ok:false, code:'tidak-sah', message, fields:{ nama:'...' } }
export function failFields(fields, status = 400, code = 'tidak-sah') {
  const first = Object.values(fields)[0];
  return json({ ok: false, code, message: first, fields }, status);
}

export const MSG = {
  sistemSibuk: 'Sistem sibuk, cuba sebentar lagi.',
  perluLogin: 'Sila log masuk semula.',
  bukanAdmin: 'Akses ditolak.',
  loginGagal: 'Login tak berjaya, cuba lagi.',
  originDitolak: 'Permintaan ditolak.',
  jenisKandungan: 'Format permintaan tidak sah.',
  tiada: 'Laluan tidak dijumpai.',
};

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || name in out) continue;
    out[name] = part.slice(i + 1).trim();
  }
  return out;
}

// Prefix __Host- memaksa Secure, Path=/ dan tiada Domain: cookie tak boleh ditimpa oleh subdomain lain.
export const SESSION_COOKIE = '__Host-sid';

export function sessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export async function readJson(request, maxBytes = 16384) {
  const text = await request.text();
  if (text.length > maxBytes) return { error: 'terlalu-besar' };
  if (!text) return { value: {} };
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { error: 'bukan-objek' };
    return { value };
  } catch {
    return { error: 'json-rosak' };
  }
}
