// Dashboard peniaga /app/ (Fasa 1: login, sesi, kerangka navigasi).
// Laluan guna hash (#/produk) supaya fail statik tunggal cukup tanpa rewrite di server.

import { api } from './api.js';
import { h, icon, toast } from './ui.js';
import { renderGoogleButton, googleSignOut } from './google.js';
import { getConfig } from './config.js';
import { viewSetup } from './setup.js';
import { viewSettings } from './settings.js';
import { viewProducts, viewProductForm } from './products.js';
import { viewCategories } from './categories.js';
import { formatBytes } from './forms.js';
import { viewBilling } from './billing.js';
import { hiddenNotice, planBadge, planNotice } from './plannotice.js';
import { registerServiceWorker, onInstallChange, promptInstall } from './pwa.js';
import { viewQr } from './qr.js';
import { statsCard, viewStats } from './stats.js';

const root = document.getElementById('app');
const state = { me: null };

const NAV = [
  { route: '', label: 'Utama', icon: 'kedai' },
  { route: 'produk', label: 'Produk', icon: 'produk' },
  { route: 'tetapan', label: 'Tetapan', icon: 'tetapan' },
  { route: 'langganan', label: 'Langganan', icon: 'kad' },
  { route: 'akaun', label: 'Akaun', icon: 'orang' },
];

// Laluan: #/, #/produk, #/produk/baru, #/produk/<id>, #/kategori, #/tetapan, #/langganan, #/akaun.
// Pulangkan tab navigasi aktif dan fungsi skrin.
function resolveRoute() {
  const [a = '', b] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  if (a === 'produk' && b === 'baru') return { nav: 'produk', view: () => titled('Tambah produk', viewProductForm(ctx, null)) };
  if (a === 'produk' && b) return { nav: 'produk', view: () => titled('Ubah produk', viewProductForm(ctx, b)) };
  if (a === 'kategori') return { nav: 'produk', view: () => titled('Kategori', viewCategories(ctx)) };
  if (a === 'tetapan' && b) return { nav: 'tetapan', view: () => titled('Tetapan', viewSettings(ctx, { section: b })) };
  if (a === 'statistik') return { nav: '', view: () => titled('Statistik', viewStats(ctx)) };
  if (a === 'qr') return { nav: '', view: () => titled('Kod QR', viewQr(ctx)) };
  return NAV.some((n) => n.route === a) ? { nav: a, view: VIEWS[a] } : { nav: '', view: VIEWS[''] };
}

function titled(title, el) {
  setTitle(title);
  return el;
}

function setTitle(title) {
  document.title = title ? `${title} | Kedai AnnurPro` : 'Kedai AnnurPro';
}

function brand() {
  return h('span', { class: 'brand' }, logoSvg(), h('span', {}, 'Kedai AnnurPro'));
}

// Simbol jenama AnnurPro (scripts/make-icons.js).
function logoSvg() {
  return h('img', { class: 'brand-mark', src: '/assets/brand/annurpro-mark-64.webp', alt: '', width: 28, height: 28 });
}

// Ralat API biasa: 401 bermaksud sesi tamat, kembali ke skrin login.
function handleError(err) {
  if (err && err.status === 401) {
    state.me = null;
    render();
    toast('Sila log masuk semula.', 'error');
    return;
  }
  toast((err && err.message) || 'Ralat tidak dijangka.', 'error');
}

// Konteks yang dikongsi dengan skrin (setup.js, settings.js): data pengguna dan cara memuat semula.
const ctx = {
  get me() {
    return state.me;
  },
  onError: handleError,
  // Muat semula /api/me dan lukis semula skrin. render:false = kemas kini data sahaja.
  async reloadMe({ render: doRender = true } = {}) {
    try {
      state.me = await api('/api/me');
    } catch (err) {
      handleError(err);
      return false;
    }
    if (doRender) render();
    return true;
  },
};

// ---------------------------------------------------------------- boot

async function boot() {
  renderLoading();
  try {
    state.me = await api('/api/me');
  } catch (err) {
    if (err.status === 401) {
      state.me = null;
    } else {
      renderBootError(err);
      return;
    }
  }
  render();
}

function render() {
  if (!state.me) return renderLogin();
  if (!state.me.shop) return renderSetupShell();
  return renderShell();
}

