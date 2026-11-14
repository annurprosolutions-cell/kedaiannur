// Skrin phone yang dilukis di canvas 2D (360 x 770 logik) meniru UI Kedai AnnurPro. Semuanya fungsi tulen bagi masa t (saat),
// jadi video boleh dirakam frame demi frame dengan hasil yang sama setiap kali.

export const LW = 360;
export const LH = 770;

export const C = {
  primary: '#0f766e', dark: '#115e59', bg: '#f8fafc', text: '#0f172a', muted: '#475569', border: '#e2e8f0',
  amber: '#fbbf24', wa: '#25d366', waDark: '#075e54', danger: '#dc2626',
};

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const easeOut = (k) => 1 - (1 - clamp(k)) ** 3;
export const easeInOut = (k) => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
export const easeBack = (k) => { k = clamp(k); const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2; };
const seg = (t, a, b) => clamp((t - a) / (b - a));

const FONT = 'Inter, system-ui, sans-serif';
const font = (c, size, weight = 500) => { c.font = `${weight} ${size}px ${FONT}`; };

function rr(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function fillRR(c, x, y, w, h, r, fill, stroke, lw = 1) {
  rr(c, x, y, w, h, r);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
}
function text(c, s, x, y, { size = 14, weight = 500, color = C.text, align = 'left', base = 'alphabetic' } = {}) {
  font(c, size, weight);
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = base;
  c.fillText(s, x, y);
}
function wrap(c, s, maxW) {
  const out = [];
  for (const para of String(s).split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const next = line ? `${line} ${w}` : w;
      if (c.measureText(next).width > maxW && line) { out.push(line); line = w; } else line = next;
    }
    out.push(line);
  }
  return out;
}
const typed = (s, t, t0, cps = 13) => s.slice(0, Math.floor(clamp((t - t0) * cps, 0, s.length)));
const caret = (t) => (Math.floor(t * 2.4) % 2 === 0 ? '|' : '');

