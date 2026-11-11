// Notis langganan (IPD 5.3) untuk S-09 dan S-14. Keadaan dikira di server (lib/plan.js planStatus).

import { h } from './ui.js';

// '2026-12-31' -> '31/12/2026'
export function formatDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function planBadge(shop) {
  const st = shop.planStatus ? shop.planStatus.state : 'free';
  if (st === 'grace') return h('span', { class: 'badge badge-warning' }, 'Toleransi');
  if (st === 'active' || st === 'ending') return h('span', { class: 'badge badge-pro' }, shop.plan.name);
  return h('span', { class: 'badge' }, shop.plan.name);
}

export function planNotice(shop, { withLink = true } = {}) {
  const st = shop.planStatus;
  if (!st || st.state === 'free' || st.state === 'active') return null;
  const link = withLink ? h('a', { href: '#/langganan' }, 'Lihat langganan') : null;
  if (st.state === 'ending') {
    const when = st.daysLeft === 0 ? 'hari ini' : `dalam ${st.daysLeft} hari (${formatDate(st.expiresAt)})`;
    return h(
      'p',
      { class: st.daysLeft <= 3 ? 'notice notice-danger' : 'notice notice-warning', role: 'status' },
      `Langganan Pro tamat ${when}. Perbaharui supaya ciri Pro tak terhenti. `,
      link,
    );
  }
  if (st.state === 'grace') {
    return h(
      'p',
      { class: 'notice notice-warning', role: 'status' },
      `Langganan Pro tamat pada ${formatDate(st.expiresAt)}. Ciri Pro kekal sehingga ${formatDate(st.graceEndsAt)} (tempoh toleransi), selepas itu kedai turun ke pelan Percuma. `,
      link,
    );
  }
  // expired: hanya relevan jika kedai pernah Pro
  return h(
    'p',
    { class: 'notice notice-warning', role: 'status' },
    `Langganan Pro sudah tamat pada ${formatDate(st.expiresAt)}. Kedai kini mengikut had pelan Percuma. Data tak dipadam. `,
    link,
  );
}

// Data melebihi had pelan efektif: disimpan tetapi tak dipaparkan di katalog awam.
export function hiddenNotice(shop) {
  const u = shop.usage;
  if (!u) return null;
  const p = shop.plan;
  const parts = [];
  if (u.products > p.maxProducts) parts.push(`${u.products - p.maxProducts} produk`);
  if (u.categories > p.maxCategories) parts.push(`${u.categories - p.maxCategories} kategori`);
  if (u.banners > p.maxBanners) parts.push(`${u.banners - p.maxBanners} banner`);
  if (!parts.length) return null;
  return h(
    'p',
    { class: 'notice notice-warning', role: 'status' },
    `${parts.join(', ')} tidak dipaparkan di kedai awam kerana melebihi had pelan ${p.name}. Data tak dipadam; naik taraf ke Pro untuk paparkan semula.`,
  );
}
