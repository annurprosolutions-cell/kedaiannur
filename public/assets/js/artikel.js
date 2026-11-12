// Artikel (dikongsi browser dan server): penukar Markdown ringkas yang selamat, had medan, pengesahan dan semakan SEO.
// Server (lib/articles.js) menggunakannya untuk menjana halaman /artikel/<slug>; editor admin untuk pratonton yang sama.
//
// Markdown yang disokong (sengaja kecil supaya mudah dan selamat):
//   ## Subtajuk, ### Subtajuk kecil       **tebal**, *condong*, `kod`
//   - senarai, 1. senarai bernombor        [teks](https://pautan)
//   > petikan                              ![teks alt](https://gambar "kapsyen")  (baris sendiri)
//   ---  garis pemisah
// Semua teks di-escape dahulu; hanya tag di atas dijana. Pautan dan gambar hanya https, http, / atau #.

export const SITE_ORIGIN = 'https://kedai.annurpro.com';

export const ARTICLE_LIMITS = {
  title: { min: 5, max: 120 },
  slug: { min: 3, max: 80 },
  seoTitle: { max: 70, ideal: [30, 60] },
  description: { max: 200, ideal: [70, 160] },
  focusKeyword: { max: 60 },
  coverAlt: { max: 150 },
  author: { max: 60 },
  body: { max: 100000 },
};

// Slug yang tak boleh dipakai artikel (bertembung dengan laluan atau fail).
const RESERVED_ARTICLE_SLUGS = new Set(['index', 'admin', 'api', 'baru', 'rss', 'feed']);

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Tukar teks kepada slug: huruf kecil, tanpa aksen, perkataan dipisah sempang. */
export function slugify(text, max = ARTICLE_LIMITS.slug.max) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' dan ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

