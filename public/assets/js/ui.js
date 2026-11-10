// Pembantu UI. Teks pengguna sentiasa melalui textContent (bukan innerHTML) untuk elak XSS.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Ikon garis 2 px (DBD seksyen 7). Setiap ikon ialah senarai elemen SVG pemalar.
const ICONS = {
  kedai: [['path', { d: 'M3 9l2-5h14l2 5M3 9v11h18V9M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0M9 20v-6h6v6' }]],
  produk: [
    ['path', { d: 'M21 8l-9-5-9 5 9 5 9-5z' }],
    ['path', { d: 'M3 8v8l9 5 9-5V8M12 13v8' }],
  ],
  tetapan: [
    ['circle', { cx: '12', cy: '12', r: '3' }],
    ['path', { d: 'M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z' }],
  ],
  kad: [
    ['rect', { x: '2', y: '5', width: '20', height: '14', rx: '2' }],
    ['path', { d: 'M2 10h20M6 15h4' }],
  ],
  orang: [
    ['circle', { cx: '12', cy: '8', r: '4' }],
    ['path', { d: 'M4 21a8 8 0 0116 0' }],
  ],
  keluar: [['path', { d: 'M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 17l5-5-5-5M15 12H3' }]],
  binaan: [
    ['path', { d: 'M2 20h20M5 20V9l7-5 7 5v11' }],
    ['path', { d: 'M9 20v-6h6v6' }],
  ],
};

export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICONS[name] || []) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

/**
 * h('button', { class: 'btn', onclick: fn }, 'Simpan')
 * Rentetan anak menjadi nod teks. Atribut on* menjadi event listener.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

let toastWrap;
export function toast(message, type = 'info', action) {
  if (!toastWrap) {
    toastWrap = h('div', { class: 'toast-wrap', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastWrap);
  }
  const el = h('div', { class: `toast toast-${type}` }, h('span', {}, message));
  if (action) {
    el.appendChild(
      h('button', { type: 'button', onclick: () => { el.remove(); action.run(); } }, action.label),
    );
  }
  toastWrap.appendChild(el);
  setTimeout(() => el.remove(), action ? 6000 : 3000);
}
