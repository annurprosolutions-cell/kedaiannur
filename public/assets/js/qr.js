// Kod QR kedai (Fasa 10): QR ke link kedai, muat turun PNG, dan poster A5 untuk dicetak dan ditampal di kaunter.
// QR dijana dalam browser (tiada API luar). Library dimuatkan hanya bila skrin ini dibuka.

import { api } from './api.js';
import { getConfig, mediaUrl } from './config.js';
import { h, icon, toast } from './ui.js';

const LIB = '/assets/vendor/qrcode-generator-2.0.4.js';

function qrMatrix(qrcode, text) {
  const q = qrcode(0, 'M'); // versi automatik, pembetulan ralat M (~15%)
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  return { n, dark: (r, c) => q.isDark(r, c) };
}

/** Lukis QR pada kanvas: modul gelap atas latar putih dengan zon senyap 4 modul. */
function drawQr(ctx2d, m, x, y, size, color = '#0f172a') {
  const quiet = 4;
  const cell = size / (m.n + quiet * 2);
  ctx2d.fillStyle = '#ffffff';
  ctx2d.fillRect(x, y, size, size);
  ctx2d.fillStyle = color;
  for (let r = 0; r < m.n; r++) {
    for (let c = 0; c < m.n; c++) {
      if (m.dark(r, c)) ctx2d.fillRect(Math.floor(x + (c + quiet) * cell), Math.floor(y + (r + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
    }
  }
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous'; // perlu CORS pada domain media; jika tiada, poster tanpa logo
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrapText(c, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (c.measureText(next).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

// Poster A5 pada 150 dpi (874 x 1240): nama kedai, logo (jika boleh), QR besar, arahan dan link.
async function drawPoster(m, shop, url, logoSrc) {
  const W = 874;
  const H = 1240;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  const theme = /^#[0-9a-f]{6}$/i.test(shop.themeColor || '') ? shop.themeColor : '#0f766e';
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, W, H);
  x.fillStyle = theme;
  x.fillRect(0, 0, W, 220);
  x.textAlign = 'center';

  const logo = await loadImage(logoSrc);
  let top = 70;
  if (logo) {
    const s = 150;
    x.save();
    x.beginPath();
    x.arc(W / 2, 220, s / 2 + 6, 0, Math.PI * 2);
    x.fillStyle = '#ffffff';
    x.fill();
    x.beginPath();
    x.arc(W / 2, 220, s / 2, 0, Math.PI * 2);
    x.clip();
    x.drawImage(logo, W / 2 - s / 2, 220 - s / 2, s, s);
    x.restore();
    top = 330;
  }
  x.fillStyle = logo ? '#0f172a' : '#ffffff';
  x.font = '800 52px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const nameLines = wrapText(x, shop.name, W - 120);
  nameLines.forEach((ln, i) => x.fillText(ln, W / 2, (logo ? top : 120) + i * 60));
  const afterName = (logo ? top : 120) + nameLines.length * 60;

  x.fillStyle = '#334155';
  x.font = '600 34px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  x.fillText('Imbas untuk tengok produk', W / 2, Math.max(afterName + 40, 300));
  x.fillText('dan order terus melalui WhatsApp', W / 2, Math.max(afterName + 84, 344));

  const qrSize = 560;
  const qrY = Math.max(afterName + 120, 390);
  drawQr(x, m, (W - qrSize) / 2, qrY, qrSize);

  x.fillStyle = '#0f172a';
  x.font = '700 30px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  x.fillText(url.replace(/^https?:\/\//, ''), W / 2, qrY + qrSize + 60);
  x.fillStyle = '#64748b';
  x.font = '500 22px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  x.fillText('Kedai AnnurPro', W / 2, H - 40);
  return c;
}

function download(canvas, name) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        toast('Gambar tak dapat dijana.', 'error');
        return resolve(false);
      }
      const a = h('a', { href: URL.createObjectURL(blob), download: name, hidden: true });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 5000);
      resolve(true);
    }, 'image/png');
  });
}

export function viewQr(ctx) {
  const root = h('div', { class: 'stack' }, h('a', { class: 'back-link', href: '#/' }, '‹ Utama'), h('h1', {}, 'Kod QR kedai'));
  const body = h('div', { class: 'stack' }, h('div', { class: 'skeleton', style: 'height:320px' }));
  root.appendChild(body);

  (async () => {
    try {
      const [{ default: qrcode }, cfg, data] = await Promise.all([import(LIB), getConfig(), api('/api/shop')]);
      const shop = data.shop;
      const url = `${location.origin}/${shop.slug}`;
      // QR membawa ?src=qr supaya statistik boleh membezakan pelawat dari kod QR atau poster.
      const m = qrMatrix(qrcode, `${url}?src=qr`);

      const qrCanvas = h('canvas', { class: 'qr-canvas', width: 720, height: 720, role: 'img', 'aria-label': `Kod QR ke ${url}` });
      drawQr(qrCanvas.getContext('2d'), m, 0, 0, 720);

      const posterImg = h('img', { class: 'qr-poster-preview', alt: 'Pratonton poster QR untuk dicetak' });
      const logoSrc = shop.logoKey ? mediaUrl(cfg, shop.logoKey) : '';
      let poster = await drawPoster(m, shop, url, logoSrc);
      try {
        posterImg.src = poster.toDataURL('image/png');
      } catch {
        // Logo dari domain lain tanpa CORS mencemarkan kanvas: lukis semula tanpa logo.
        poster = await drawPoster(m, shop, url, '');
        posterImg.src = poster.toDataURL('image/png');
      }

      const dlQr = h('button', { type: 'button', class: 'btn btn-block' }, icon('gambar'), h('span', {}, 'Muat turun kod QR (PNG)'));
      dlQr.addEventListener('click', () => download(qrCanvas, `qr-${shop.slug}.png`));
      const dlPoster = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, icon('gambar'), h('span', {}, 'Muat turun poster A5 (PNG)'));
      dlPoster.addEventListener('click', () => download(poster, `poster-qr-${shop.slug}.png`));
      const printBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, h('span', {}, 'Cetak poster'));
      printBtn.addEventListener('click', () => window.print());

      body.replaceChildren(
        h(
          'section',
          { class: 'card stack-sm qr-card' },
          h('p', { class: 'muted' }, 'Pelanggan imbas dengan kamera phone untuk terus buka kedai anda.'),
          qrCanvas,
          h('p', { class: 'qr-url' }, url.replace(/^https?:\/\//, '')),
          dlQr,
        ),
        h(
          'section',
          { class: 'card stack-sm' },
          h('h2', {}, 'Poster untuk kaunter atau gerai'),
          h('p', { class: 'caption' }, 'Saiz A5. Cetak dan tampal di kaunter, gerai, atau bungkusan.'),
          h('div', { class: 'qr-print' }, posterImg),
          dlPoster,
          printBtn,
        ),
      );
    } catch (err) {
      if (err.status === 401) return ctx.onError(err);
      body.replaceChildren(h('div', { class: 'card stack' }, h('p', { role: 'alert' }, 'Kod QR tak dapat dijana. Cuba muat semula.')));
    }
  })();
  return root;
}