function renderLoading() {
  root.replaceChildren(
    h(
      'div',
      { class: 'app-main', 'aria-busy': 'true' },
      h('div', { class: 'skeleton', style: 'height:28px;width:60%;margin:24px 0 16px' }),
      h('div', { class: 'skeleton', style: 'height:120px' }),
    ),
  );
}

function renderBootError(err) {
  setTitle('Ralat');
  root.replaceChildren(
    h(
      'main',
      { class: 'login-page' },
      h(
        'div',
        { class: 'card login-card' },
        brand(),
        h('p', { role: 'alert' }, err.message),
        h('button', { type: 'button', class: 'btn btn-block', onclick: boot }, 'Cuba semula'),
      ),
    ),
  );
}

// ---------------------------------------------------------------- S-07 Login

function renderLogin() {
  setTitle('Log masuk');
  history.replaceState(null, '', '/app/');

  const slot = h('div', { class: 'gsi-slot', id: 'gsi-slot' }, h('div', { class: 'skeleton', style: 'width:280px;height:44px;border-radius:22px' }));
  const msg = h('p', { class: 'caption', id: 'login-msg', role: 'alert' });
  const retry = h('button', { type: 'button', class: 'btn btn-secondary btn-block', hidden: true }, 'Cuba semula');

  root.replaceChildren(
    h(
      'main',
      { class: 'login-page' },
      h(
        'div',
        { class: 'card login-card' },
        brand(),
        h('h1', {}, 'Log masuk peniaga'),
        h('p', { class: 'muted' }, 'Urus kedai online anda dari phone. Log masuk dengan akaun Google, tiada password untuk diingat.'),
        slot,
        msg,
        retry,
      ),
    ),
  );

  const showError = (text, canRetry) => {
    msg.textContent = text;
    retry.hidden = !canRetry;
  };

  async function onCredential(credential) {
    if (!credential) {
      showError('Login tak berjaya, cuba lagi.', false);
      return;
    }
    showError('Sedang log masuk...', false);
    try {
      state.me = await api('/api/auth/google', { method: 'POST', body: { credential } });
      history.replaceState(null, '', '/app/');
      render();
      toast('Log masuk berjaya.', 'success');
    } catch (err) {
      showError(err.message || 'Login tak berjaya, cuba lagi.', false);
    }
  }

  async function mountButton() {
    retry.hidden = true;
    msg.textContent = '';
    let cfg;
    try {
      cfg = await getConfig();
    } catch (err) {
      showError(err.message, true);
      return;
    }
    if (!cfg.googleClientId) {
      showError('Login belum dikonfigurasi. Hubungi sokongan.', false);
      return;
    }
    try {
      await renderGoogleButton(slot, cfg.googleClientId, onCredential);
    } catch {
      slot.replaceChildren();
      showError('Butang Google tak dapat dimuatkan. Semak sambungan internet.', true);
    }
  }

  retry.addEventListener('click', mountButton);
  mountButton();
}

// ---------------------------------------------------------------- Kerangka selepas login

function header(extra) {
  return h('header', { class: 'app-header' }, h('a', { href: '#/', class: 'brand' }, logoSvg(), h('span', {}, 'Kedai AnnurPro')), extra || null);
}

function nav(active) {
  return h(
    'nav',
    { class: 'bottom-nav', 'aria-label': 'Navigasi utama' },
    NAV.map((item) =>
      h(
        'a',
        { class: 'nav-link', href: `#/${item.route}`, 'aria-current': item.route === active ? 'page' : null },
        icon(item.icon),
        h('span', {}, item.label),
      ),
    ),
  );
}

function statusNotice() {
  const shop = state.me.shop;
  if (shop && shop.status === 'suspended') {
    return h(
      'div',
      { class: 'notice notice-danger', role: 'alert' },
      'Kedai anda sedang digantung. ',
      shop.suspendedReason ? `Sebab: ${shop.suspendedReason}. ` : '',
      'Hubungi sokongan untuk maklumat lanjut.',
    );
  }
  return null;
}

function renderShell() {
  const route = resolveRoute();
  const main = h('main', { class: 'app-main stack', id: 'main' }, statusNotice(), route.view());
  root.replaceChildren(h('div', { class: 'app-shell' }, header(), nav(route.nav), main));
  window.scrollTo(0, 0);
}

