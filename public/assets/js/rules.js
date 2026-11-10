// Peraturan kongsi antara browser dan server (functions/ import fail ini terus).
// Satu sumber supaya validasi di borang dan di API tak pernah berbeza. Fail ini mesti kekal fungsi tulen
// tanpa akses DOM, fetch atau API platform.

// Warna tema kedai: 8 pilihan DBD seksyen 3 (semua diuji untuk teks putih, lihat tests/rules.test.js).
export const THEME_COLORS = [
  { hex: '#0F766E', name: 'Teal' },
  { hex: '#15803D', name: 'Hijau' },
  { hex: '#1D4ED8', name: 'Biru' },
  { hex: '#4338CA', name: 'Indigo' },
  { hex: '#7E22CE', name: 'Ungu' },
  { hex: '#BE123C', name: 'Merah jambu' },
  { hex: '#C2410C', name: 'Oren' },
  { hex: '#1E293B', name: 'Kelabu gelap' },
];
export const DEFAULT_THEME = '#0F766E';

export const LIMITS = {
  nameMin: 2,
  nameMax: 60,
  descMax: 300,
  slugMin: 3,
  slugMax: 30,
  waMin: 9,
  waMax: 15,
  slugChangesMax: 3,
};

export const MSG = {
  slugTakBoleh: 'Nama ini tak boleh digunakan, cuba yang lain.',
  nama: `Nama kedai mesti ${LIMITS.nameMin} hingga ${LIMITS.nameMax} aksara.`,
  penerangan: `Penerangan maksimum ${LIMITS.descMax} aksara.`,
  whatsapp: 'Nombor WhatsApp tak sah. Contoh: 0123456789',
  warna: 'Pilih salah satu warna yang disediakan.',
  boolean: 'Nilai tak sah.',
};

// Slug yang tak boleh digunakan walaupun tiada dalam jadual reserved_slugs: ia bertembung dengan fail statik di akar.
const EXTRA_RESERVED = new Set(['index', '404']);

export function isReservedLocally(slug) {
  return EXTRA_RESERVED.has(slug);
}

export function normalizeSlug(input) {
  return String(input ?? '').trim().toLowerCase();
}

/**
 * Semak format slug. Pulangkan null jika sah, atau { code, message }.
 * code: 'panjang' | 'aksara' | 'sempang' (borang guna code untuk tak menunjuk ralat semasa menaip).
 */
export function slugFormatIssue(slug) {
  if (slug.length < LIMITS.slugMin || slug.length > LIMITS.slugMax) {
    return { code: 'panjang', message: `Nama link mesti ${LIMITS.slugMin} hingga ${LIMITS.slugMax} aksara.` };
  }
  if (/[^a-z0-9-]/.test(slug)) {
    return { code: 'aksara', message: 'Guna huruf kecil, nombor dan sempang (-) sahaja.' };
  }
  if (slug.startsWith('-') || slug.endsWith('-')) {
    return { code: 'sempang', message: 'Nama link tak boleh bermula atau berakhir dengan sempang (-).' };
  }
  return null;
}

export function slugFormatError(slug) {
  const issue = slugFormatIssue(slug);
  return issue ? issue.message : null;
}

// Cadangan slug daripada nama kedai: "Kuih Mak Cik Ánna!" -> "kuih-mak-cik-anna". Kosong jika terlalu pendek.
export function slugify(name) {
  const s = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slugMax)
    .replace(/-+$/g, '');
  return s.length >= LIMITS.slugMin ? s : '';
}

/**
 * Normalisasi nombor WhatsApp (BSD peraturan 5): buang semua bukan digit; "0..." menjadi "60...";
 * "60..." kekal; selain itu terima jika 9 hingga 15 digit. Pulangkan null jika tak sah.
 * Dua pembetulan untuk kesilapan biasa: awalan antarabangsa "00" dibuang, dan "+60 0123..."
 * (sifar lebihan selepas 60) dibetulkan kepada "60123...".
 */
export function normalizeWhatsapp(input) {
  let d = String(input ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `60${d.slice(1)}`;
  else if (d.startsWith('600')) d = `60${d.slice(3)}`;
  if (d.length < LIMITS.waMin || d.length > LIMITS.waMax) return null;
  return d;
}

// 60123456789 -> "+60 12-345 6789" untuk dipaparkan semula kepada peniaga supaya mereka boleh sahkan.
export function formatWhatsapp(n) {
  if (!/^\d+$/.test(n)) return n;
  if (n.startsWith('60') && n.length >= 10) {
    const rest = n.slice(2);
    return `+60 ${rest.slice(0, 2)}-${rest.slice(2, rest.length - 4)} ${rest.slice(-4)}`;
  }
  return `+${n}`;
}

// Buang aksara kawalan (kecuali baris baharu dan tab), ringkaskan ruang kosong hujung.
export function cleanText(value, { multiline = false } = {}) {
  let s = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = s.replace(/\r\n?/g, '\n');
  if (!multiline) s = s.replace(/\s+/g, ' ');
  return s.trim();
}

export function isThemeColor(hex) {
  return THEME_COLORS.some((c) => c.hex === hex);
}
