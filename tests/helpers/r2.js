// R2 tiruan dalam memori: put, head, get, delete (satu atau banyak kunci), list.

export class FakeR2 {
  constructor() {
    this.objects = new Map();
  }

  async put(key, value, options = {}) {
    if (this.failPuts) throw new Error('R2 put gagal (simulasi)');
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value);
    this.objects.set(key, { bytes: new Uint8Array(bytes), httpMetadata: options.httpMetadata || {}, uploaded: new Date() });
    return { key, size: bytes.length };
  }

  async head(key) {
    const o = this.objects.get(key);
    return o ? { key, size: o.bytes.length, httpMetadata: o.httpMetadata, uploaded: o.uploaded } : null;
  }

  async get(key) {
    const o = this.objects.get(key);
    return o ? { key, size: o.bytes.length, body: o.bytes, arrayBuffer: async () => o.bytes.buffer } : null;
  }

  async delete(keys) {
    for (const k of [].concat(keys)) this.objects.delete(k);
  }

  // Paginasi seperti R2: limit, cursor (indeks permulaan), truncated.
  async list({ prefix = '', limit = 1000, cursor } = {}) {
    const all = [...this.objects.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, o]) => ({ key, size: o.bytes.length, uploaded: o.uploaded }));
    const start = cursor ? Number(cursor) : 0;
    const objects = all.slice(start, start + limit);
    const truncated = start + limit < all.length;
    return { objects, truncated, cursor: truncated ? String(start + limit) : undefined };
  }

  // Pembantu ujian: undurkan masa muat naik objek (untuk menguji tempoh tangguh objek yatim).
  age(key, ms) {
    const o = this.objects.get(key);
    o.uploaded = new Date(o.uploaded.getTime() - ms);
  }

  json(key) {
    const o = this.objects.get(key);
    return o ? JSON.parse(new TextDecoder().decode(o.bytes)) : null;
  }

  keys() {
    return [...this.objects.keys()];
  }
}

// Bait contoh yang lulus semakan magic bytes.
export function fakeJpeg(size = 2000) {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
}

export function fakeWebp(size = 2000) {
  const b = new Uint8Array(size);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return b;
}