// Akaun baharu tanpa kedai: terus ke S-08 tanpa navigasi.
function renderSetupShell() {
  setTitle('Setup kedai');
  const logoutBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: (e) => logout(e.currentTarget) }, icon('keluar'), 'Log keluar');
  root.replaceChildren(
    h('div', {}, header(logoutBtn), h('main', { class: 'app-main stack', id: 'main' }, viewSetup(ctx))),
  );
}

// ---------------------------------------------------------------- Skrin

function meter(label, used, max, fmt = (n) => String(n)) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return h(
    'div',
    { class: 'meter' },
    h('div', { class: 'meter-head' }, h('span', {}, label), h('span', { class: 'caption' }, `${fmt(used)} / ${fmt(max)}`)),
    h('div', { class: `meter-bar${pct >= 90 ? ' meter-hot' : ''}`, role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('span', { style: `width:${pct}%` })),
  );
}

function shopUrl(shop) {
  return `${location.origin}/${shop.slug}`;
}

// Langkah "Kongsi link" dalam senarai semak: tiada cara mengesan perkongsian di server, jadi ditanda dalam peranti ini.
const SHARED_KEY = (shop) => `kedai-dikongsi-${shop.id}`;
function markShared(shop) {
  try {
    window.localStorage.setItem(SHARED_KEY(shop), '1');
  } catch {
    /* storan disekat */
  }
}
function wasShared(shop) {
  try {
    return window.localStorage.getItem(SHARED_KEY(shop)) === '1';
  } catch {
    return false;
  }
}

