// Validasi input kedai di server. Peraturan sebenar ada dalam public/assets/js/rules.js (kongsi dengan borang).
// Hanya medan dalam senarai putih dipetakan; plan_*, status, storage_bytes, slug_changes tak pernah diambil daripada client.

import {
  LIMITS, MSG, cleanText, isThemeColor, normalizeHours, normalizeMapsUrl, normalizeSlug, normalizeSocial, normalizeWhatsapp,
  slugFormatError,
} from '../public/assets/js/rules.js';

// kunci body -> { lajur D1, penukar }
const FIELDS = {
  name: (v) => {
    const s = cleanText(v);
    return s.length >= LIMITS.nameMin && s.length <= LIMITS.nameMax ? { value: s } : { error: MSG.nama };
  },
  slug: (v) => {
    const s = normalizeSlug(v);
    const err = slugFormatError(s);
    return err ? { error: err } : { value: s };
  },
  whatsapp: (v) => {
    const n = normalizeWhatsapp(v);
    return n ? { value: n } : { error: MSG.whatsapp };
  },
  description: (v) => {
    if (v === null || v === undefined) return { value: '' };
    if (typeof v !== 'string') return { error: MSG.penerangan };
    const s = cleanText(v, { multiline: true });
    return s.length <= LIMITS.descMax ? { value: s } : { error: MSG.penerangan };
  },
  themeColor: (v) => (typeof v === 'string' && isThemeColor(v.toUpperCase()) ? { value: v.toUpperCase() } : { error: MSG.warna }),
  isOpen: bool,
  askName: bool,
  askAddress: bool,
  openingHours: normalizeHours,
  mapsUrl: normalizeMapsUrl,
  instagram: (v) => normalizeSocial('instagram', v),
  tiktok: (v) => normalizeSocial('tiktok', v),
  facebook: (v) => normalizeSocial('facebook', v),
};

function bool(v) {
  return typeof v === 'boolean' ? { value: v ? 1 : 0 } : { error: MSG.boolean };
}

const COLUMN = {
  name: 'name',
  slug: 'slug',
  whatsapp: 'whatsapp',
  description: 'description',
  themeColor: 'theme_color',
  isOpen: 'is_open',
  askName: 'ask_name',
  askAddress: 'ask_address',
  openingHours: 'opening_hours',
  mapsUrl: 'maps_url',
  instagram: 'instagram',
  tiktok: 'tiktok',
  facebook: 'facebook',
  messageTemplate: 'message_template', // divalidasi dalam functions/api/shop.js kerana bergantung pada pelan
};

// Wajib semasa cipta kedai.
const REQUIRED_ON_CREATE = ['name', 'slug', 'whatsapp'];

/**
 * @returns {{ values: object, errors: object|null }} values menggunakan kunci body (name, slug, ...).
 */
export function validateShopInput(body, { partial }) {
  const values = {};
  const errors = {};
  for (const [key, parse] of Object.entries(FIELDS)) {
    if (!(key in body)) {
      if (!partial && REQUIRED_ON_CREATE.includes(key)) errors[key] = key === 'slug' ? MSG.slugTakBoleh : 'Wajib diisi.';
      continue;
    }
    const r = parse(body[key]);
    if (r.error) errors[key] = r.error;
    else values[key] = r.value;
  }
  return { values, errors: Object.keys(errors).length ? errors : null };
}

export function columnFor(key) {
  return COLUMN[key];
}
