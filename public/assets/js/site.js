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

// Seksyen "Artikel terkini" di landing page: diisi dari /api/articles, kekal tersembunyi jika tiada artikel atau API gagal.
async function homeArticles() {
  const section = document.querySelector('[data-home-articles]');
  const list = document.querySelector('[data-home-articles-list]');
  if (!section || !list) return;
  try {
    const { articles } = await getJson('/api/articles?limit=3');
    if (!articles || !articles.length) return;
    const el = (tag, attrs = {}, text) => {
      const n = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text != null) n.textContent = text;
      return n;
    };
    list.replaceChildren(
      ...articles.map((a) => {
        const li = el('li', { class: 'card article-card' });
        const href = `/artikel/${encodeURIComponent(a.slug)}`;
        const media = el('a', { href, tabindex: '-1', 'aria-hidden': 'true' });
        if (a.cover) media.append(el('img', { class: 'article-thumb', src: a.cover, alt: '', loading: 'lazy', decoding: 'async', width: '1200', height: '630' }));
        else media.append(el('span', { class: 'article-thumb-ph' }, 'A'));
        const body = el('div', { class: 'article-card-body' });
        const link = el('a', { href });
        link.append(el('h3', {}, a.title));
        body.append(link, el('p', { class: 'muted' }, a.description));
        li.append(media, body);
        return li;
      }),
    );
    section.hidden = false;
  } catch {
    /* seksyen kekal tersembunyi */
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

// Animasi ketika scroll: bahagian muncul (naik, zum) bila masuk skrin, kad muncul berturutan, dan phone di hero
// bergerak perlahan (parallax). Dimatikan sepenuhnya untuk prefers-reduced-motion; tanpa JS semua kandungan kelihatan.
function setupMotion() {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );
  for (const group of document.querySelectorAll('[data-stagger]')) {
    [...group.children].forEach((child, i) => {
      if (!child.hasAttribute('data-reveal')) child.setAttribute('data-reveal', group.dataset.stagger || 'up');
      child.style.setProperty('--d', `${Math.min(i, 6) * 90}ms`);
    });
  }
  document.documentElement.classList.add('motion'); // biasanya sudah ditanda oleh theme.js dalam <head>
  window.kedaiMotionReady = true;
  for (const el of document.querySelectorAll('[data-reveal]')) io.observe(el);

  const device = document.querySelector('.device-wrap');
  if (device) {
    let ticking = false;
    window.addEventListener(
      'scroll',
      () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(() => {
          device.style.setProperty('--py', `${Math.round(Math.min(window.scrollY, 900) * -0.08)}px`);
          ticking = false;
        });
      },
      { passive: true },
    );
  }
}

setupTheme();
setupMotion();
setupMenu();
setupBilling();
setupCtaBar();
bindInstallButtons();
registerServiceWorker();
fillSupport();
fillPlans();
demoLink();
homeArticles();
