// Dashboard peniaga /app/ (Fasa 1: login, sesi, kerangka navigasi).
// Laluan guna hash (#/produk) supaya fail statik tunggal cukup tanpa rewrite di server.

import { api } from './api.js';
import { h, icon, toast } from './ui.js';
import { renderGoogleButton, googleSignOut } from './google.js';

const root = document.getElementById('app');
const state = { me: null };

const NAV = [
  { route: '', label: 'Utama', icon: 'kedai' },
  { route: 'produk', label: 'Produk', icon: 'produk' },
  { route: 'tetapan', label: 'Tetapan', icon: 'tetapan' },
  { route: 'langganan', label: 'Langganan', icon: 'kad' },
  { route: 'akaun', label: 'Akaun', icon: 'orang' },
];

function currentRoute() {
  const r = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
  return NAV.some((n) => n.route === r) ? r : '';
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

let configPromise = null;
function getConfig() {
  if (!configPromise) {
    configPromise = api('/api/config').catch((err) => {
      configPromise = null;
      throw err;
    });
  }
  return configPromise;
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
  const route = currentRoute();
  const view = VIEWS[route] || VIEWS[''];
  const main = h('main', { class: 'app-main stack', id: 'main' }, statusNotice(), view());
  root.replaceChildren(h('div', { class: 'app-shell' }, header(), nav(route), main));
  window.scrollTo(0, 0);
}

// Akaun baharu tanpa kedai: terus ke S-08 tanpa navigasi.
function renderSetupShell() {
  setTitle('Setup kedai');
  const logoutBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: (e) => logout(e.currentTarget) }, icon('keluar'), 'Log keluar');
  root.replaceChildren(
    h('div', {}, header(logoutBtn), h('main', { class: 'app-main stack', id: 'main' }, viewSetup())),
  );
}

function placeholder(iconName, title, text) {
  return h('section', { class: 'card placeholder' }, icon(iconName), h('h2', {}, title), h('p', { class: 'muted' }, text));
}

// ---------------------------------------------------------------- Skrin

function viewSetup() {
  const user = state.me.user;
  return h(
    'div',
    { class: 'stack' },
    h('h1', {}, `Hai${user.name ? `, ${user.name}` : ''}`),
    h('p', { class: 'muted' }, `Anda log masuk sebagai ${user.email}.`),
    placeholder('binaan', 'Setup kedai', 'Langkah setup kedai (nama, link, nombor WhatsApp dan banner) akan dibuka dalam Fasa 2.'),
  );
}

function viewDashboard() {
  setTitle('Utama');
  const { user, shop } = state.me;
  return h(
    'div',
    { class: 'stack' },
    h('h1', {}, `Hai${user.name ? `, ${user.name}` : ''}`),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, shop.name),
      h('p', { class: 'muted' }, `kedai.annurpro.com/${shop.slug}`),
      h('span', { class: shop.planCode === 'pro' ? 'badge badge-pro' : 'badge' }, shop.planCode === 'pro' ? 'Pro' : 'Percuma'),
    ),
    placeholder('binaan', 'Dashboard', 'Salin link, meter penggunaan dan pintasan akan dibina dalam Fasa 3 dan 4.'),
  );
}

function viewProduk() {
  setTitle('Produk');
  return placeholder('produk', 'Produk', 'Senarai dan borang produk akan dibina dalam Fasa 3.');
}

function viewTetapan() {
  setTitle('Tetapan');
  return placeholder('tetapan', 'Tetapan kedai', 'Tetapan kedai akan dibina dalam Fasa 2.');
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
