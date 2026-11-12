/* global ResizeObserver */
// Carta bar SVG ringan untuk panel admin (tanpa library). Satu siri setiap carta, satu paksi.
// Spesifikasi (skill dataviz): bar <= 24px dengan jarak 2px, hujung data bulat 4px dan rata di garis dasar,
// grid garis rambut, label teks guna warna teks (bukan warna data), tooltip bila hover/fokus/sentuh, dan jadual sebagai
// paparan alternatif. Lebar diukur daripada bekas dan dilukis semula bila saiz berubah.

import { h } from './ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

// Langkah paksi "bersih": 1, 2 atau 5 x 10^k supaya 3 hingga 5 garisan.
// integer: untuk kiraan (tiada "0.5 kedai").
export function niceTicks(max, { integer = false } = {}) {
  const top = max > 0 ? max : 1;
  const raw = top / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw) || mag * 10;
  if (integer) step = Math.max(1, Math.round(step));
  const end = Math.ceil(top / step) * step;
  const ticks = [];
  for (let v = 0; v <= end + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

function barPath(x, y, w, base) {
  const r = Math.min(4, w / 2, base - y);
  if (base - y <= 0) return '';
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

/**
 * @param {{ title: string, data: { label: string, value: number }[], color: string, format?: (v:number)=>string,
 *           unit?: string, axisFormat?: (v:number)=>string }} opts
 * label = tarikh pendek untuk paksi (contoh "12/11"); format = teks nilai dalam tooltip dan jadual.
 */
export function barChart({ title, data, color, format = String, axisFormat = format, tableHead = ['Tarikh', 'Nilai'], integer = false }) {
  const svgWrap = h('div', { class: 'chart-plot' });
  const tip = h('div', { class: 'chart-tip', role: 'status', hidden: true });
  const table = h(
    'details',
    { class: 'chart-table' },
    h('summary', {}, 'Lihat jadual'),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'data-table' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, tableHead[0]), h('th', { scope: 'col' }, tableHead[1]))),
        h('tbody', {}, data.map((d) => h('tr', {}, h('td', {}, d.label), h('td', {}, format(d.value))))),
      ),
    ),
  );
  const root = h('figure', { class: 'chart' }, svgWrap, tip, table);
  const total = data.reduce((a, d) => a + d.value, 0);
  const peak = data.reduce((m, d) => (d.value > m.value ? d : m), data[0] || { value: 0, label: '' });

  function hideTip() {
    tip.hidden = true;
  }
  function showTip(d, x, y) {
    tip.textContent = `${d.label}: ${format(d.value)}`;
    tip.hidden = false;
    const w = svgWrap.clientWidth;
    tip.style.left = `${Math.max(0, Math.min(w - tip.offsetWidth, x - tip.offsetWidth / 2))}px`;
    tip.style.top = `${Math.max(0, y - tip.offsetHeight - 8)}px`;
  }

  function draw() {
    const W = Math.max(280, Math.round(svgWrap.clientWidth || 320));
    const H = 200;
    const padL = 44;
    const padR = 8;
    const padT = 12;
    const padB = 26;
    const base = H - padB;
    const ticks = niceTicks(Math.max(...data.map((d) => d.value), 0), { integer });
    const top = ticks[ticks.length - 1] || 1;
    const yOf = (v) => base - ((base - padT) * v) / top;
    const band = (W - padL - padR) / Math.max(1, data.length);
    const bw = Math.max(2, Math.min(24, band - 2));

    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${title}. Jumlah ${format(total)}. Tertinggi ${peak.label}: ${format(peak.value)}.` });
    for (const t of ticks) {
      const y = yOf(t);
      svg.append(s('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: t === 0 ? 'chart-base' : 'chart-grid' }));
      const lab = s('text', { x: padL - 6, y: y + 4, 'text-anchor': 'end', class: 'chart-axis' });
      lab.textContent = axisFormat(t);
      svg.append(lab);
    }
    data.forEach((d, i) => {
      const x = padL + i * band + (band - bw) / 2;
      const path = barPath(x, yOf(d.value), bw, base);
      if (path) svg.append(s('path', { d: path, fill: color, class: 'chart-bar' }));
      // Paksi-x: setiap 7 hari dari hari terakhir ke belakang supaya label tak bertindih.
      if ((data.length - 1 - i) % 7 === 0) {
        const lab = s('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle', class: 'chart-axis' });
        lab.textContent = d.label;
        svg.append(lab);
      }
      // Kawasan sentuh setinggi plot (lebih besar daripada bar) untuk hover, sentuhan dan papan kekunci.
      const hit = s('rect', { x: padL + i * band, y: padT, width: band, height: base - padT, class: 'chart-hit', tabindex: '0', 'aria-label': `${d.label}: ${format(d.value)}` });
      const show = () => showTip(d, x + bw / 2, yOf(d.value));
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('pointerleave', hideTip);
      hit.addEventListener('blur', hideTip);
      svg.append(hit);
    });
    svgWrap.replaceChildren(svg);
  }

  // Lukis selepas dimasukkan ke DOM (perlu lebar sebenar), dan semula bila lebar berubah.
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.round(svgWrap.clientWidth);
    if (w && w !== lastW) {
      lastW = w;
      draw();
    }
  });
  ro.observe(svgWrap);
  return root;
}
