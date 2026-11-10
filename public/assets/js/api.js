// Klien API: semua panggilan JSON ke /api/*. Ralat dipulangkan sebagai ApiError dengan mesej BM.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const MSG_RANGKAIAN = 'Tiada sambungan, cuba lagi.';
export const MSG_SIBUK = 'Sistem sibuk, cuba sebentar lagi.';

async function parse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || !data || data.ok === false) {
    const code = (data && data.code) || (res.status >= 500 ? 'sistem-sibuk' : 'ralat');
    const message = (data && data.message) || (res.status >= 500 ? MSG_SIBUK : 'Ralat tidak dijangka.');
    const err = new ApiError(res.status, code, message);
    err.fields = (data && data.fields) || null;
    throw err;
  }
  return data;
}

async function send(path, opts) {
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError(0, 'rangkaian', MSG_RANGKAIAN);
  }
  return parse(res);
}

export function api(path, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (method !== 'GET') {
    // Middleware server menolak mutasi tanpa application/json (perlindungan CSRF).
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body ?? {});
  }
  return send(path, opts);
}

// Muat naik gambar yang sudah dimampatkan (Blob image/webp atau image/jpeg). Pulangkan { key, bytes, type }.
export function upload(kind, blob) {
  return send(`/api/upload?kind=${encodeURIComponent(kind)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': blob.type },
    body: blob,
  });
}
