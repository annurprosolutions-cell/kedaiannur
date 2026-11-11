/* global IntersectionObserver */
// Halaman awam statik (landing, privasi, terma): tema, menu, harga pelan, e-mel sokongan, bar CTA dan pemasangan PWA.
// Semua elemen ada teks lalai dalam HTML, jadi halaman tetap lengkap jika skrip atau API gagal.

import { formatSen } from './rules.js';
import { registerServiceWorker, bindInstallButtons } from './pwa.js';

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

const ringgit = (sen) => formatSen(sen).replace(/\.00$/, '');

async function fillSupport() {
  const slots = document.querySelectorAll('[data-support-email]');
  if (!slots.length) return;
  try {
    const cfg = await getJson('/api/config');
    if (!cfg.supportEmail) return;
    for (const el of slots) {
      const a = document.createElement('a');
      a.href = `mailto:${cfg.supportEmail}`;
      a.textContent = cfg.supportEmail;
      el.replaceChildren(a);
    }
    for (const el of document.querySelectorAll('[data-support]')) el.hidden = false;
  } catch {
    /* kekalkan teks lalai */
  }
}

async function fillPlans() {
  const slots = document.querySelectorAll('[data-plan]');
  if (!slots.length) return;
  try {
    const { plans } = await getJson('/api/plans');
    const by = Object.fromEntries(plans.map((p) => [p.code, p]));
    for (const el of slots) {
      const [code, field] = el.dataset.plan.split('.');
      const p = by[code];
      if (!p) continue;
      const v = {
        month: ringgit(p.priceMonthSen),
        year: ringgit(p.priceYearSen),
        products: String(p.maxProducts),
        categories: String(p.maxCategories),
        banners: String(p.maxBanners),
        storage: `${Math.round(p.maxStorageBytes / 1048576)} MB`,
      }[field];
      if (v) el.textContent = v;
    }
    // Jimat tahunan dikira daripada harga sebenar, bukan ditulis tetap.
    const pro = by.pro;
    const save = pro ? pro.priceMonthSen * 12 - pro.priceYearSen : 0;
    const saveEl = document.querySelector('[data-save]');
    if (saveEl && save > 0) saveEl.textContent = `Jimat ${ringgit(save)} berbanding bayar bulanan.`;
    else if (saveEl) saveEl.dataset.nosave = '1';
  } catch {
    /* harga lalai dalam HTML */
  }
}

// Butang "Lihat contoh kedai" hanya dipaparkan jika kedai /contoh benar-benar wujud.
async function demoLink() {
  const btn = document.querySelector('[data-demo]');
  if (!btn) return;
  try {
    const res = await fetch(btn.getAttribute('href'), { method: 'HEAD' });
    if (res.ok) btn.hidden = false;
  } catch {
    /* kekal tersembunyi */
  }
}

function setupTheme() {
  for (const b of document.querySelectorAll('[data-theme-toggle]')) {
    b.addEventListener('click', () => window.kedaiTheme && window.kedaiTheme.toggle());
  }
}

function setupMenu() {
  const btn = document.querySelector('[data-menu-toggle]');
  const panel = document.getElementById('menu-panel');
  if (!btn || !panel) return;
  const set = (open) => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Tutup menu' : 'Buka menu');
  };
  btn.addEventListener('click', () => set(panel.hidden));
  panel.addEventListener('click', (e) => e.target.closest('a') && set(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !panel.hidden && (set(false), btn.focus()));
  document.addEventListener('click', (e) => !panel.hidden && !panel.contains(e.target) && !btn.contains(e.target) && set(false));
}

function setupBilling() {
  const buttons = document.querySelectorAll('[data-billing]');
  if (!buttons.length) return;
  const save = document.querySelector('[data-save]');
  const show = (which) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.billing === which));
    for (const el of document.querySelectorAll('[data-price]')) el.hidden = el.dataset.price !== which;
    if (save) save.hidden = which !== 'year' || Boolean(save.dataset.nosave) || !save.textContent;
  };
  for (const b of buttons) b.addEventListener('click', () => show(b.dataset.billing));
  show('month');
}

// Bar CTA melekat di phone: muncul selepas butang utama di hero keluar dari skrin.
function setupCtaBar() {
  const bar = document.querySelector('[data-cta-bar]');
  const anchor = document.querySelector('.hero-cta');
  if (!bar || !anchor || !('IntersectionObserver' in window)) return;
  new IntersectionObserver(([entry]) => {
    bar.classList.toggle('show', !entry.isIntersecting && entry.boundingClientRect.top < 0);
  }).observe(anchor);
}

setupTheme();
setupMenu();
setupBilling();
setupCtaBar();
bindInstallButtons();
registerServiceWorker();
fillSupport();
fillPlans();
demoLink();
