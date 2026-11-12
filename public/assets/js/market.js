// Halaman awam /marketplace: senarai kedai daripada /api/market (indeks R2), dengan carian dan tapisan jenis kedai.
// Semua teks daripada peniaga dipaparkan melalui textContent.

import { h } from './ui.js';

const grid = document.getElementById('market-grid');
const countEl = document.getElementById('market-count');
const empty = document.getElementById('market-empty');
const q = document.getElementById('market-q');
const chipsEl = document.getElementById('market-cats');

let shops = [];
let media = '';
const filter = { q: '', cat: '' };

const safeKey = (k) => typeof k === 'string' && /^[\w/.-]+$/.test(k) && !k.includes('..');
const img = (k) => (safeKey(k) && media ? `${media}/${k}` : '');

function card(s) {
  const banner = img(s.b);
  const logo = img(s.l);
  return h(
    'li',
    { class: 'market-card' },
    h(
      'a',
      { href: `/${encodeURIComponent(s.s)}`, class: 'market-link' },
      h(
        'div',
        { class: 'market-cover' },
        banner ? h('img', { src: banner, alt: '', loading: 'lazy', decoding: 'async', width: 800, height: 400 }) : null,
        s.f ? h('span', { class: 'market-flag' }, 'Pilihan') : null,
      ),
      h(
        'div',
        { class: 'market-body' },
        h(
          'div',
          { class: 'market-title' },
          logo ? h('img', { class: 'market-logo', src: logo, alt: '', loading: 'lazy', width: 48, height: 48 }) : h('span', { class: 'market-logo market-logo-ph', 'aria-hidden': 'true' }, s.n.slice(0, 1).toUpperCase()),
          h('div', {}, h('h2', {}, s.n), h('p', { class: 'market-cat' }, s.cn)),
        ),
        s.d ? h('p', { class: 'market-desc' }, s.d) : null,
        h('p', { class: 'caption' }, `${s.i} produk${s.o ? '' : ' · Kedai tutup buat masa ini'}`),
      ),
    ),
  );
}

function render() {
  const words = filter.q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = shops.filter(
    (s) => (!filter.cat || s.c === filter.cat) && words.every((w) => `${s.n} ${s.d} ${s.cn}`.toLowerCase().includes(w)),
  );
  grid.replaceChildren(...list.map(card));
  countEl.textContent = shops.length ? `${list.length} daripada ${shops.length} kedai` : 'Belum ada kedai di Marketplace.';
  empty.hidden = list.length > 0 || shops.length === 0;
}

function renderChips() {
  const cats = [...new Map(shops.map((s) => [s.c, s.cn])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const opts = [['', 'Semua'], ...cats];
  chipsEl.replaceChildren(
    ...opts.map(([code, name]) => {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(filter.cat === code) }, name);
      b.addEventListener('click', () => {
        filter.cat = code;
        renderChips();
        render();
      });
      return b;
    }),
  );
}

async function load() {
  try {
    const [cfg, data] = await Promise.all([
      fetch('/api/config').then((r) => r.json()),
      fetch('/api/market').then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
    ]);
    media = String(cfg.mediaBaseUrl || '').replace(/\/+$/, '');
    shops = Array.isArray(data.shops) ? data.shops : [];
    renderChips();
    render();
  } catch {
    countEl.textContent = 'Senarai kedai tak dapat dimuatkan. Cuba muat semula halaman.';
  }
}

q.addEventListener('input', () => {
  filter.q = q.value.trim();
  render();
});
load();