// URL selamat untuk href/src. Nilai sudah di-escape HTML (jadi &amp; dibenarkan).
function safeUrl(url, { image = false } = {}) {
  const u = String(url || '').trim();
  if (/^https:\/\//i.test(u)) return u;
  if (/^\/(?!\/)/.test(u)) return u;
  if (!image && (/^http:\/\//i.test(u) || /^#[\w-]*$/.test(u) || /^mailto:[^\s]+$/i.test(u))) return u;
  return null;
}

function isExternal(href, origin) {
  return /^https?:\/\//i.test(href) && !href.toLowerCase().startsWith(origin.toLowerCase());
}

// Format sebaris pada teks yang SUDAH di-escape.
function inline(escaped, opts, out) {
  const tokens = [];
  const keep = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  let s = escaped.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`));
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const href = safeUrl(url);
    if (!href) return text;
    out.links.push(href);
    const ext = isExternal(href, opts.origin);
    return keep(`<a href="${href}"${ext ? ' rel="noopener" target="_blank"' : ''}>${emphasis(text)}</a>`);
  });
  s = emphasis(s);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}

function emphasis(s) {
  return s
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?!\s)([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');
}

const stripTags = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/**
 * Tukar Markdown ringkas kepada HTML selamat.
 * @returns {{ html: string, headings: {level:number,text:string,id:string}[], images: {src:string,alt:string}[],
 *            links: string[], text: string, firstParagraph: string, words: number }}
 */
export function renderMarkdown(src, { origin = SITE_ORIGIN } = {}) {
  const opts = { origin };
  const out = { headings: [], images: [], links: [] };
  const html = [];
  const ids = new Map();
  let para = [];
  let list = null; // { tag, items }
  let quote = [];
  let firstParagraph = '';

  const flushPara = () => {
    if (!para.length) return;
    const body = para.map((l) => inline(escapeHtml(l), opts, out)).join('<br>');
    if (!firstParagraph) firstParagraph = stripTags(body.replace(/<br>/g, ' '));
    html.push(`<p>${body}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    html.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(escapeHtml(i), opts, out)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    html.push(`<blockquote><p>${quote.map((l) => inline(escapeHtml(l), opts, out)).join('<br>')}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of String(src ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (!line.trim()) {
      flushAll();
    } else if ((m = /^(#{1,3})\s+(.+)$/.exec(line))) {
      flushAll();
      const level = m[1].length === 3 ? 3 : 2; // H1 dikhaskan untuk tajuk artikel
      const inner = inline(escapeHtml(m[2].replace(/\s*#+$/, '')), opts, out);
      const text = stripTags(inner);
      let id = slugify(text, 60) || 'bahagian';
      const n = (ids.get(id) || 0) + 1;
      ids.set(id, n);
      if (n > 1) id = `${id}-${n}`;
      out.headings.push({ level, text, id });
      html.push(`<h${level} id="${id}">${inner}</h${level}>`);
    } else if (/^ {0,3}(-{3,}|\*{3,})$/.test(line)) {
      flushAll();
      html.push('<hr>');
    } else if ((m = /^!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"([^"\n]*)")?\)$/.exec(line.trim()))) {
      flushAll();
      const alt = escapeHtml(m[1]);
      const src2 = safeUrl(escapeHtml(m[2]), { image: true });
      if (!src2) continue;
      out.images.push({ src: src2, alt: m[1] });
      const cap = m[3] ? `<figcaption>${inline(escapeHtml(m[3]), opts, out)}</figcaption>` : '';
      html.push(`<figure><img src="${src2}" alt="${alt}" loading="lazy" decoding="async">${cap}</figure>`);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flushPara();
      flushList();
      quote.push(m[1]);
    } else if ((m = /^\s*[-*+]\s+(.+)$/.exec(line))) {
      flushPara();
      flushQuote();
      if (list && list.tag !== 'ul') flushList();
      list ||= { tag: 'ul', items: [] };
      list.items.push(m[1]);
    } else if ((m = /^\s*\d{1,3}[.)]\s+(.+)$/.exec(line))) {
      flushPara();
      flushQuote();
      if (list && list.tag !== 'ol') flushList();
      list ||= { tag: 'ol', items: [] };
      list.items.push(m[1]);
    } else {
      flushList();
      flushQuote();
      para.push(line.trim());
    }
  }
  flushAll();
  const joined = html.join('\n');
  const text = stripTags(joined.replace(/<\/(p|li|h2|h3|figcaption)>/g, ' ')).replace(/\s+/g, ' ').trim();
  return { html: joined, ...out, text, firstParagraph, words: text ? text.split(' ').length : 0 };
}

/** Anggaran masa membaca (200 patah perkataan seminit, minimum 1). */
export const readingMinutes = (words) => Math.max(1, Math.round(words / 200));

function str(v) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

/**
 * Sahkan input artikel daripada editor. Pulangkan { value } atau { errors: { medan: mesej } }.
 * Medan: title, slug, seoTitle, description, body, coverKey, coverAlt, focusKeyword, author, status, noindex, featured.
 */
export function normalizeArticle(input) {
  const L = ARTICLE_LIMITS;
  const errors = {};
  const v = {};
  v.title = str(input.title).replace(/\s+/g, ' ');
  if (v.title.length < L.title.min) errors.title = `Tajuk sekurang-kurangnya ${L.title.min} aksara.`;
  else if (v.title.length > L.title.max) errors.title = `Tajuk maksimum ${L.title.max} aksara.`;

  v.slug = str(input.slug) ? slugify(input.slug) : slugify(v.title);
  if (v.slug.length < L.slug.min) errors.slug = 'Slug terlalu pendek (minimum 3 aksara).';
  else if (RESERVED_ARTICLE_SLUGS.has(v.slug)) errors.slug = 'Slug ini dikhaskan. Pilih slug lain.';

  v.seoTitle = str(input.seoTitle).replace(/\s+/g, ' ');
  if (v.seoTitle.length > L.seoTitle.max) errors.seoTitle = `Tajuk SEO maksimum ${L.seoTitle.max} aksara.`;
  v.description = str(input.description).replace(/\s+/g, ' ');
  if (v.description.length > L.description.max) errors.description = `Meta description maksimum ${L.description.max} aksara.`;
  v.focusKeyword = str(input.focusKeyword).replace(/\s+/g, ' ');
  if (v.focusKeyword.length > L.focusKeyword.max) errors.focusKeyword = `Kata kunci maksimum ${L.focusKeyword.max} aksara.`;
  v.coverAlt = str(input.coverAlt).replace(/\s+/g, ' ');
  if (v.coverAlt.length > L.coverAlt.max) errors.coverAlt = `Teks alt maksimum ${L.coverAlt.max} aksara.`;
  v.author = str(input.author).replace(/\s+/g, ' ') || 'Kedai AnnurPro';
  if (v.author.length > L.author.max) errors.author = `Nama penulis maksimum ${L.author.max} aksara.`;

  v.body = typeof input.body === 'string' ? input.body.replace(/\r\n?/g, '\n') : '';
  if (v.body.length > L.body.max) errors.body = 'Kandungan terlalu panjang.';

  v.coverKey = str(input.coverKey) || null;
  if (v.coverKey && !isArticleImageKey(v.coverKey)) errors.coverKey = 'Gambar utama tidak sah.';

  v.status = input.status === 'published' ? 'published' : 'draft';
  if (v.status === 'published') {
    if (!v.description) errors.description ||= 'Meta description wajib sebelum diterbitkan.';
    if (!v.body.trim()) errors.body ||= 'Kandungan kosong. Tulis artikel dahulu.';
  }
  v.noindex = input.noindex === true;
  v.featured = input.featured === true;
  return Object.keys(errors).length ? { errors } : { value: v };
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const ARTICLE_IMAGE_RE = new RegExp(`articles/${UUID}\\.(?:webp|jpg)`, 'g');
export const isArticleImageKey = (k) => new RegExp(`^articles/${UUID}\\.(?:webp|jpg)$`).test(String(k || ''));

const has = (hay, needle) => Boolean(needle) && hay.toLowerCase().includes(needle.toLowerCase());

/**
 * Semakan SEO ringkas untuk editor (bukan peraturan keras). Pulangkan [{ ok, label, tip }].
 * @param a  artikel (title, slug, seoTitle, description, focusKeyword, coverKey, coverAlt, body)
 */
export function seoChecks(a, rendered = renderMarkdown(a.body || '')) {
  const L = ARTICLE_LIMITS;
  const title = str(a.seoTitle) || str(a.title);
  const desc = str(a.description);
  const kw = str(a.focusKeyword);
  const internal = rendered.links.filter((l) => l.startsWith('/') || l.startsWith(SITE_ORIGIN));
  const h2 = rendered.headings.filter((x) => x.level === 2);
  const checks = [
    { ok: title.length >= L.seoTitle.ideal[0] && title.length <= L.seoTitle.ideal[1], label: `Tajuk SEO ${title.length} aksara`, tip: 'Sasarkan 30 hingga 60 aksara supaya tak dipotong di Google.' },
    { ok: desc.length >= L.description.ideal[0] && desc.length <= L.description.ideal[1], label: `Meta description ${desc.length} aksara`, tip: 'Sasarkan 70 hingga 160 aksara. Terangkan apa pembaca dapat.' },
    { ok: rendered.words >= 300, label: `${rendered.words} patah perkataan`, tip: 'Artikel 300 patah perkataan ke atas lebih mudah disenaraikan.' },
    { ok: h2.length >= 2, label: `${h2.length} subtajuk (##)`, tip: 'Pecahkan artikel dengan sekurang-kurangnya 2 subtajuk.' },
    { ok: Boolean(a.coverKey), label: 'Gambar utama', tip: 'Gambar utama dipaparkan bila link dikongsi di WhatsApp dan Facebook.' },
    { ok: !a.coverKey || Boolean(str(a.coverAlt)), label: 'Teks alt gambar utama', tip: 'Terangkan gambar dalam beberapa perkataan.' },
    { ok: rendered.images.every((i) => str(i.alt)), label: 'Teks alt semua gambar dalam artikel', tip: 'Isi teks dalam ![...] untuk setiap gambar.' },
    { ok: internal.length >= 1, label: `${internal.length} pautan dalaman`, tip: 'Pautkan ke artikel lain atau halaman /app/ supaya pembaca terus ke langkah seterusnya.' },
  ];
  if (kw) {
    checks.push(
      { ok: has(title, kw), label: 'Kata kunci dalam tajuk', tip: `Masukkan "${kw}" dalam tajuk.` },
      { ok: has(desc, kw), label: 'Kata kunci dalam meta description', tip: `Sebut "${kw}" dalam meta description.` },
      { ok: has(str(a.slug).replace(/-/g, ' '), kw), label: 'Kata kunci dalam slug', tip: 'Slug yang mengandungi kata kunci lebih jelas.' },
      { ok: has(rendered.firstParagraph, kw), label: 'Kata kunci dalam perenggan pertama', tip: 'Sebut kata kunci awal dalam artikel.' },
      { ok: h2.some((x) => has(x.text, kw)), label: 'Kata kunci dalam subtajuk', tip: 'Gunakan kata kunci dalam sekurang-kurangnya satu subtajuk.' },
    );
  } else {
    checks.push({ ok: false, label: 'Kata kunci fokus belum diisi', tip: 'Pilih satu frasa yang orang taip di Google, contoh "katalog online".' });
  }
  return checks;
}
