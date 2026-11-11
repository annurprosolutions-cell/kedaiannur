// S-14 Langganan: pelan semasa, notis tarikh tamat, bandingan pelan, butang Bayar (BCL) dan sejarah bayaran.
// Selepas bayar, BCL kembali ke /app/?bayar=berjaya#/langganan; halaman ini menyemak status sehingga Pro aktif.

import { api } from './api.js';
import { h, icon, toast } from './ui.js';
import { formatBytes } from './forms.js';
import { formatSen } from './rules.js';
import { formatDate, planBadge, planNotice } from './plannotice.js';

const yesNo = (v) => (v ? 'Ya' : 'Tidak');

const POLL_MS = 5000;
const POLL_MAX_MS = 120000; // DBD: selepas 2 minit papar "sedang diproses"

// Status kembali daripada borang BCL (?bayar=berjaya|gagal). Dibaca sekali dan dibuang daripada URL.
function takeReturnStatus() {
  const params = new URLSearchParams(window.location.search);
  const v = params.get('bayar');
  if (!v) return null;
  params.delete('bayar');
  const q = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
  return v === 'berjaya' || v === 'gagal' ? v : null;
}

export function viewBilling(ctx) {
  const root = h('div', { class: 'stack' }, h('h1', {}, 'Langganan'));
  const banner = h('div', { class: 'stack-sm', 'aria-live': 'polite' });
  const body = h('div', { class: 'stack' }, h('div', { class: 'skeleton', style: 'height:240px' }));
  root.append(banner, body);
  const returned = takeReturnStatus();
  let baseline = null;
  let baseline2 = null;
  let pollStart = 0;
  const isPaidPro = (data) => data.planCode === 'pro' && data.status.expiresAt;

  function showReturn(kind, text) {
    banner.replaceChildren(h('p', { class: `notice ${kind === 'gagal' ? 'notice-danger' : kind === 'lama' ? 'notice-warning' : 'notice-info'}`, role: 'status' }, text));
  }

  async function poll() {
    if (!root.isConnected && pollStart) return; // pengguna sudah ke halaman lain
    if (Date.now() - pollStart > POLL_MAX_MS) {
      showReturn('lama', 'Bayaran diterima dan sedang diproses. Jika Pro belum aktif selepas 10 minit, hubungi sokongan dengan nombor order BCL anda.');
      return;
    }
    try {
      const data = await api('/api/billing');
      const changed = data.status.expiresAt !== baseline || (data.payments[0] && data.payments[0].orderNo) !== baseline2;
      if (changed) {
        banner.replaceChildren(h('p', { class: 'notice notice-success', role: 'status' }, `Terima kasih. Pro aktif sehingga ${formatDate(data.status.expiresAt)}.`));
        toast('Pro diaktifkan.', 'success');
        await ctx.reloadMe({ render: false });
        render(data);
        return;
      }
    } catch {
      /* cuba lagi pada giliran seterusnya */
    }
    setTimeout(poll, POLL_MS);
  }

  async function load() {
    try {
      const data = await api('/api/billing');
      if (returned === 'berjaya' && !pollStart) {
        baseline = data.status.expiresAt;
        baseline2 = data.payments[0] ? data.payments[0].orderNo : null;
        pollStart = Date.now();
        showReturn('ok', 'Terima kasih. Bayaran sedang disahkan dengan BCL; Pro biasanya aktif dalam masa kira-kira seminit. Halaman ini akan dikemas kini sendiri.');
        setTimeout(poll, POLL_MS);
      } else if (returned === 'gagal' && !banner.childElementCount) {
        showReturn('gagal', 'Bayaran tak berjaya atau dibatalkan. Tiada caj dibuat; anda boleh cuba lagi.');
      }
      render(data);
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
      paySection(data, pro),
      h('section', { class: 'card stack-sm' }, h('h2', {}, 'Sejarah bayaran'), history),
    );
  }

  function paySection(data, pro) {
    const title = h('h2', {}, isPaidPro(data) ? 'Perbaharui Pro' : 'Naik taraf ke Pro');
    if (!data.bclUrl || !pro) {
      return h('section', { class: 'card stack-sm' }, title, h('p', { class: 'muted' }, 'Pembayaran dalam talian belum dibuka. Hubungi sokongan untuk naik taraf.'));
    }
    const copyBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, icon('salin'), 'Salin');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(data.email);
        toast('E-mel disalin.', 'success');
      } catch {
        toast(`Salin tak berjaya. Taip sendiri: ${data.email}`, 'info');
      }
    });
    return h(
      'section',
      { class: 'card stack-sm pay-card' },
      title,
      h('p', { class: 'muted' }, `${formatSen(pro.priceMonthSen)} sebulan atau ${formatSen(pro.priceYearSen)} setahun. Bayar dengan FPX atau kad melalui BCL. Tiada caj automatik; bayar semula bila mahu sambung.`),
      h('ol', { class: 'pay-steps' },
        h('li', {}, 'Dalam borang, pilih ', h('strong', {}, 'Kedai Pro Bulanan'), ' atau ', h('strong', {}, 'Kedai Pro Tahunan'), '. Tambah kuantiti untuk bayar beberapa bulan atau tahun sekali gus.'),
        h('li', {}, 'Isi medan ', h('strong', {}, 'E-mel akaun Google'), ' dengan e-mel di bawah (e-mel yang anda guna untuk log masuk sistem ini). E-mel pembayar boleh berbeza.'),
      ),
      h('div', { class: 'pay-email' }, h('span', { class: 'value', id: 'pay-email' }, data.email), copyBtn),
      h('a', { class: 'btn btn-block', href: data.bclUrl, target: '_blank', rel: 'noopener' }, icon('luar'), 'Bayar melalui BCL'),
      h('p', { class: 'caption' }, 'Pro diaktifkan automatik dalam kira-kira seminit selepas bayaran berjaya. Masa ditambah dari tarikh tamat semasa jika Pro masih aktif.'),
    );
  }


  load();
  return root;
}
