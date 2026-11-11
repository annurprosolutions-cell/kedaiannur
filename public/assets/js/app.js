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

function logoSvg() {
  const wrap = icon('kedai');
  wrap.setAttribute('stroke', 'var(--primary)');
  return wrap;
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

function placeholder(iconName, title, text) {
  return h('section', { class: 'card placeholder' }, icon(iconName), h('h2', {}, title), h('p', { class: 'muted' }, text));
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

// F-09: salin link, kongsi ke WhatsApp dan buka kedai, satu sentuhan setiap satu.
function shareActions(shop) {
  const url = shopUrl(shop);
  const copy = h('button', { type: 'button', class: 'btn btn-secondary' }, icon('salin'), h('span', {}, 'Salin link'));
  copy.addEventListener('click', async () => {
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
    h('a', { class: 'btn btn-wa', href: `https://wa.me/?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' }, icon('whatsapp'), h('span', {}, 'Kongsi')),
    h('a', { class: 'btn btn-secondary', href: url, target: '_blank', rel: 'noopener' }, icon('luar'), h('span', {}, 'Buka kedai')),
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
    h(
      'section',
      { class: 'card stack-sm' },
      h('div', { class: 'shop-head' }, h('h2', {}, shop.name), h('span', { class: isPro ? 'badge badge-pro' : 'badge' }, plan.name)),
      h('p', { class: 'muted shop-link' }, shopUrl(shop).replace(/^https?:\/\//, '')),
      h('p', { class: 'caption' }, shop.isOpen ? 'Kedai sedang buka.' : 'Kedai sedang tutup. Pelanggan tak boleh hantar order.'),
      shareActions(shop),
    ),
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
  return placeholder('kad', 'Langganan', 'Bandingan pelan dan bayaran BCL akan dibina dalam Fasa 6.');
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
    h('p', { class: 'caption' }, 'Eksport data dan padam kedai akan tersedia dalam Fasa 8.'),
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

boot();