// F-09: salin link, kongsi ke WhatsApp dan buka kedai, satu sentuhan setiap satu.
function shareActions(shop) {
  const url = shopUrl(shop);
  const copy = h('button', { type: 'button', class: 'btn btn-secondary' }, icon('salin'), h('span', {}, 'Salin link'));
  copy.addEventListener('click', async () => {
    markShared(shop);
    try {
      await navigator.clipboard.writeText(url);
      toast('Link disalin.', 'success');
    } catch {
      window.prompt('Salin link kedai anda:', url); // pelayar lama atau kebenaran papan klip ditolak
    }
  });
  const text = `Jemput tengok dan order di ${shop.name}: ${url}`;
  return h(
    'div',
    { class: 'share-row' },
    copy,
    h('a', { class: 'btn btn-wa', href: `https://wa.me/?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener', onclick: () => markShared(shop) }, icon('whatsapp'), h('span', {}, 'Kongsi')),
    h('a', { class: 'btn btn-secondary', href: url, target: '_blank', rel: 'noopener' }, icon('luar'), h('span', {}, 'Buka kedai')),
  );
}

// Senarai semak "Lengkapkan kedai": langkah yang membuat kedai sedia dikongsi. Hilang bila semua siap.
function setupChecklist(shop, usage) {
  const steps = [
    ['Muat naik logo', Boolean(shop.logoKey), '#/tetapan/logo'],
    ['Letak banner', usage.banners > 0, '#/tetapan/banner'],
    ['Tambah sekurang-kurangnya 3 produk', usage.products >= 3, '#/produk/baru'],
    ['Tulis penerangan kedai', Boolean(shop.hasDescription), '#/tetapan/maklumat'],
    ['Isi waktu operasi, lokasi atau media sosial', Boolean(shop.hasContact), '#/tetapan/hubungan'],
    ['Kongsi link kedai kepada pelanggan', wasShared(shop), null],
  ];
  const done = steps.filter((s) => s[1]).length;
  if (done === steps.length) return null;
  return h(
    'section',
    { class: 'card stack-sm checklist', 'aria-labelledby': 'cl-title' },
    h('div', { class: 'meter-head' }, h('h2', { id: 'cl-title' }, 'Lengkapkan kedai anda'), h('span', {}, `${done}/${steps.length}`)),
    h('div', { class: 'meter-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(steps.length), 'aria-valuenow': String(done), 'aria-label': 'Kemajuan setup kedai' }, h('span', { style: `width:${Math.round((done / steps.length) * 100)}%` })),
    h(
      'ul',
      { class: 'checklist-list' },
      steps.map(([label, ok, href]) =>
        h(
          'li',
          { class: ok ? 'is-done' : '' },
          h('span', { class: 'check-dot', 'aria-hidden': 'true' }, ok ? icon('semak') : null),
          ok || !href ? h('span', {}, label, ok ? h('span', { class: 'sr-only' }, ' (siap)') : null) : h('a', { href }, label),
        ),
      ),
    ),
  );
}

// S-09 Dashboard: link kedai dengan salin dan kongsi, pelan, meter penggunaan had, pintasan.
function viewDashboard() {
  setTitle('Utama');
  const { user, shop } = state.me;
  const usage = shop.usage || { products: 0, categories: 0, banners: 0 };
  const plan = shop.plan;
  const isPro = plan.code !== 'free';
  return h(
    'div',
    { class: 'stack' },
    h('h1', {}, `Hai${user.name ? `, ${user.name}` : ''}`),
    shop.catalogDirty
      ? h('p', { class: 'notice notice-warning', role: 'status' }, 'Katalog awam belum dikemas kini sepenuhnya. Simpan sebarang perubahan untuk cuba semula.')
      : null,
    planNotice(shop),
    hiddenNotice(shop),
    h(
      'section',
      { class: 'card stack-sm' },
      h('div', { class: 'shop-head' }, h('h2', {}, shop.name), planBadge(shop)),
      h('p', { class: 'muted shop-link' }, shopUrl(shop).replace(/^https?:\/\//, '')),
      h('p', { class: 'caption' }, shop.isOpen ? 'Kedai sedang buka.' : 'Kedai sedang tutup. Pelanggan tak boleh hantar order.'),
      shareActions(shop),
      h('a', { class: 'btn btn-secondary btn-block', href: '#/qr' }, icon('senarai'), h('span', {}, 'Kod QR dan poster kedai')),
    ),
    setupChecklist(shop, usage),
    statsCard(ctx),
    usage.products === 0
      ? h(
          'section',
          { class: 'card stack-sm' },
          h('h2', {}, 'Langkah seterusnya'),
          h('p', { class: 'muted' }, 'Tambah produk pertama: gambar, nama dan harga sudah cukup.'),
          h('a', { class: 'btn btn-block', href: '#/produk/baru' }, icon('tambah'), h('span', {}, 'Tambah produk pertama')),
        )
      : null,
    h(
      'section',
      { class: 'card stack' },
      h('h2', {}, 'Penggunaan pelan'),
      meter('Produk', usage.products, plan.maxProducts),
      meter('Kategori', usage.categories, plan.maxCategories),
      meter('Banner', usage.banners, plan.maxBanners),
      meter('Storage gambar', shop.storageBytes, plan.maxStorageBytes, formatBytes),
      isPro ? null : h('a', { class: 'btn btn-secondary btn-block', href: '#/langganan' }, 'Lihat pelan Pro'),
    ),
    h(
      'nav',
      { class: 'shortcuts', 'aria-label': 'Pintasan' },
      h('a', { class: 'btn btn-secondary', href: '#/produk' }, icon('produk'), h('span', {}, 'Produk')),
      h('a', { class: 'btn btn-secondary', href: '#/kategori' }, icon('senarai'), h('span', {}, 'Kategori')),
      h('a', { class: 'btn btn-secondary', href: '#/tetapan' }, icon('tetapan'), h('span', {}, 'Tetapan')),
    ),
  );
}

function viewProduk() {
  setTitle('Produk');
  return viewProducts(ctx);
}

function viewTetapan() {
  setTitle('Tetapan');
  return viewSettings(ctx);
}

function viewLangganan() {
  setTitle('Langganan');
  return viewBilling(ctx);
}

// S-15: eksport data (JSON) dan padam kedai beserta semua gambar (F-15, PDPA).
function accountData(shop) {
  const exportBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, icon('salin'), h('span', {}, 'Muat turun data saya (JSON)'));
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    try {
      const res = await fetch('/api/account/export', { credentials: 'same-origin' });
      if (res.status === 401) return handleError({ status: 401 });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const name = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || 'kedai-eksport.json';
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name, hidden: true });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast('Data dimuat turun.', 'success');
    } catch {
      toast('Eksport tak berjaya. Cuba lagi.', 'error');
    } finally {
      exportBtn.disabled = false;
    }
  });

  const confirmIn = h('input', { class: 'input', type: 'text', id: 'del-confirm', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: shop.slug });
  const delBtn = h('button', { type: 'button', class: 'btn btn-danger btn-block', disabled: true }, icon('padam'), h('span', {}, 'Padam kedai selama-lamanya'));
  confirmIn.addEventListener('input', () => {
    delBtn.disabled = confirmIn.value.trim().toLowerCase() !== shop.slug.toLowerCase();
  });
  delBtn.addEventListener('click', async () => {
    if (!window.confirm(`Padam "${shop.name}" sekarang? Tindakan ini tak boleh dibatalkan.`)) return;
    delBtn.disabled = true;
    delBtn.lastChild.textContent = 'Sedang memadam...';
    try {
      await api('/api/shop', { method: 'DELETE', body: { confirmSlug: confirmIn.value.trim() } });
      toast('Kedai dipadam. Semua produk dan gambar telah dibuang.', 'success');
      history.replaceState(null, '', '/app/');
      await ctx.reloadMe();
    } catch (err) {
      delBtn.disabled = false;
      delBtn.lastChild.textContent = 'Padam kedai selama-lamanya';
      handleError(err);
    }
  });

  return h(
    'div',
    { class: 'stack' },
    h('section', { class: 'card stack-sm' }, h('h2', {}, 'Data anda'), h('p', { class: 'muted' }, 'Muat turun salinan maklumat akaun, kedai, kategori, produk dan bayaran dalam format JSON.'), exportBtn),
    h(
      'section',
      { class: 'card stack-sm danger-zone' },
      h('h2', {}, 'Padam kedai'),
      h('p', { class: 'muted' }, `Semua produk, kategori, banner dan gambar akan dipadam serta-merta, dan link kedai.annurpro.com/${shop.slug} akan berhenti berfungsi. Rekod bayaran langganan disimpan untuk perakaunan. Akaun Google anda kekal dan boleh membuka kedai baharu.`),
      h('label', { for: 'del-confirm', class: 'd-label' }, `Taip "${shop.slug}" untuk sahkan`),
      confirmIn,
      delBtn,
    ),
    h('p', { class: 'caption' }, h('a', { href: '/privasi', target: '_blank', rel: 'noopener' }, 'Dasar privasi'), ' · ', h('a', { href: '/terma', target: '_blank', rel: 'noopener' }, 'Terma penggunaan')),
  );
}

// Kad "Pasang app": hanya muncul bila pelayar menawarkan pemasangan (Chrome, Edge, Android) dan app belum dipasang.
function installCard() {
  const card = h(
    'section',
    { class: 'card stack-sm', hidden: true },
    h('h2', {}, 'Pasang app'),
    h('p', { class: 'muted' }, 'Buka Kedai AnnurPro terus dari skrin utama atau desktop, tanpa perlu buka pelayar.'),
    h('button', { type: 'button', class: 'btn btn-block', onclick: () => promptInstall() }, 'Pasang app'),
  );
  onInstallChange((ok) => {
    card.hidden = !ok;
  });
  return card;
}

function viewAkaun() {
  setTitle('Akaun');
  const user = state.me.user;
  return h(
    'div',
    { class: 'stack' },
    h('h1', {}, 'Akaun'),
    h(
      'section',
      { class: 'card stack' },
      h('div', { class: 'profile-row' }, h('span', { class: 'label' }, 'Nama'), h('span', { class: 'value' }, user.name || '-')),
      h('div', { class: 'profile-row' }, h('span', { class: 'label' }, 'E-mel Google'), h('span', { class: 'value' }, user.email)),
    ),
    installCard(),
    accountData(state.me.shop),
    h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: (e) => logout(e.currentTarget) }, icon('keluar'), 'Log keluar'),
  );
}

const VIEWS = {
  '': viewDashboard,
  produk: viewProduk,
  tetapan: viewTetapan,
  langganan: viewLangganan,
  akaun: viewAkaun,
};

async function logout(btn) {
  if (btn) {
    btn.disabled = true;
    btn.lastChild.textContent = 'Sedang log keluar...';
  }
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (err) {
    if (err.status !== 401) {
      if (btn) {
        btn.disabled = false;
        btn.lastChild.textContent = 'Log keluar';
      }
      handleError(err);
      return;
    }
  }
  googleSignOut();
  state.me = null;
  render();
}

window.addEventListener('hashchange', () => {
  if (state.me && state.me.shop) renderShell();
});

registerServiceWorker();
boot();