// Sentuhan jari: bulatan gelap dengan cincin putih dan riak.
function touch(c, x, y, t, t0) {
  const d = t - t0;
  if (d < -0.18 || d > 0.55) return;
  const press = d < 0 ? easeOut((d + 0.18) / 0.18) : 1 - easeOut(d / 0.2);
  c.save();
  c.globalAlpha = 0.9 * clamp(press + (d >= 0 && d < 0.2 ? 0 : 0));
  c.fillStyle = 'rgba(15,23,42,0.35)';
  c.beginPath(); c.arc(x, y, 17, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.stroke();
  c.restore();
  if (d >= 0) {
    const k = clamp(d / 0.5);
    c.save();
    c.globalAlpha = 0.45 * (1 - k);
    c.strokeStyle = '#fff'; c.lineWidth = 3;
    c.beginPath(); c.arc(x, y, 17 + k * 34, 0, Math.PI * 2); c.stroke();
    c.restore();
  }
}

function statusBar(c, light = false, time = '9:41') {
  const col = light ? '#fff' : C.text;
  text(c, time, 28, 24, { size: 13, weight: 700, color: col });
  c.fillStyle = col;
  for (let i = 0; i < 4; i++) c.fillRect(278 + i * 5, 24 - (i + 1) * 3 - 2, 3, (i + 1) * 3 + 2);
  fillRR(c, 308, 14, 24, 11, 3, null, col, 1.2);
  fillRR(c, 310, 16, 17, 7, 1.5, col);
}

// ------------------------------------------------------------------ gambar produk (vektor)

export const PRODUK = {
  classic: { name: 'Classic Beef Burger', price: 1200, bg: '#1c1917' },
  crispy: { name: 'Crispy Chicken Burger', price: 1500, bg: '#1c1917' },
  bbq: { name: 'BBQ Beef Burger', price: 1350, bg: '#1c1917' },
  spicy: { name: 'Spicy Chicken Burger', price: 1800, bg: '#1c1917' },
  sirap: { name: 'Air sirap selasih', price: 400, bg: '#fce7f3' },
};
// Gambar sebenar kedai (promo/assets/burger/*.jpg, tidak dalam git). Jika tiada, ilustrasi vektor digunakan.
const PHOTOS = {};
export function setPhotos(map) { Object.assign(PHOTOS, map); }
function cover(c, img, x, y, w, h) {
  const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = w / k; const ih = h / k;
  c.drawImage(img, (img.naturalWidth - iw) / 2, (img.naturalHeight - ih) / 2, iw, ih, x, y, w, h);
}
const photo = (k) => (PHOTOS[k] && PHOTOS[k].complete && PHOTOS[k].naturalWidth ? PHOTOS[k] : null);
const rm = (sen) => `RM${(sen / 100).toFixed(2)}`;

export function illus(c, key, x, y, w, h) {
  const p = PRODUK[key];
  const img = photo(key);
  if (img) { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); cover(c, img, x, y, w, h); c.restore(); return; }
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = p.bg; c.fillRect(x, y, w, h);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const s = Math.min(w, h) / 120;
  c.translate(cx, cy); c.scale(s, s);
  c.fillStyle = 'rgba(15,23,42,0.08)'; c.beginPath(); c.ellipse(0, 40, 38, 7, 0, 0, Math.PI * 2); c.fill();
  if (key === 'classic' || key === 'crispy' || key === 'bbq' || key === 'spicy') {
    const patty = { classic: '#5b2a0c', crispy: '#d97706', bbq: '#3b1d0b', spicy: '#b91c1c' }[key];
    fillRR(c, -36, 16, 72, 14, 7, '#f59e0b'); fillRR(c, -36, 6, 72, 12, 4, patty); fillRR(c, -38, -2, 76, 8, 4, '#84cc16');
    fillRR(c, -36, -24, 72, 26, 13, '#f59e0b');
  } else if (key === 'lapis') {
    const cols = ['#fb7185', '#fde68a', '#86efac', '#93c5fd', '#fb7185', '#fde68a'];
    for (let i = 0; i < 6; i++) { fillRR(c, -34, 30 - (i + 1) * 9, 68, 9.5, 2, cols[i]); }
    c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1.4; c.strokeRect(-34, -24, 68, 54);
  } else if (key === 'karipap') {
    c.fillStyle = '#d97706'; c.beginPath(); c.ellipse(0, 6, 42, 28, -0.25, 0, Math.PI); c.fill();
    c.fillStyle = '#f59e0b'; c.beginPath(); c.ellipse(0, 4, 42, 28, -0.25, Math.PI, Math.PI * 2); c.fill();
    c.strokeStyle = '#b45309'; c.lineWidth = 2;
    for (let i = -3; i <= 3; i++) { c.beginPath(); c.arc(i * 10 - 2, 5 - Math.abs(i) * 1.5, 5, Math.PI, 0); c.stroke(); }
  } else if (key === 'serimuka') {
    fillRR(c, -34, 0, 68, 30, 6, '#fff'); fillRR(c, -34, -26, 68, 30, 6, '#22c55e');
    c.fillStyle = '#16a34a'; c.fillRect(-34, -4, 68, 5);
  } else if (key === 'kek') {
    fillRR(c, -38, 8, 76, 24, 4, '#78350f'); fillRR(c, -38, -6, 76, 12, 3, '#fde8d0'); fillRR(c, -38, -22, 76, 18, 6, '#5b2a0c');
    c.fillStyle = '#d4a373'; c.beginPath(); c.arc(-14, -24, 6, 0, 7); c.fill(); c.beginPath(); c.arc(14, -24, 6, 0, 7); c.fill();
  } else if (key === 'teh') {
    c.fillStyle = '#fef3c7'; c.beginPath(); c.moveTo(-26, -30); c.lineTo(26, -30); c.lineTo(20, 34); c.lineTo(-20, 34); c.closePath(); c.fill();
    c.fillStyle = '#b4691f'; c.beginPath(); c.moveTo(-24, -10); c.lineTo(24, -10); c.lineTo(20, 34); c.lineTo(-20, 34); c.closePath(); c.fill();
    c.fillStyle = '#fff7e6'; c.beginPath(); c.ellipse(0, -10, 24, 6, 0, 0, 7); c.fill();
    c.strokeStyle = '#b4691f'; c.lineWidth = 5; c.beginPath(); c.arc(30, 6, 12, -1.2, 1.2); c.stroke();
  } else if (key === 'sirap') {
    fillRR(c, -20, -34, 40, 14, 4, '#e5e7eb'); fillRR(c, -28, -22, 56, 58, 12, '#f472b6');
    c.fillStyle = '#7c2d12';
    for (let i = 0; i < 18; i++) { c.beginPath(); c.arc(-20 + (i * 17) % 40, -8 + ((i * 11) % 38), 2, 0, 7); c.fill(); }
  }
  c.restore();
}

// ------------------------------------------------------------------ komponen

