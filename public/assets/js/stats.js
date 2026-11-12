// Statistik kedai untuk peniaga (Pusingan 3): kad ringkas di dashboard dan skrin #/statistik.
// Percuma: 7 hari. Pro: 30 atau 90 hari dan produk paling dilihat.

import { api } from './api.js';
import { h, icon } from './ui.js';
import { barChart } from './chart.js';

const COLOR_VIEWS = '#0d9488'; // disahkan dengan validator dataviz
const COLOR_ORDERS = '#d97706';
const shortDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const tile = (label, value, note) => h('div', { class: 'stat-tile' }, h('span', { class: 'stat-value' }, String(value)), h('span', { class: 'stat-label' }, label), note ? h('span', { class: 'caption' }, note) : null);

/** Kad dashboard: 7 hari terakhir. Dimuat selepas dashboard dilukis supaya tak melambatkan. */
export function statsCard(ctx) {
  const body = h('div', { class: 'stat-tiles' }, h('div', { class: 'skeleton', style: 'height:64px;grid-column:1/-1' }));
  const card = h(
    'section',
    { class: 'card stack-sm' },
    h('div', { class: 'shop-head' }, h('h2', {}, 'Statistik 7 hari'), h('a', { href: '#/statistik', class: 'caption' }, 'Lihat penuh')),
    body,
  );
  api('/api/stats?days=7').then(
    (d) => {
      const t = d.totals;
      body.replaceChildren(
        tile('Lawatan', t.views, t.qr ? `${t.qr} dari kod QR` : null),
        tile('Order WhatsApp', t.orders),
        tile('Kadar order', `${t.orderRatePct}%`),
      );
    },
    (err) => {
      if (err.status === 401) return ctx.onError(err);
      body.replaceChildren(h('p', { class: 'caption', style: 'grid-column:1/-1' }, 'Statistik tak dapat dimuatkan.'));
    },
  );
  return card;
}

export function viewStats(ctx) {
  const root = h('div', { class: 'stack' }, h('a', { class: 'back-link', href: '#/' }, '‹ Utama'), h('h1', {}, 'Statistik kedai'));
  const body = h('div', { class: 'stack' }, h('div', { class: 'skeleton', style: 'height:280px' }));
  root.appendChild(body);
  let days = 7;

  async function load() {
    try {
      render(await api(`/api/stats?days=${days}`));
    } catch (err) {
      if (err.status === 401) return ctx.onError(err);
      body.replaceChildren(h('div', { class: 'card stack' }, h('p', { role: 'alert' }, err.message), h('button', { type: 'button', class: 'btn btn-block', onclick: load }, 'Cuba semula')));
    }
  }

  function render(d) {
    const t = d.totals;
    const range = h(
      'div',
      { class: 'seg-row', role: 'group', 'aria-label': 'Tempoh' },
      [7, 30, 90].map((n) => {
        const locked = n > d.maxDays;
        const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(d.days === n), disabled: locked, title: locked ? 'Pelan Pro' : null }, locked ? `${n} hari (Pro)` : `${n} hari`);
        b.addEventListener('click', () => {
          days = n;
          load();
        });
        return b;
      }),
    );
    const top = d.isPro
      ? d.topProducts.length
        ? h('ol', { class: 'top-list' }, d.topProducts.map((p) => h('li', {}, h('span', {}, p.name), h('strong', {}, `${p.views} paparan`))))
        : h('p', { class: 'muted' }, 'Belum ada paparan produk dalam tempoh ini.')
      : h('div', { class: 'stack-sm' }, h('p', { class: 'muted' }, 'Produk paling dilihat dan statistik 30 hingga 90 hari tersedia untuk pelan Pro.'), h('a', { class: 'btn btn-secondary btn-block', href: '#/langganan' }, 'Lihat pelan Pro'));

    body.replaceChildren(
      range,
      h(
        'div',
        { class: 'stat-tiles stat-tiles-6' },
        tile('Lawatan', t.views),
        tile('Dari kod QR', t.qr),
        tile('Paparan produk', t.items),
        tile('Tambah troli', t.carts),
        tile('Order WhatsApp', t.orders),
        tile('Kadar order', `${t.orderRatePct}%`, 'order / lawatan'),
      ),
      h(
        'section',
        { class: 'card stack-sm' },
        h('h2', {}, 'Lawatan sehari'),
        barChart({ title: `Lawatan sehari, ${d.days} hari`, color: COLOR_VIEWS, data: d.series.map((x) => ({ label: shortDate(x.date), value: x.views })), format: (v) => `${v} lawatan`, axisFormat: String, tableHead: ['Tarikh', 'Lawatan'], integer: true }),
      ),
      h(
        'section',
        { class: 'card stack-sm' },
        h('h2', {}, 'Order WhatsApp sehari'),
        barChart({ title: `Order WhatsApp sehari, ${d.days} hari`, color: COLOR_ORDERS, data: d.series.map((x) => ({ label: shortDate(x.date), value: x.orders })), format: (v) => `${v} order`, axisFormat: String, tableHead: ['Tarikh', 'Order'], integer: true }),
      ),
      h('section', { class: 'card stack-sm' }, h('h2', {}, 'Produk paling dilihat'), top),
      h(
        'p',
        { class: 'caption' },
        icon('jam'),
        ' Dikira tanpa data peribadi: satu lawatan setiap sesi pelayar. "Order WhatsApp" ialah tekanan butang Hantar; pelanggan mungkin tak menekan Send di WhatsApp. Data disimpan 120 hari.',
      ),
    );
  }

  load();
  return root;
}
