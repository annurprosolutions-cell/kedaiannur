// Halaman awam statik (landing, privasi, terma): isi e-mel sokongan, harga pelan dan pautan kedai contoh.
// Semua elemen ada teks lalai dalam HTML, jadi halaman tetap lengkap jika skrip atau API gagal.

import { formatSen } from './rules.js';

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

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
        month: formatSen(p.priceMonthSen).replace(/\.00$/, ''),
        year: formatSen(p.priceYearSen).replace(/\.00$/, ''),
        products: String(p.maxProducts),
        categories: String(p.maxCategories),
        banners: String(p.maxBanners),
        storage: `${Math.round(p.maxStorageBytes / 1048576)} MB`,
      }[field];
      if (v) el.textContent = v;
    }
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

fillSupport();
fillPlans();
demoLink();