function ellip(c, str, maxW, size, weight = 700) {
  font(c, size, weight);
  if (c.measureText(str).width <= maxW) return str;
  let t = str;
  while (t.length > 1 && c.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function button(c, x, y, w, h, label, { bg = C.primary, color = '#fff', t = 0, tapAt = null } = {}) {
  const press = tapAt === null ? 0 : (() => { const d = t - tapAt; return d > 0 && d < 0.25 ? Math.sin((d / 0.25) * Math.PI) : 0; })();
  const sc = 1 - press * 0.04;
  c.save();
  c.translate(x + w / 2, y + h / 2); c.scale(sc, sc); c.translate(-(x + w / 2), -(y + h / 2));
  fillRR(c, x, y, w, h, h / 2.6, bg);
  text(c, label, x + w / 2, y + h / 2 + 5, { size: 15, weight: 700, color, align: 'center' });
  c.restore();
}

function field(c, x, y, w, label, value, { focus = false, t = 0, ok = false } = {}) {
  text(c, label, x, y, { size: 12, weight: 600, color: C.muted });
  fillRR(c, x, y + 8, w, 46, 12, '#fff', focus ? C.primary : C.border, focus ? 2 : 1);
  text(c, value + (focus ? caret(t) : ''), x + 14, y + 37, { size: 15, weight: 500, color: C.text });
  if (ok) { c.strokeStyle = '#16a34a'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(x + w - 32, y + 31); c.lineTo(x + w - 26, y + 37); c.lineTo(x + w - 16, y + 25); c.stroke(); }
}

function appHeader(c, title, back = false) {
  c.fillStyle = C.bg; c.fillRect(0, 0, LW, LH);
  statusBar(c);
  if (back) { c.strokeStyle = C.text; c.lineWidth = 2.4; c.beginPath(); c.moveTo(30, 62); c.lineTo(22, 70); c.lineTo(30, 78); c.stroke(); }
  text(c, title, back ? 44 : 20, 76, { size: 22, weight: 800 });
}

const MARK = { img: null };
export function setMark(img) { MARK.img = img; }
function logoMark(c, x, y, s) {
  if (MARK.img && MARK.img.complete && MARK.img.naturalWidth) { c.drawImage(MARK.img, x, y, s, s); return; }
  fillRR(c, x, y, s, s, s * 0.25, C.primary);
}

// ------------------------------------------------------------------ skrin peniaga (telefon M)

function splash(c, t) {
  const g = c.createLinearGradient(0, 0, 0, LH);
  g.addColorStop(0, '#0b1224'); g.addColorStop(1, '#0f3b3a');
  c.fillStyle = g; c.fillRect(0, 0, LW, LH);
  statusBar(c, true);
  const k = easeBack(seg(t, 5.3, 6.2));
  c.save(); c.translate(LW / 2, 250); c.scale(k, k);
  logoMark(c, -48, -48, 96);
  c.restore();
  c.globalAlpha = easeOut(seg(t, 6.0, 6.8));
  text(c, 'Kedai AnnurPro', LW / 2, 350, { size: 28, weight: 800, color: '#fff', align: 'center' });
  font(c, 15, 500);
  c.fillStyle = '#cbd5e1'; c.textAlign = 'center';
  wrap(c, 'Katalog online untuk peniaga. Order terus ke WhatsApp.', 280).forEach((ln, i) => c.fillText(ln, LW / 2, 384 + i * 22));
  c.globalAlpha = easeOut(seg(t, 7.2, 8.0));
  button(c, 50, 600, 260, 52, 'Buka kedai percuma', { bg: C.amber, color: '#0f172a' });
  c.globalAlpha = 1;
}

function login(c, t) {
  c.fillStyle = C.bg; c.fillRect(0, 0, LW, LH);
  statusBar(c);
  logoMark(c, 148, 150, 64);
  text(c, 'Log masuk', LW / 2, 270, { size: 28, weight: 800, align: 'center' });
  text(c, 'Guna akaun Google anda. Tiada kata laluan', LW / 2, 298, { size: 14, color: C.muted, align: 'center' });
  const press = (() => { const d = t - 12.2; return d > 0 && d < 0.25 ? Math.sin((d / 0.25) * Math.PI) : 0; })();
  c.save(); c.translate(LW / 2, 380); c.scale(1 - press * 0.04, 1 - press * 0.04);
  fillRR(c, -140, -26, 280, 52, 26, '#fff', C.border, 1.5);
  c.fillStyle = '#4285f4'; c.beginPath(); c.arc(-104, 0, 11, 0, 7); c.fill();
  text(c, 'G', -104, 5.5, { size: 15, weight: 800, color: '#fff', align: 'center' });
  text(c, 'Teruskan dengan Google', 12, 5.5, { size: 15, weight: 600, align: 'center' });
  c.restore();
  touch(c, 200, 392, t, 12.2);
}

function setup(c, t) {
  appHeader(c, 'Buat kedai anda');
  const nama = typed('Kedai Contoh', t, 13.3, 11);
  const wa = typed('012-345 6789', t, 14.7, 11);
  const slug = typed('contoh', t, 16.0, 9);
  field(c, 20, 118, 320, 'Nama kedai', nama, { focus: t < 14.7, t });
  field(c, 20, 196, 320, 'Nombor WhatsApp untuk terima order', wa, { focus: t >= 14.7 && t < 16, t });
  field(c, 20, 274, 320, 'Alamat kedai', slug ? `kedai.annurpro.com/${slug}` : '', { focus: t >= 16, t, ok: slug === 'contoh' });
  if (slug === 'contoh') text(c, 'Boleh digunakan', 34, 354, { size: 12, weight: 600, color: '#16a34a' });
  fillRR(c, 20, 390, 320, 64, 14, '#ecfdf5', '#a7f3d0');
  text(c, 'Order pelanggan dihantar ke nombor ini', 34, 418, { size: 13, weight: 700, color: C.dark });
  text(c, 'dalam satu mesej yang tersusun.', 34, 438, { size: 13, color: C.dark });
  button(c, 20, 560, 320, 54, 'Buat kedai', { t, tapAt: 17.0 });
  touch(c, 180, 588, t, 17.0);
}

function siap(c, t) {
  appHeader(c, 'Kedai Contoh');
  const k = easeBack(seg(t, 17.5, 18.2));
  c.save(); c.translate(LW / 2, 190); c.scale(k, k);
  c.fillStyle = '#16a34a'; c.beginPath(); c.arc(0, 0, 40, 0, 7); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 7; c.lineCap = 'round'; c.beginPath(); c.moveTo(-17, 2); c.lineTo(-5, 14); c.lineTo(18, -12); c.stroke();
  c.restore();
  text(c, 'Kedai anda dah hidup', LW / 2, 280, { size: 24, weight: 800, align: 'center' });
  const l = easeOut(seg(t, 18.2, 18.8));
  c.globalAlpha = l;
  fillRR(c, 30, 306, 300, 50, 25, '#fff', C.border, 1.5);
  text(c, 'kedai.annurpro.com/contoh', LW / 2, 337, { size: 15, weight: 700, color: C.primary, align: 'center' });
  button(c, 30, 376, 144, 46, 'Salin link', { bg: '#fff', color: C.text });
  fillRR(c, 30, 376, 144, 46, 17, null, C.border, 1.5);
  button(c, 186, 376, 144, 46, 'Kongsi', { bg: C.wa });
  c.globalAlpha = easeOut(seg(t, 19.0, 19.5));
  fillRR(c, 20, 450, 320, 130, 16, '#fff', C.border);
  text(c, 'Langkah seterusnya', 36, 480, { size: 14, weight: 800 });
  const items = [['Maklumat kedai', true], ['Tambah produk pertama', false], ['Kongsi link kedai', false]];
  items.forEach(([s, done], i) => {
    const y = 510 + i * 26;
    c.strokeStyle = done ? '#16a34a' : '#94a3b8'; c.lineWidth = 2; c.beginPath(); c.arc(44, y - 5, 8, 0, 7); c.stroke();
    if (done) { c.fillStyle = '#16a34a'; c.fill(); }
    text(c, s, 62, y, { size: 14, weight: done ? 500 : 700, color: done ? C.muted : C.text });
  });
  c.globalAlpha = 1;
}

function produkBaru(c, t) {
  appHeader(c, 'Produk baru', true);
  // gambar
  fillRR(c, 20, 100, 320, 190, 16, '#f1f5f9', C.border);
  const k = easeBack(seg(t, 20.5, 21.1));
  if (t < 20.5) {
    text(c, 'Tambah gambar', LW / 2, 200, { size: 15, weight: 700, color: C.muted, align: 'center' });
  } else {
    c.save(); c.translate(180, 195); c.scale(k, k); c.translate(-180, -195);
    c.save(); rr(c, 20, 100, 320, 190, 16); c.clip(); illus(c, 'classic', 20, 100, 320, 190); c.restore();
    c.strokeStyle = '#fff'; c.lineWidth = 2;
    rr(c, 60, 115, 240, 160, 8); c.stroke();
    c.restore();
  }
  field(c, 20, 318, 320, 'Nama produk', typed('Classic Beef Burger', t, 21.2, 18), { focus: t < 22.3 && t > 21.1, t });
  field(c, 20, 396, 320, 'Harga', typed('RM12.00', t, 22.3, 12), { focus: t >= 22.3 && t < 23.0, t });
  text(c, 'Kategori', 20, 484, { size: 12, weight: 600, color: C.muted });
  const sel = t >= 23.1;
  fillRR(c, 20, 494, 90, 38, 19, sel ? C.primary : '#fff', sel ? C.primary : C.border);
  text(c, 'Burger', 65, 518, { size: 13, weight: 700, color: sel ? '#fff' : C.text, align: 'center' });
  fillRR(c, 120, 494, 96, 38, 19, '#fff', C.border);
  text(c, 'Minuman', 168, 518, { size: 13, weight: 700, align: 'center' });
  button(c, 20, 560, 320, 54, 'Simpan produk', { t, tapAt: 23.6 });
  touch(c, 180, 588, t, 23.6);
}

function produkSenarai(c, t) {
  appHeader(c, 'Produk');
  const items = ['classic', 'crispy', 'bbq', 'spicy', 'sirap'];
  const n = items.filter((_, i) => t >= 24.2 + i * 0.4).length;
  text(c, `${n} produk`, 20, 100, { size: 14, weight: 600, color: C.muted });
  items.forEach((key, i) => {
    const t0 = 24.2 + i * 0.4;
    const k = easeBack(seg(t, t0, t0 + 0.35));
    if (k <= 0) return;
    const x = 20 + (i % 2) * 166;
    const y = 116 + Math.floor(i / 2) * 200;
    c.save(); c.translate(x + 77, y + 90); c.scale(k, k); c.translate(-(x + 77), -(y + 90));
    fillRR(c, x, y, 154, 184, 16, '#fff', C.border);
    c.save(); rr(c, x, y, 154, 108, 16); c.clip(); illus(c, key, x, y, 154, 108); c.restore();
    text(c, ellip(c, PRODUK[key].name, 130, 13), x + 12, y + 134, { size: 13, weight: 700 });
    text(c, rm(PRODUK[key].price), x + 12, y + 156, { size: 14, weight: 800, color: C.primary });
    fillRR(c, x + 100, y + 160, 42, 16, 8, '#dcfce7');
    text(c, 'Ada', x + 121, y + 172, { size: 10, weight: 700, color: '#166534', align: 'center' });
    c.restore();
  });
}

function qrPage(c, t, qr) {
  appHeader(c, 'Kod QR kedai', true);
  fillRR(c, 40, 100, 280, 300, 20, '#fff', C.border);
  const size = 220;
  const x0 = 70;
  const y0 = 118;
  c.fillStyle = '#fff'; c.fillRect(x0, y0, size, size);
  if (qr) {
    const reveal = easeOut(seg(t, 28.4, 30.2));
    const q = 3;
    const cell = size / (qr.n + q * 2);
    c.fillStyle = '#0f172a';
    for (let r = 0; r < qr.n; r++) {
      if (r / qr.n > reveal) break;
      for (let cc = 0; cc < qr.n; cc++) if (qr.dark(r, cc)) c.fillRect(x0 + (cc + q) * cell, y0 + (r + q) * cell, cell + 0.4, cell + 0.4);
    }
    if (reveal < 1) { c.fillStyle = 'rgba(15,118,110,0.55)'; c.fillRect(x0, y0 + reveal * size - 2, size, 4); }
  }
  text(c, 'kedai.annurpro.com/contoh', LW / 2, 388, { size: 14, weight: 800, color: C.primary, align: 'center' });
  button(c, 40, 424, 280, 48, 'Muat turun poster A5', { bg: C.primary });
  text(c, 'Kongsi di mana-mana', 20, 512, { size: 14, weight: 800 });
  [['Status WhatsApp', C.wa, 30.6], ['Bio TikTok', '#0f172a', 31.0], ['Poster kaunter', C.amber, 31.4]].forEach(([s, col, t0], i) => {
    const k = easeBack(seg(t, t0, t0 + 0.3));
    if (k <= 0) return;
    const w = 150;
    const x = 20 + (i % 2) * 160;
    const y = 530 + Math.floor(i / 2) * 56;
    c.save(); c.translate(x + w / 2, y + 22); c.scale(k, k); c.translate(-(x + w / 2), -(y + 22));
    fillRR(c, x, y, w, 44, 22, '#fff', C.border, 1.5);
    c.fillStyle = col; c.beginPath(); c.arc(x + 24, y + 22, 9, 0, 7); c.fill();
    text(c, s, x + 42, y + 27, { size: 13, weight: 700 });
    c.restore();
  });
}

function dashboard(c, t) {
  appHeader(c, 'Kedai Contoh');
  const views = t < 36.0 ? 0 : t < 38.6 ? 1 : 3;
  const tile = (x, y, label, val, col) => {
    fillRR(c, x, y, 154, 92, 16, '#fff', C.border);
    text(c, String(val), x + 16, y + 52, { size: 34, weight: 800, color: col });
    text(c, label, x + 16, y + 76, { size: 12, weight: 600, color: C.muted });
  };
  tile(20, 100, 'Lawatan hari ini', views, C.primary);
  tile(186, 100, 'Order WhatsApp', 0, '#16a34a');
  fillRR(c, 20, 208, 320, 210, 16, '#fff', C.border);
  text(c, 'Lawatan 7 hari', 36, 238, { size: 14, weight: 800 });
  const bars = [3, 5, 4, 8, 6, 9, views + 2];
  bars.forEach((v, i) => {
    const h = v * 12;
    fillRR(c, 40 + i * 42, 390 - h, 26, h, 6, i === 6 ? C.amber : C.primary);
  });
  fillRR(c, 20, 436, 320, 78, 16, '#ecfdf5', '#a7f3d0');
  text(c, 'Order masuk terus ke WhatsApp anda', 36, 466, { size: 14, weight: 800, color: C.dark });
  text(c, 'Tiada perlu semak aplikasi lain.', 36, 490, { size: 13, color: C.dark });
}

function lock(c, t) {
  const g = c.createLinearGradient(0, 0, LW, LH);
  g.addColorStop(0, '#1e1b4b'); g.addColorStop(0.55, '#0f3b3a'); g.addColorStop(1, '#0b1224');
  c.fillStyle = g; c.fillRect(0, 0, LW, LH);
  statusBar(c, true);
  text(c, '9:41', LW / 2, 190, { size: 84, weight: 700, color: '#fff', align: 'center' });
  text(c, 'Hari ini', LW / 2, 224, { size: 17, weight: 600, color: 'rgba(255,255,255,0.75)', align: 'center' });
  const d = t - 47.5;
  if (d > 0) {
    const k = easeBack(d / 0.5);
    const y = lerp(-90, 280, easeOut(d / 0.45));
    c.save(); c.translate(LW / 2, y + 62); c.scale(clamp(k, 0, 1.04), clamp(k, 0, 1.04)); c.translate(-LW / 2, -(y + 62));
    fillRR(c, 14, y, 332, 126, 22, 'rgba(248,250,252,0.94)');
    fillRR(c, 28, y + 14, 30, 30, 8, C.wa);
    c.strokeStyle = '#fff'; c.lineWidth = 2.6; c.beginPath(); c.arc(43, y + 29, 8.5, 0.6, 5.8); c.stroke();
    text(c, 'WHATSAPP', 68, y + 33, { size: 12, weight: 700, color: C.muted });
    text(c, 'sekarang', 330, y + 33, { size: 12, color: C.muted, align: 'right' });
    text(c, 'Aina', 28, y + 66, { size: 16, weight: 800 });
    font(c, 14, 500);
    wrap(c, 'Hai Kedai Contoh, saya nak order: 1. Classic Beef Burger x2 = RM24.00 2. Spicy Chicken Burger x1 = RM18.00', 296).slice(0, 2).forEach((ln, i) => text(c, ln, 28, y + 88 + i * 19, { size: 14, color: C.text }));
    c.restore();
    touch(c, 190, y + 70, t, 50.1);
  }
}

const ORDER = [
  'Hai Kedai Contoh, saya nak order:',
  '',
  '1. Classic Beef Burger x2 = RM24.00',
  '2. Spicy Chicken Burger x1 = RM18.00',
  '3. Air sirap selasih x2 = RM8.00',
  '',
  'Jumlah: RM50.00',
  '',
  'Nama: Aina',
];

function chat(c, t) {
  c.fillStyle = '#efeae2'; c.fillRect(0, 0, LW, LH);
  c.fillStyle = 'rgba(15,23,42,0.035)';
  for (let y = 120; y < LH; y += 26) for (let x = (y / 26) % 2 ? 6 : 19; x < LW; x += 26) { c.beginPath(); c.arc(x, y, 1.6, 0, 7); c.fill(); }
  c.fillStyle = C.waDark; c.fillRect(0, 0, LW, 104);
  statusBar(c, true);
  c.strokeStyle = '#fff'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(30, 62); c.lineTo(22, 70); c.lineTo(30, 78); c.stroke();
  c.fillStyle = '#94a3b8'; c.beginPath(); c.arc(60, 70, 17, 0, 7); c.fill();
  text(c, 'A', 60, 76, { size: 17, weight: 800, color: '#fff', align: 'center' });
  text(c, 'Aina', 88, 68, { size: 17, weight: 700, color: '#fff' });
  text(c, 'dalam talian', 88, 86, { size: 12, color: 'rgba(255,255,255,0.8)' });

  // gelembung masuk
  const k = easeBack(seg(t, 50.3, 50.9));
  if (k > 0) {
    const lines = ORDER;
    const bw = 292;
    const bh = 24 + lines.length * 19 + 22;
    const bx = 14;
    const by = 150;
    c.save(); c.translate(bx, by + bh); c.scale(k, k); c.translate(-bx, -(by + bh));
    c.shadowColor = 'rgba(15,23,42,0.18)'; c.shadowBlur = 4; c.shadowOffsetY = 1;
    fillRR(c, bx, by, bw, bh, 12, '#fff');
    c.shadowColor = 'transparent';
    const hl = easeInOut(seg(t, 52.0, 52.8));
    if (hl > 0) { c.fillStyle = 'rgba(251,191,36,0.55)'; c.fillRect(bx + 12, by + 14 + 6 * 19 + 3, 170 * hl, 20); }
    lines.forEach((ln, i) => text(c, ln, bx + 14, by + 30 + i * 19, { size: 14, weight: ln.startsWith('Jumlah') ? 800 : 500 }));
    text(c, '9:41', bx + bw - 12, by + bh - 8, { size: 11, color: '#94a3b8', align: 'right' });
    c.restore();
  }
  // balasan peniaga
  const r = easeBack(seg(t, 54.0, 54.5));
  if (r > 0) {
    const bw = 232;
    const bh = 54;
    const bx = LW - bw - 14;
    const by = 150 + 24 + ORDER.length * 19 + 22 + 22;
    c.save(); c.translate(bx + bw, by + bh); c.scale(r, r); c.translate(-(bx + bw), -(by + bh));
    fillRR(c, bx, by, bw, bh, 12, '#d9fdd3');
    text(c, 'Terima kasih Aina!', bx + 14, by + 24, { size: 14 });
    text(c, 'Order disahkan.', bx + 14, by + 43, { size: 14 });
    text(c, '9:42 ✓✓', bx + bw - 10, by + bh - 6, { size: 11, color: '#53bdeb', align: 'right' });
    c.restore();
  }
  fillRR(c, 10, 700, 296, 44, 22, '#fff');
  text(c, 'Mesej', 28, 728, { size: 15, color: '#94a3b8' });
  c.fillStyle = C.waDark; c.beginPath(); c.arc(330, 722, 22, 0, 7); c.fill();
  touch(c, 190, 238, t, 50.1 + 100);
}

const MSCENES = [
  [0, 10, splash], [10, 13, login], [13, 17.5, setup], [17.5, 20, siap], [20, 24, produkBaru], [24, 28, produkSenarai],
  [28, 34, qrPage], [34, 44, dashboard], [44, 50.2, lock], [50.2, 99, chat],
];

function slideScenes(c, t, scenes, fn) {
  let i = scenes.findIndex(([a, b]) => t >= a && t < b);
  if (i < 0) i = scenes.length - 1;
  const [a] = scenes[i];
  const dur = 0.4;
  if (i > 0 && t - a < dur) {
    const k = easeInOut((t - a) / dur);
    c.save(); c.translate(-LW * k * 0.35, 0); fn(scenes[i - 1], a - 0.001); c.restore();
    c.save(); c.translate(LW * (1 - k), 0); c.shadowColor = 'rgba(0,0,0,0.25)'; c.shadowBlur = 24; fn(scenes[i], t); c.restore();
  } else fn(scenes[i], t);
}

export function screenMerchant(c, t, qr) {
  c.save();
  c.beginPath(); c.rect(0, 0, LW, LH); c.clip();
  slideScenes(c, t, MSCENES, ([, , f], tt) => { c.save(); c.beginPath(); c.rect(0, 0, LW, LH); c.clip(); f(c, tt, qr); c.restore(); });
  c.restore();
}

// ------------------------------------------------------------------ skrin pelanggan (telefon C)

const GRID = ['classic', 'crispy', 'bbq', 'spicy', 'sirap'];
const TAPS = [ // [masa, produk]
  [37.0, 'classic'], [37.6, 'classic'], [38.4, 'spicy'], [39.9, 'sirap'], [40.4, 'sirap'],
];
function cartState(t) {
  const q = { classic: 0, spicy: 0, sirap: 0 };
  for (const [tt, k] of TAPS) if (t >= tt) q[k]++;
  const items = q.classic + q.spicy + q.sirap;
  const total = q.classic * PRODUK.classic.price + q.spicy * PRODUK.spicy.price + q.sirap * PRODUK.sirap.price;
  return { q, items, total };
}

const GRID_TOP = 384;
const ROW = 214;
const scrollAt = (t) => easeInOut(seg(t, 35.6, 36.4)) * 190 + easeInOut(seg(t, 38.9, 39.5)) * 214;

function shopPage(c, t) {
  c.fillStyle = C.bg; c.fillRect(0, 0, LW, LH);
  const scroll = scrollAt(t);
  c.save(); c.translate(0, -scroll);
  // sepanduk (gambar sebenar kedai) dan logo
  const bn = photo('banner');
  if (bn) { c.save(); c.beginPath(); c.rect(0, 0, LW, 168); c.clip(); cover(c, bn, 0, 0, LW, 168); c.restore(); } else {
    const g = c.createLinearGradient(0, 0, LW, 150); g.addColorStop(0, '#0f766e'); g.addColorStop(1, '#0b3b4a');
    c.fillStyle = g; c.fillRect(0, 0, LW, 168);
  }
  c.save(); c.beginPath(); c.arc(52, 172, 31, 0, 7); c.fillStyle = '#fff'; c.fill(); c.clip();
  const lg = photo('logo');
  if (lg) cover(c, lg, 22, 142, 60, 60);
  c.restore();
  text(c, 'Kedai Contoh', 96, 196, { size: 23, weight: 800 });
  font(c, 13, 500);
  wrap(c, 'Ini kedai contoh. Cuba tambah produk ke troli dan tekan Hantar ke WhatsApp untuk lihat bagaimana order sampai kepada peniaga.', 320)
    .forEach((ln, i) => text(c, ln, 20, 232 + i * 18, { size: 13, color: C.muted }));
  fillRR(c, 20, 282, 320, 44, 22, '#fff', C.border, 1.5);
  text(c, 'Cari produk', 40, 310, { size: 15, color: '#94a3b8' });
  ['Semua', 'Burger', 'Minuman'].forEach((label, i) => {
    const xs = [20, 96, 168];
    const ws = [68, 62, 76];
    fillRR(c, xs[i], 336, ws[i], 34, 17, i === 0 ? C.primary : '#fff', i === 0 ? C.primary : C.border, 1.2);
    text(c, label, xs[i] + ws[i] / 2, 358, { size: 13, weight: 700, color: i === 0 ? '#fff' : C.text, align: 'center' });
  });
  const cs = cartState(t);
  GRID.forEach((key, i) => {
    const x = 20 + (i % 2) * 166;
    const y = GRID_TOP + Math.floor(i / 2) * ROW;
    fillRR(c, x, y, 154, 200, 16, '#fff', C.border);
    c.save(); rr(c, x, y, 154, 118, 16); c.clip(); illus(c, key, x, y, 154, 118); c.restore();
    text(c, ellip(c, PRODUK[key].name, 128, 13), x + 12, y + 144, { size: 13, weight: 700 });
    text(c, rm(PRODUK[key].price), x + 12, y + 168, { size: 14, weight: 800, color: C.primary });
    const bump = (cs.q[key] !== undefined && TAPS.some(([tt, k]) => k === key && t >= tt && t < tt + 0.3)) ? 1.18 : 1;
    c.save(); c.translate(x + 124, y + 164); c.scale(bump, bump);
    c.fillStyle = C.primary; c.beginPath(); c.arc(0, 0, 19, 0, 7); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(-8, 0); c.lineTo(8, 0); c.moveTo(0, -8); c.lineTo(0, 8); c.stroke();
    c.restore();
  });
  text(c, 'Dikuasakan oleh Kedai AnnurPro', LW / 2, GRID_TOP + 3 * ROW + 18, { size: 12, color: C.muted, align: 'center' });
  c.restore();
  statusBarOverlay(c);
  // sentuhan: koordinat skrin selepas skrol
  TAPS.forEach(([tt, key]) => {
    const i = GRID.indexOf(key);
    touch(c, 20 + (i % 2) * 166 + 124, GRID_TOP + Math.floor(i / 2) * ROW + 164 - scrollAt(tt), t, tt);
  });
  // bar troli
  if (cs.items > 0) {
    const k = easeOut(seg(t, 37.05, 37.5));
    c.save(); c.globalAlpha = k;
    const y = LH - 176 + (1 - k) * 30;
    c.shadowColor = 'rgba(15,118,110,0.4)'; c.shadowBlur = 16; c.shadowOffsetY = 4;
    fillRR(c, 20, y, 320, 58, 29, C.primary);
    c.shadowColor = 'transparent';
    fillRR(c, 36, y + 14, 32, 30, 15, 'rgba(255,255,255,0.22)');
    text(c, String(cs.items), 52, y + 35, { size: 15, weight: 800, color: '#fff', align: 'center' });
    text(c, 'Lihat troli', 84, y + 35, { size: 15, weight: 700, color: '#fff' });
    text(c, rm(cs.total), 322, y + 35, { size: 16, weight: 800, color: '#fff', align: 'right' });
    c.restore();
    touch(c, 180, LH - 147, t, 41.2);
  }
}

function statusBarOverlay(c) {
  c.fillStyle = 'rgba(248,250,252,0.0)';
  statusBar(c, true);
}

function sheet(c, t, kind) {
  const open = kind === 'cart' ? easeOut(seg(t, 41.2, 41.7)) : 1;
  c.fillStyle = `rgba(15,23,42,${0.45 * open})`; c.fillRect(0, 0, LW, LH);
  const h = kind === 'cart' ? 470 : 440;
  const y = LH - 70 - h * open + 70 * (1 - open);
  fillRR(c, 0, y, LW, h + 40, 28, '#fff');
  fillRR(c, LW / 2 - 20, y + 10, 40, 4, 2, '#cbd5e1');
  if (kind === 'cart') {
    text(c, 'Troli', 20, y + 56, { size: 24, weight: 800 });
    const rows = [['Classic Beef Burger', 2, 2400], ['Spicy Chicken Burger', 1, 1800], ['Air sirap selasih', 2, 800]];
    rows.forEach(([n, q, p], i) => {
      const yy = y + 100 + i * 88;
      text(c, n, 20, yy, { size: 16, weight: 700 });
      text(c, rm(p), 340, yy, { size: 16, weight: 800, align: 'right' });
      fillRR(c, 20, yy + 14, 44, 40, 12, '#fff', C.border); text(c, '−', 42, yy + 41, { size: 20, weight: 700, align: 'center' });
      text(c, String(q), 82, yy + 41, { size: 17, weight: 800, align: 'center' });
      fillRR(c, 100, yy + 14, 44, 40, 12, '#fff', C.border); text(c, '+', 122, yy + 41, { size: 20, weight: 700, align: 'center' });
      fillRR(c, 156, yy + 14, 184, 40, 20, '#fff', C.border); text(c, 'Tambah nota', 174, yy + 40, { size: 13, color: '#94a3b8' });
    });
    c.fillStyle = C.border; c.fillRect(20, y + 358, 320, 1);
    text(c, 'Jumlah', 20, y + 390, { size: 16 });
    text(c, 'RM50.00', 340, y + 392, { size: 20, weight: 800, align: 'right' });
    button(c, 20, y + 408, 320, 48, 'Teruskan', { t, tapAt: 43.4 });
    touch(c, 180, y + 432, t, 43.4);
  } else {
    text(c, 'Semak dan hantar', 20, y + 56, { size: 22, weight: 800 });
    field(c, 20, y + 84, 320, 'Nama anda', typed('Aina', t, 44.1, 6), { focus: t < 45.2, t });
    fillRR(c, 20, y + 176, 320, 72, 14, '#f1f5f9');
    text(c, '5 item', 36, y + 204, { size: 14, weight: 600, color: C.muted });
    text(c, 'Jumlah RM50.00', 36, y + 232, { size: 18, weight: 800 });
    button(c, 20, y + 270, 320, 54, 'Hantar ke WhatsApp', { bg: C.wa, color: '#0b1f12', t, tapAt: 45.6 });
    text(c, 'Order dihantar dalam satu mesej yang tersusun', LW / 2, y + 350, { size: 12, color: C.muted, align: 'center' });
    touch(c, 180, y + 297, t, 45.6);
  }
}

function sending(c, t) {
  c.fillStyle = 'rgba(15,23,42,0.6)'; c.fillRect(0, 0, LW, LH);
  fillRR(c, 50, 300, 260, 150, 22, '#fff');
  c.strokeStyle = C.wa; c.lineWidth = 5; c.lineCap = 'round';
  c.beginPath(); c.arc(LW / 2, 358, 20, t * 8, t * 8 + 4.2); c.stroke();
  text(c, 'Membuka WhatsApp...', LW / 2, 414, { size: 15, weight: 700, align: 'center' });
}

function done(c, t) {
  c.fillStyle = 'rgba(15,23,42,0.55)'; c.fillRect(0, 0, LW, LH);
  const k = easeBack(seg(t, 47.4, 48.0));
  c.save(); c.translate(LW / 2, 330); c.scale(Math.max(k, 0.001), Math.max(k, 0.001));
  fillRR(c, -140, -130, 280, 270, 24, '#fff');
  c.fillStyle = C.wa; c.beginPath(); c.arc(0, -62, 36, 0, 7); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 6.5; c.lineCap = 'round'; c.beginPath(); c.moveTo(-15, -62); c.lineTo(-4, -50); c.lineTo(16, -76); c.stroke();
  text(c, 'Order dihantar!', 0, 8, { size: 21, weight: 800, align: 'center' });
  text(c, 'Pesanan anda sudah masuk', 0, 36, { size: 13, color: C.muted, align: 'center' });
  text(c, 'WhatsApp kedai.', 0, 54, { size: 13, color: C.muted, align: 'center' });
  fillRR(c, -110, 78, 220, 42, 21, C.primary);
  text(c, 'Pesan lagi', 0, 105, { size: 14, weight: 700, color: '#fff', align: 'center' });
  c.restore();
}

export function screenCustomer(c, t) {
  c.save();
  c.beginPath(); c.rect(0, 0, LW, LH); c.clip();
  shopPage(c, t);
  if (t >= 41.2 && t < 43.6) sheet(c, t, 'cart');
  else if (t >= 43.6) {
    const k = easeInOut(seg(t, 43.6, 44.0));
    c.save(); c.translate(0, 0); c.globalAlpha = 1; sheet(c, t, 'cart'); c.restore();
    c.save(); c.translate(LW * (1 - k), 0); sheet(c, t, 'send'); c.restore();
  }
  if (t >= 45.9 && t < 47.4) sending(c, t);
  else if (t >= 47.4) done(c, t);
  c.restore();
}
