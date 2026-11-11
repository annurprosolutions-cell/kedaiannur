// S-14 Langganan: pelan semasa, notis tarikh tamat, bandingan pelan dan sejarah bayaran.
// Butang bayar BCL dibina dalam Fasa 6.

import { api } from './api.js';
import { h } from './ui.js';
import { formatBytes } from './forms.js';
import { formatSen } from './rules.js';
import { formatDate, planBadge, planNotice } from './plannotice.js';

const yesNo = (v) => (v ? 'Ya' : 'Tidak');

export function viewBilling(ctx) {
  const root = h('div', { class: 'stack' }, h('h1', {}, 'Langganan'));
  const body = h('div', { class: 'stack' }, h('div', { class: 'skeleton', style: 'height:240px' }));
  root.appendChild(body);

  async function load() {
    try {
      render(await api('/api/billing'));
    } catch (err) {
      if (err.status === 401) return ctx.onError(err);
      body.replaceChildren(h('div', { class: 'card stack' }, h('p', { role: 'alert' }, err.message), h('button', { type: 'button', class: 'btn btn-block', onclick: load }, 'Cuba semula')));
    }
  }

  function render(data) {
    const shop = ctx.me.shop;
    const st = data.status;
    const current = h(
      'section',
      { class: 'card stack-sm' },
      h('div', { class: 'shop-head' }, h('h2', {}, `Pelan ${data.effectivePlan.name}`), planBadge({ ...shop, planStatus: st, plan: data.effectivePlan })),
      st.expiresAt
        ? h('p', { class: 'muted' }, st.state === 'expired' || st.state === 'grace' ? `Pro tamat pada ${formatDate(st.expiresAt)}.` : `Aktif sehingga ${formatDate(st.expiresAt)}.`)
        : h('p', { class: 'muted' }, 'Pelan percuma, tiada tarikh tamat.'),
      planNotice({ ...shop, planStatus: st }, { withLink: false }),
    );

    const [free, pro] = [data.plans.find((p) => p.code === 'free'), data.plans.find((p) => p.code === 'pro')];
    const rows = [
      ['Harga', 'RM0', pro ? `${formatSen(pro.priceMonthSen)} sebulan atau ${formatSen(pro.priceYearSen)} setahun` : '-'],
      ['Produk', free.maxProducts, pro && pro.maxProducts],
      ['Kategori', free.maxCategories, pro && pro.maxCategories],
      ['Banner', free.maxBanners, pro && `${pro.maxBanners} (berputar)`],
      ['Storage gambar', formatBytes(free.maxStorageBytes), pro && formatBytes(pro.maxStorageBytes)],
      ['Templat mesej sendiri', yesNo(free.customTemplate), pro && yesNo(pro.customTemplate)],
      ['Buang "Dikuasakan oleh"', yesNo(free.hideBranding), pro && yesNo(pro.hideBranding)],
    ];
    const table = h(
      'table',
      { class: 'plan-table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, ''), h('th', { scope: 'col' }, free.name), pro ? h('th', { scope: 'col' }, pro.name) : null)),
      h('tbody', {}, rows.map(([label, a, b]) => h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, String(a)), pro ? h('td', {}, String(b)) : null))),
    );

    const history = data.payments.length
      ? h(
          'ul',
          { class: 'pay-list' },
          data.payments.map((p) =>
            h('li', {}, h('span', {}, `${formatDate(p.createdAt)} · ${p.period === 'yearly' ? 'Tahunan' : 'Bulanan'} x${p.quantity}`), h('strong', {}, formatSen(p.amountSen))),
          ),
        )
      : h('p', { class: 'muted' }, 'Belum ada bayaran.');

    body.replaceChildren(
      current,
      h('section', { class: 'card stack' }, h('h2', {}, 'Bandingan pelan'), h('div', { class: 'table-wrap' }, table)),
      h(
        'section',
        { class: 'card stack-sm' },
        h('h2', {}, 'Naik taraf atau perbaharui'),
        h('p', { class: 'muted' }, 'Pembayaran melalui FPX dan kad (BCL) akan dibuka tidak lama lagi. Pro diaktifkan automatik selepas bayaran.'),
      ),
      h('section', { class: 'card stack-sm' }, h('h2', {}, 'Sejarah bayaran'), history),
    );
  }

  load();
  return root;
}
