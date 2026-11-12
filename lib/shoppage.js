// Halaman kedai awam /<slug> (S-02, F-14). Dibaca daripada snapshot R2, bukan D1.
// Fungsi di sini tulen (tiada binding) supaya boleh diuji dalam Node; functions/[slug].js menyambungkannya.

// Mesti sama dengan public/_headers (diuji dalam tests/shoppage.test.js): _headers tak terpakai pada respons Function.
export const PAGE_CSP =
  "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: blob: https://media.annurpro.com; connect-src 'self' https://accounts.google.com/gsi/ https://media.annurpro.com; frame-src https://accounts.google.com/gsi/; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

export const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': PAGE_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

export const HEAD_MARKER = '<!--HEAD-->';
export const DATA_MARKER = '<script type="application/json" id="page-data">null</script>';
const TITLE_RE = /<title>[^<]*<\/title>/;
const DEFAULT_DESC = 'Pilih produk dan hantar order terus ke WhatsApp kedai.';
// Mesti sama dengan baris dalam public/shop.html (diuji): diganti dengan logo kedai Pro.
export const DEFAULT_ICON = '<link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">';

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// JSON selamat dalam <script>: "<" menjadi < supaya "</script>" dalam data tak boleh menutup tag (TRD seksyen 6).
export function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function oneLine(s, max) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * @param template  kandungan public/shop.html
 * @param page      { slug, origin, media, report, catalog|null, missing? }
 */
export function renderShopPage(template, page) {
  const { slug, origin, media, catalog } = page;
  const url = `${origin}/${slug}`;
  let title = 'Kedai tak dijumpai | Kedai AnnurPro';
  const head = [];

  if (catalog) {
    const s = catalog.shop;
    const desc = oneLine(s.desc, 200) || DEFAULT_DESC;
    const banner = catalog.banners && catalog.banners[0] ? `${media}/${catalog.banners[0].k}` : '';
    const logo = s.logo ? `${media}/${s.logo}` : '';
    const image = banner || logo || `${origin}/assets/og-default.png`;
    title = s.branding ? `${s.name} | Kedai AnnurPro` : s.name;
    head.push(
      `<meta name="description" content="${escapeHtml(desc)}">`,
      `<link rel="canonical" href="${escapeHtml(url)}">`,
      '<meta property="og:type" content="website">',
      '<meta property="og:site_name" content="Kedai AnnurPro">',
      `<meta property="og:title" content="${escapeHtml(s.name)}">`,
      `<meta property="og:description" content="${escapeHtml(desc)}">`,
      `<meta property="og:url" content="${escapeHtml(url)}">`,
      `<meta property="og:image" content="${escapeHtml(image)}">`,
      banner || logo ? '' : '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="theme-color" content="${escapeHtml(s.theme)}">`,
      // Banner ialah elemen LCP: muat awal sebelum JavaScript berjalan.
      banner ? `<link rel="preload" as="image" href="${escapeHtml(banner)}" fetchpriority="high">` : '',
      // Data berstruktur untuk enjin carian (schema.org Store). Blok data, bukan skrip, jadi CSP tak menyekat.
      `<script type="application/ld+json">${safeJson(storeLd(s, url, banner || logo, logo))}</script>`,
    );
  } else {
    head.push('<meta name="robots" content="noindex">');
  }

  const data = { slug, media, report: page.report || '', catalog: catalog || null, missing: !catalog };
  let html = template;
  if (catalog && catalog.shop.fav && catalog.shop.logo) {
    const icon = escapeHtml(`${media}/${catalog.shop.logo}`);
    html = html.replace(DEFAULT_ICON, `<link rel="icon" href="${icon}">\n  <link rel="apple-touch-icon" href="${icon}">`);
  }
  return html
    .replace(TITLE_RE, `<title>${escapeHtml(title)}</title>`)
    .replace(HEAD_MARKER, head.filter(Boolean).join('\n  '))
    .replace(DATA_MARKER, `<script type="application/json" id="page-data">${safeJson(data)}</script>`);
}

// Pautan sosial disusun semula daripada nama akaun (sama seperti halaman kedai), bukan teks bebas daripada peniaga.
function storeLd(s, url, image, logo) {
  const info = s.info || {};
  const sameAs = [
    info.ig ? `https://www.instagram.com/${encodeURIComponent(info.ig)}/` : '',
    info.tt ? `https://www.tiktok.com/@${encodeURIComponent(info.tt)}` : '',
    info.fb ? (/^\d+$/.test(info.fb) ? `https://www.facebook.com/profile.php?id=${info.fb}` : `https://www.facebook.com/${encodeURIComponent(info.fb)}`) : '',
  ].filter(Boolean);
  const ld = { '@context': 'https://schema.org', '@type': 'Store', name: s.name, url };
  if (s.desc) ld.description = oneLine(s.desc, 300);
  if (image) ld.image = image;
  if (logo) ld.logo = logo;
  if (info.maps) ld.hasMap = info.maps;
  if (sameAs.length) ld.sameAs = sameAs;
  return ld;
}

export function reportLink(env, slug) {
  const email = String(env.SUPPORT_EMAIL || '').trim();
  if (!/^[^\s@<>"']+@[^\s@<>"']+$/.test(email)) return '';
  return `mailto:${email}?subject=${encodeURIComponent(`Lapor kedai ${slug}`)}`;
}
