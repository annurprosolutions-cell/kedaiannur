// Panel superadmin /admin/ (F-13, S-16 hingga S-18). Desktop-first tetapi boleh digunakan di phone.
// Akses sebenar disemak di server pada setiap /api/admin/* (SUPERADMIN_EMAILS); UI ini hanya kemudahan.

import { api } from './api.js';
import { getConfig } from './config.js';
import { h, icon, toast } from './ui.js';
import { renderGoogleButton, googleSignOut } from './google.js';
import { formatBytes } from './forms.js';
import { formatSen } from './rules.js';
import { formatDate } from './plannotice.js';
import { barChart } from './chart.js';

const root = document.getElementById('admin');
let me = null;

const STATE_LABEL = { free: 'Percuma', active: 'Pro', ending: 'Pro (hampir tamat)', grace: 'Toleransi', expired: 'Pro tamat' };
const STATE_CLASS = { free: 'badge', active: 'badge badge-pro', ending: 'badge badge-warning', grace: 'badge badge-warning', expired: 'badge' };
const ACTION_LABEL = {
  set_plan: 'Tetapkan pelan', add_months: 'Tambah bulan', suspend: 'Gantung', unsuspend: 'Buka gantung',
  match_payment: 'Padankan bayaran', rename_slug: 'Tukar slug', rebuild_catalogs: 'Bina semula katalog',
  add_reserved_slug: 'Tambah slug reserved', remove_reserved_slug: 'Buang slug reserved',
  remind: 'Peringatan WhatsApp', market_hide: 'Sembunyi dari Marketplace', market_show: 'Papar di Marketplace',
  market_feature: 'Jadikan Pilihan Admin', market_unfeature: 'Buang Pilihan Admin', bcl_payment: 'Bayaran BCL', apply_unmatched: 'Bayaran awal diterapkan',
};

const planBadge = (st) => h('span', { class: STATE_CLASS[st.state] || 'badge' }, STATE_LABEL[st.state] || st.state);
const statusBadge = (s) => (s === 'suspended' ? h('span', { class: 'badge badge-danger' }, 'Digantung') : h('span', { class: 'badge' }, 'Aktif'));

function onError(err) {
  if (err && err.status === 401) {
    me = null;
    renderLogin();
    toast('Sila log masuk semula.', 'error');
    return;
  }
  toast((err && err.message) || 'Ralat tidak dijangka.', 'error');
}

// ---------------------------------------------------------------- boot dan login

async function boot() {
  root.replaceChildren(h('div', { class: 'admin-main' }, h('div', { class: 'skeleton', style: 'height:160px' })));
  try {
    me = await api('/api/me');
  } catch (err) {
    if (err.status !== 401) {
      root.replaceChildren(h('main', { class: 'login-page' }, h('div', { class: 'card login-card stack' }, h('p', { role: 'alert' }, err.message), h('button', { type: 'button', class: 'btn btn-block', onclick: boot }, 'Cuba semula'))));
      return;
    }
    me = null;
  }
  route();
}

function renderLogin() {
  document.title = 'Superadmin | Kedai AnnurPro';
  const slot = h('div', { class: 'gsi-slot' });
  const msg = h('p', { class: 'caption', role: 'alert' });
  root.replaceChildren(
    h('main', { class: 'login-page' }, h('div', { class: 'card login-card' }, h('h1', {}, 'Panel superadmin'), h('p', { class: 'muted' }, 'Log masuk dengan akaun Google superadmin.'), slot, msg)),
  );
  getConfig()
    .then((cfg) =>
      renderGoogleButton(slot, cfg.googleClientId, async (credential) => {
        msg.textContent = 'Sedang log masuk...';
        try {
          me = await api('/api/auth/google', { method: 'POST', body: { credential } });
          route();
        } catch (err) {
          msg.textContent = err.message;
        }
      }),
    )
    .catch(() => {
      msg.textContent = 'Butang Google tak dapat dimuatkan. Semak sambungan internet.';
    });
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    /* cookie tetap dibuang oleh server jika boleh */
  }
  googleSignOut();
  me = null;
  renderLogin();
}

function renderDenied() {
  document.title = 'Akses ditolak | Kedai AnnurPro';
  root.replaceChildren(
    h(
      'main',
      { class: 'login-page' },
      h(
        'div',
        { class: 'card login-card stack' },
        h('h1', {}, 'Akses ditolak'),
        h('p', { class: 'muted' }, `Akaun ${me.user.email} bukan superadmin.`),
        h('a', { class: 'btn btn-secondary btn-block', href: '/app/' }, 'Ke dashboard peniaga'),
        h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: logout }, 'Log keluar'),
      ),
    ),
  );
}

// ---------------------------------------------------------------- kerangka dan laluan

function shell(active, content) {
  const tab = (href, label, key) => h('a', { class: 'admin-tab', href, 'aria-current': active === key ? 'page' : null }, label);
  root.replaceChildren(
    h(
      'div',
      {},
      h(
        'header',
        { class: 'app-header' },
        h('a', { class: 'brand', href: '#/' }, h('img', { class: 'brand-mark', src: '/assets/brand/annurpro-mark-64.webp', alt: '', width: 28, height: 28 }), h('span', {}, 'Superadmin')),
        h('span', { class: 'admin-user caption' }, me.user.email, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: logout }, 'Log keluar')),
      ),
      h('nav', { class: 'admin-tabs', 'aria-label': 'Navigasi superadmin' }, tab('#/', 'Kedai', 'kedai'), tab('#/statistik', 'Statistik', 'statistik'), tab('#/selenggara', 'Bayaran dan penyelenggaraan', 'selenggara')),
      h('main', { class: 'admin-main stack' }, content),
    ),
  );
  window.scrollTo(0, 0);
}

function route() {
  if (!me) return renderLogin();
  if (!me.isAdmin) return renderDenied();
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (a === 'kedai' && b) return shell('kedai', viewShop(decodeURIComponent(b)));
  if (a === 'selenggara') return shell('selenggara', viewMaintenance());
  if (a === 'statistik') return shell('statistik', viewStats());
  return shell('kedai', viewShops());
}

window.addEventListener('hashchange', () => me && me.isAdmin && route());

function loading() {
  return h('div', { class: 'skeleton', style: 'height:200px' });
}

function errorBox(err, retry) {
  return h('div', { class: 'card stack' }, h('p', { role: 'alert' }, err.message), h('button', { type: 'button', class: 'btn', onclick: retry }, 'Cuba semula'));
}

// ---------------------------------------------------------------- S-16 senarai kedai

const listState = { q: '', plan: '', status: '', page: 1 };

function viewShops() {
  document.title = 'Kedai | Superadmin';
  const tiles = h('div', { class: 'tiles' });
  const results = h('div', { class: 'stack' }, loading());

  const q = h('input', { class: 'input', type: 'search', placeholder: 'Cari slug, nama kedai atau e-mel', 'aria-label': 'Cari kedai' });
  q.value = listState.q;
  const sel = (label, key, opts) => {
    const s = h('select', { class: 'input', 'aria-label': label }, opts.map(([v, t]) => h('option', { value: v }, t)));
    s.value = listState[key];
    s.addEventListener('change', () => {
      listState[key] = s.value;
      listState.page = 1;
      load();
    });
    return s;
  };
  let timer;
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      listState.q = q.value.trim();
      listState.page = 1;
      load();
    }, 300);
  });

  let seq = 0;
  async function load() {
    clearTimeout(timer);
    listState.q = q.value.trim(); // carian yang belum dihantar (debounce) ikut serta dengan tapisan
    const mine = ++seq;
    results.replaceChildren(loading());
    const params = new URLSearchParams({ q: listState.q, plan: listState.plan, status: listState.status, page: String(listState.page) });
    try {
      const data = await api(`/api/admin/shops?${params}`);
      if (mine !== seq) return; // jawapan lapuk: permintaan lebih baharu sudah dihantar
      renderTiles(data.summary);
      renderTable(data);
    } catch (err) {
      if (err.status === 401 || err.status === 403) return onError(err);
      results.replaceChildren(errorBox(err, load));
    }
  }

  function renderTiles(s) {
    const tile = (label, value, note) => h('div', { class: 'tile card' }, h('span', { class: 'tile-value' }, String(value)), h('span', { class: 'tile-label' }, label), note ? h('span', { class: 'caption' }, note) : null);
    tiles.replaceChildren(
      tile('Jumlah kedai', s.shops, `${s.newLast7Days} baharu dalam 7 hari`),
      tile('Pro aktif', s.paid, s.ending ? `${s.ending} tamat dalam 14 hari` : null),
      tile('Dalam toleransi', s.grace),
      tile('Percuma', s.free),
      tile('Digantung', s.suspended),
      tile('Pengguna', s.users, `${s.usersWithoutShop} belum siap kedai`),
    );
  }

  function renderTable(data) {
    if (!data.shops.length) {
      results.replaceChildren(h('p', { class: 'muted' }, 'Tiada kedai sepadan.'));
      return;
    }
    const rows = data.shops.map((s) =>
      h(
        'tr',
        {},
        h('td', {}, h('a', { href: `#/kedai/${encodeURIComponent(s.id)}`, class: 'row-link' }, s.name), h('span', { class: 'caption block' }, `/${s.slug}`)),
        h('td', {}, s.ownerEmail),
        h('td', {}, planBadge(s.planStatus), s.planExpiresAt ? h('span', { class: 'caption block' }, formatDate(s.planExpiresAt)) : null),
        h('td', { class: 'num' }, String(s.products)),
        h('td', {}, statusBadge(s.status), s.catalogDirty ? h('span', { class: 'badge badge-warning' }, 'Katalog gagal') : null),
        h('td', {}, formatDate(s.createdAt)),
      ),
    );
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    const prev = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: data.page <= 1 }, 'Sebelum');
    const next = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: data.page >= pages }, 'Seterusnya');
    prev.addEventListener('click', () => {
      listState.page -= 1;
      load();
    });
    next.addEventListener('click', () => {
      listState.page += 1;
      load();
    });
    results.replaceChildren(
      h(
        'div',
        { class: 'table-wrap card' },
        h(
          'table',
          { class: 'data-table' },
          h('thead', {}, h('tr', {}, ['Kedai', 'Pemilik', 'Pelan', 'Produk', 'Status', 'Dicipta'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, rows),
        ),
      ),
      h('div', { class: 'pager' }, prev, h('span', { class: 'caption' }, `Halaman ${data.page} daripada ${pages} (${data.total} kedai)`), next),
    );
  }

  load();
  return h(
    'div',
    { class: 'stack' },
    h('h1', {}, 'Kedai'),
    tiles,
    h(
      'div',
      { class: 'filters' },
      q,
      sel('Tapis pelan', 'plan', [['', 'Semua pelan'], ['free', 'Percuma'], ['pro', 'Pro']]),
      sel('Tapis status', 'status', [['', 'Semua status'], ['active', 'Aktif'], ['suspended', 'Digantung']]),
    ),
    results,
  );
}

// ---------------------------------------------------------------- S-17 butiran kedai

function viewShop(id) {
  const wrap = h('div', { class: 'stack' }, h('a', { class: 'back-link', href: '#/' }, '‹ Senarai kedai'), loading());

  async function load() {
    try {
      render(await api(`/api/admin/shops/${encodeURIComponent(id)}`));
    } catch (err) {
      if (err.status === 401 || err.status === 403) return onError(err);
      wrap.replaceChildren(h('a', { class: 'back-link', href: '#/' }, '‹ Senarai kedai'), errorBox(err, load));
    }
  }

  async function act(body, okText, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await api(`/api/admin/shops/${encodeURIComponent(id)}`, { method: 'PATCH', body });
      toast(okText, 'success');
      render(res);
    } catch (err) {
      if (btn) btn.disabled = false;
      if (err.code === 'katalog-gagal') {
        toast(err.message, 'error');
        return load();
      }
      onError(err);
    }
  }

  // Marketplace: status kelayakan, sembunyi (kandungan tak sesuai) dan "Pilihan Admin" (dipaparkan paling atas).
  function marketSection(s) {
    const m = s.market || { listed: false, issues: [] };
    const hidden = m.issues.some((t) => t.startsWith('Disembunyikan'));
    const btn = (label, action, ok, cls = 'btn btn-secondary') => h('button', { type: 'button', class: cls, onclick: (e) => act({ action }, ok, e.currentTarget) }, label);
    return h(
      'section',
      { class: 'card stack-sm' },
      h('h2', {}, 'Marketplace'),
      h('p', { class: 'muted' }, `${m.listed ? 'Dipaparkan' : 'Tidak dipaparkan'}${m.featured ? ' · Pilihan Admin' : ''}${s.category ? '' : ' · jenis kedai belum dipilih'}`),
      m.issues.length ? h('ul', { class: 'issue-list caption' }, m.issues.map((t) => h('li', {}, t))) : null,
      h(
        'div',
        { class: 'btn-row-3' },
        hidden ? btn('Papar semula', 'market_show', 'Kedai dipaparkan semula.') : btn('Sembunyikan', 'market_hide', 'Kedai disembunyikan dari Marketplace.', 'btn btn-danger'),
        m.featured ? btn('Buang Pilihan', 'market_unfeature', 'Pilihan Admin dibuang.') : btn('Pilihan Admin', 'market_feature', 'Kedai dijadikan Pilihan Admin.'),
      ),
    );
  }

  function render(d) {
    const s = d.shop;
    document.title = `${s.name} | Superadmin`;
    const info = (label, value) => h('div', { class: 'profile-row' }, h('span', { class: 'label' }, label), h('span', { class: 'value' }, value));

    // pelan
    const planSel = h('select', { class: 'input', id: 'a-plan' }, h('option', { value: 'free' }, 'Percuma'), h('option', { value: 'pro' }, 'Pro'));
    planSel.value = s.planCode;
    const dateIn = h('input', { class: 'input', type: 'date', id: 'a-expiry' });
    dateIn.value = s.planExpiresAt || '';
    const syncDate = () => {
      dateIn.disabled = planSel.value === 'free';
    };
    planSel.addEventListener('change', syncDate);
    syncDate();
    const setBtn = h('button', { type: 'button', class: 'btn' }, 'Simpan pelan');
    setBtn.addEventListener('click', () => {
      if (planSel.value !== 'free' && !dateIn.value) return toast('Pilih tarikh tamat untuk pelan Pro.', 'error');
      act({ action: 'set_plan', planCode: planSel.value, expiresAt: planSel.value === 'free' ? null : dateIn.value }, 'Pelan dikemas kini.', setBtn);
    });
    const addBtns = [1, 3, 12].map((m) => {
      const b = h('button', { type: 'button', class: 'btn btn-secondary' }, `+${m} bulan`);
      b.addEventListener('click', () => act({ action: 'add_months', months: m }, `${m} bulan ditambah.`, b));
      return b;
    });

    // gantung
    const reason = h('textarea', { class: 'input', id: 'a-reason', rows: 2, maxlength: 200, placeholder: 'Contoh: meniru jenama bank' });
    const suspendBlock =
      s.status === 'suspended'
        ? h(
            'div',
            { class: 'stack-sm' },
            h('p', { class: 'notice notice-danger' }, `Digantung. Sebab: ${s.suspendedReason || '-'}`),
            h('button', { type: 'button', class: 'btn', onclick: (e) => act({ action: 'unsuspend' }, 'Gantungan dibuka.', e.currentTarget) }, 'Buka gantung'),
          )
        : h(
            'div',
            { class: 'stack-sm' },
            h('label', { for: 'a-reason', class: 'd-label' }, 'Sebab gantung (dipaparkan kepada peniaga)'),
            reason,
            h('button', {
              type: 'button', class: 'btn btn-danger',
              onclick: (e) => {
                if (!reason.value.trim()) return toast('Nyatakan sebab gantung.', 'error');
                if (!window.confirm(`Gantung "${s.name}"? Halaman kedai awam akan ditutup.`)) return;
                act({ action: 'suspend', reason: reason.value }, 'Kedai digantung.', e.currentTarget);
              },
            }, 'Gantung kedai'),
          );

    const payments = d.payments.length
      ? h('ul', { class: 'pay-list' }, d.payments.map((p) => h('li', {}, h('span', {}, `${formatDate(p.createdAt)} · ${p.orderNo} · ${p.period === 'yearly' ? 'Tahunan' : 'Bulanan'} x${p.quantity} · +${p.monthsAdded} bulan`), h('strong', {}, formatSen(p.amountSen)))))
      : h('p', { class: 'muted' }, 'Tiada bayaran.');
    const auditList = d.audit.length
      ? h('ul', { class: 'audit-list' }, d.audit.map((a) => h('li', {}, h('span', { class: 'caption' }, `${a.createdAt} · ${a.actor}`), h('span', {}, ACTION_LABEL[a.action] || a.action, a.meta ? h('code', { class: 'audit-meta' }, JSON.stringify(a.meta)) : null))))
      : h('p', { class: 'muted' }, 'Tiada rekod.');

    wrap.replaceChildren(
      h('a', { class: 'back-link', href: '#/' }, '‹ Senarai kedai'),
      h('div', { class: 'shop-head' }, h('h1', {}, s.name), h('span', {}, planBadge(s.planStatus), ' ', statusBadge(s.status))),
      h(
        'div',
        { class: 'admin-grid' },
        h(
          'section',
          { class: 'card stack-sm' },
          h('h2', {}, 'Maklumat'),
          info('Link', h('a', { href: `/${s.slug}`, target: '_blank', rel: 'noopener' }, `/${s.slug}`)),
          info('Pemilik', `${s.ownerName || '-'} (${s.ownerEmail})`),
          info('Log masuk terakhir', s.ownerLastLogin || '-'),
          info('WhatsApp', s.whatsapp),
          info('Dicipta', s.createdAt),
          info('Penggunaan', `${s.products} produk, ${s.categories} kategori, ${s.banners} banner, ${formatBytes(s.storageBytes)}`),
          info('Kedai', s.isOpen ? 'Buka' : 'Tutup'),
          s.catalogDirty ? h('p', { class: 'notice notice-warning' }, 'Katalog awam gagal dikemas kini. Bina semula di tab Bayaran dan penyelenggaraan.') : null,
        ),
        h(
          'section',
          { class: 'card stack-sm' },
          h('h2', {}, 'Pelan'),
          h('p', { class: 'muted' }, s.planExpiresAt ? `Tamat ${formatDate(s.planExpiresAt)} (status: ${STATE_LABEL[s.planStatus.state]})` : 'Pelan Percuma.'),
          h('div', { class: 'field' }, h('label', { for: 'a-plan' }, 'Pelan'), planSel),
          h('div', { class: 'field' }, h('label', { for: 'a-expiry' }, 'Tarikh tamat'), dateIn),
          setBtn,
          h('p', { class: 'd-label' }, 'Tambah bulan Pro (dari tarikh tamat jika masih aktif, jika tidak dari hari ini)'),
          h('div', { class: 'btn-row-3' }, addBtns),
        ),
        h('section', { class: 'card stack-sm' }, h('h2', {}, 'Gantung'), suspendBlock),
        marketSection(s),
        h('section', { class: 'card stack-sm' }, h('h2', {}, 'Bayaran'), payments),
      ),
      h('section', { class: 'card stack-sm' }, h('h2', {}, 'Audit log'), auditList),
    );
  }

  load();
  return wrap;
}

// ---------------------------------------------------------------- S-18 bayaran dan penyelenggaraan

function viewMaintenance() {
  document.title = 'Penyelenggaraan | Superadmin';
  const payBox = h('div', { class: 'stack' }, loading());
  const slugBox = h('div', { class: 'stack-sm' }, loading());
  const rebuildMsg = h('p', { class: 'caption', 'aria-live': 'polite' });

  async function loadPayments() {
    try {
      const { payments } = await api('/api/admin/payments?status=unmatched');
      if (!payments.length) return payBox.replaceChildren(h('p', { class: 'muted' }, 'Tiada bayaran tak padan.'));
      payBox.replaceChildren(
        ...payments.map((p) => {
          const slugIn = h('input', { class: 'input', type: 'text', placeholder: 'Slug kedai', 'aria-label': `Slug kedai untuk ${p.orderNo}` });
          const monthsIn = h('input', { class: 'input', type: 'number', min: 1, max: 120, 'aria-label': `Bilangan bulan untuk ${p.orderNo}` });
          monthsIn.value = p.period === 'yearly' ? String(12 * p.quantity) : p.period === 'monthly' ? String(p.quantity) : '';
          const go = h('button', { type: 'button', class: 'btn' }, 'Padankan');
          go.addEventListener('click', async () => {
            const slug = slugIn.value.trim().toLowerCase();
            if (!slug) return toast('Masukkan slug kedai.', 'error');
            go.disabled = true;
            try {
              const found = await api(`/api/admin/shops?q=${encodeURIComponent(slug)}`);
              const shop = found.shops.find((s) => s.slug === slug);
              if (!shop) throw new Error(`Kedai /${slug} tak dijumpai.`);
              if (!window.confirm(`Padankan ${p.orderNo} (${formatSen(p.amountSen)}) dengan "${shop.name}" dan tambah ${monthsIn.value} bulan?`)) {
                go.disabled = false;
                return;
              }
              const res = await api(`/api/admin/payments/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: { shopId: shop.id, months: Number(monthsIn.value) } });
              toast(`Dipadankan. Pro tamat ${formatDate(res.planExpiresAt)}.`, 'success');
              loadPayments();
            } catch (err) {
              go.disabled = false;
              onError(err);
            }
          });
          return h(
            'div',
            { class: 'card stack-sm' },
            h('div', { class: 'shop-head' }, h('strong', {}, p.orderNo), h('strong', {}, formatSen(p.amountSen))),
            h('p', { class: 'caption' }, `${formatDate(p.createdAt)} · e-mel pembayar: ${p.payerEmail || '-'} · ${p.period || 'tempoh tak diketahui'} x${p.quantity}`),
            h('div', { class: 'match-row' }, slugIn, monthsIn, go),
          );
        }),
      );
    } catch (err) {
      if (err.status === 401 || err.status === 403) return onError(err);
      payBox.replaceChildren(errorBox(err, loadPayments));
    }
  }

  async function loadSlugs() {
    try {
      const { slugs } = await api('/api/admin/reserved-slugs');
      const addIn = h('input', { class: 'input', type: 'text', placeholder: 'Contoh: maybank', 'aria-label': 'Slug reserved baharu' });
      const addBtn = h('button', { type: 'button', class: 'btn' }, 'Tambah');
      addBtn.addEventListener('click', async () => {
        if (!addIn.value.trim()) return;
        try {
          const r = await api('/api/admin/reserved-slugs', { method: 'POST', body: { slug: addIn.value } });
          toast(r.warning || (r.added ? `"${r.slug}" ditambah.` : `"${r.slug}" sudah ada.`), r.warning ? 'info' : 'success');
          loadSlugs();
        } catch (err) {
          onError(err);
        }
      });
      slugBox.replaceChildren(
        h('div', { class: 'add-row' }, addIn, addBtn),
        h(
          'div',
          { class: 'chips chips-wrap' },
          slugs.map((sl) =>
            h('span', { class: 'chip slug-chip' }, sl, h('button', {
              type: 'button', class: 'slug-x', 'aria-label': `Buang ${sl}`,
              onclick: async () => {
                if (!window.confirm(`Buang "${sl}" daripada senarai reserved?`)) return;
                try {
                  await api(`/api/admin/reserved-slugs/${encodeURIComponent(sl)}`, { method: 'DELETE' });
                  loadSlugs();
                } catch (err) {
                  onError(err);
                }
              },
            }, icon('tutup'))),
          ),
        ),
        h('p', { class: 'caption' }, `${slugs.length} slug reserved.`),
      );
    } catch (err) {
      if (err.status === 401 || err.status === 403) return onError(err);
      slugBox.replaceChildren(errorBox(err, loadSlugs));
    }
  }

  async function rebuild(onlyDirty, btns) {
    btns.forEach((b) => (b.disabled = true));
    let after = null;
    let done = 0;
    const failed = [];
    try {
      do {
        const r = await api('/api/admin/rebuild-catalogs', { method: 'POST', body: { onlyDirty, after } });
        done += r.processed;
        failed.push(...r.failed);
        after = r.next;
        rebuildMsg.textContent = `${done} katalog dibina semula...`;
      } while (after);
      rebuildMsg.textContent = failed.length ? `${done} diproses. Gagal: ${failed.join(', ')}` : `Selesai: ${done} katalog dibina semula.`;
      toast('Bina semula selesai.', failed.length ? 'error' : 'success');
    } catch (err) {
      onError(err);
    } finally {
      btns.forEach((b) => (b.disabled = false));
    }
  }

  const dirtyBtn = h('button', { type: 'button', class: 'btn' }, 'Bina semula yang gagal sahaja');
  const allBtn = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Bina semula semua');
  dirtyBtn.addEventListener('click', () => rebuild(true, [dirtyBtn, allBtn]));
  allBtn.addEventListener('click', () => {
    if (window.confirm('Bina semula katalog semua kedai? Ini menggunakan kuota Functions dan R2.')) rebuild(false, [dirtyBtn, allBtn]);
  });

  loadPayments();
  loadSlugs();
  return h(
    'div',
    { class: 'stack' },
    h('h1', {}, 'Bayaran dan penyelenggaraan'),
    h('section', { class: 'card stack' }, h('h2', {}, 'Bayaran tak padan'), h('p', { class: 'caption' }, 'Bayaran yang e-mel pembayarnya tiada kedai. Padankan dengan kedai yang betul untuk menambah bulan Pro.'), payBox),
    h('section', { class: 'card stack' }, h('h2', {}, 'Slug reserved'), h('p', { class: 'caption' }, 'Slug ini tak boleh digunakan untuk kedai baharu atau tukar slug. Kedai sedia ada tak terjejas.'), slugBox),
    h('section', { class: 'card stack-sm' }, h('h2', {}, 'Katalog awam'), h('p', { class: 'caption' }, 'Bina semula catalog/<slug>.json dari D1. Gunakan bila katalog gagal dikemas kini atau selepas ubah had pelan dalam jadual plans.'), h('div', { class: 'btn-row' }, dirtyBtn, allBtn), rebuildMsg),
  );
}

boot();

// ---------------------------------------------------------------- statistik dan peringatan tamat (S-16b)

const CHART_SHOPS = '#0d9488'; // disahkan dengan validator dataviz (lightness, chroma, kontras atas putih)
const CHART_REVENUE = '#d97706';
const shortDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const ringgitShort = (sen) => (sen >= 100000 ? `RM${Math.round(sen / 100000) / 10}K` : `RM${Math.round(sen / 100)}`);

function reminderText(r) {
  const date = formatDate(r.expiresAt);
  const link = `${location.origin}/app/#/langganan`;
  const when = r.state === 'grace' || r.state === 'expired' ? `telah tamat pada ${date}` : `akan tamat pada ${date}`;
  return `Salam. Ini dari Kedai AnnurPro. Langganan Pro untuk kedai ${r.name} (${location.host}/${r.slug}) ${when}. ` +
    `Perbaharui di ${link} supaya produk, banner dan ciri Pro kekal dipaparkan. Terima kasih.`;
}

function viewStats() {
  const wrap = h('div', { class: 'stack' }, h('h1', {}, 'Statistik'), loading());
  async function load() {
    try {
      render(await api('/api/admin/stats'));
    } catch (err) {
      if (err.status === 401) return onError(err);
      wrap.replaceChildren(h('h1', {}, 'Statistik'), errorBox(err, load));
    }
  }
  function render(d) {
    const t = d.totals;
    const tile = (label, value, note) => h('div', { class: 'tile card' }, h('span', { class: 'tile-value' }, String(value)), h('span', { class: 'tile-label' }, label), note ? h('span', { class: 'caption' }, note) : null);
    const shops30 = d.days.reduce((a, x) => a + x.shops, 0);
    const users30 = d.days.reduce((a, x) => a + x.users, 0);

    const remindList = d.ending.length
      ? h(
          'ul',
          { class: 'remind-list' },
          d.ending.map((r) => {
            const note = h('span', { class: 'caption' }, r.remindedAt ? `Diingatkan ${formatDate(r.remindedAt)}` : 'Belum diingatkan');
            const wa = h(
              'a',
              { class: 'btn btn-wa btn-sm', href: `https://wa.me/${r.whatsapp}?text=${encodeURIComponent(reminderText(r))}`, target: '_blank', rel: 'noopener' },
              icon('whatsapp'),
              h('span', {}, 'Ingatkan'),
            );
            wa.addEventListener('click', () => {
              // Rekod tanpa menghalang pembukaan WhatsApp.
              fetch(`/api/admin/shops/${encodeURIComponent(r.id)}/remind`, {
                method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: '{}',
              }).then(() => { note.textContent = 'Diingatkan hari ini'; }, () => {});
            });
            return h(
              'li',
              { class: 'card remind-item' },
              h(
                'div',
                { class: 'remind-info' },
                h('a', { href: `#/kedai/${encodeURIComponent(r.id)}`, class: 'remind-name' }, r.name),
                h('div', { class: 'caption' }, `/${r.slug} · tamat ${formatDate(r.expiresAt)}`),
                h('div', { class: 'remind-meta' }, planBadge({ state: r.state }), note),
              ),
              wa,
            );
          }),
        )
      : h('p', { class: 'muted' }, 'Tiada Pro yang tamat dalam 14 hari atau dalam tempoh toleransi.');

    wrap.replaceChildren(
      h('h1', {}, 'Statistik'),
      h(
        'div',
        { class: 'tiles' },
        tile('Jumlah kedai', t.shops, `${shops30} baharu dalam 30 hari`),
        tile('Pro aktif', t.paid, `${t.conversionPct}% daripada semua kedai`),
        tile('Hasil 30 hari', formatSen(t.revenue30Sen).replace(/\.00$/, '')),
        tile('Hasil keseluruhan', formatSen(t.revenueAllSen).replace(/\.00$/, ''), `${t.paymentsAll} bayaran`),
        tile('Pengguna baharu', users30, 'dalam 30 hari'),
      ),
      h(
        'section',
        { class: 'card stack-sm' },
        h('h2', {}, 'Kedai baharu sehari'),
        h('p', { class: 'caption' }, '30 hari terakhir, waktu Malaysia.'),
        barChart({ title: 'Kedai baharu sehari, 30 hari', color: CHART_SHOPS, data: d.days.map((x) => ({ label: shortDate(x.date), value: x.shops })), format: (v) => `${v} kedai`, axisFormat: String, tableHead: ['Tarikh', 'Kedai baharu'], integer: true }),
      ),
      h(
        'section',
        { class: 'card stack-sm' },
        h('h2', {}, 'Hasil langganan sehari'),
        h('p', { class: 'caption' }, 'Bayaran BCL yang diterapkan (jumlah sebelum yuran gateway), 30 hari terakhir.'),
        barChart({ title: 'Hasil langganan sehari, 30 hari', color: CHART_REVENUE, data: d.days.map((x) => ({ label: shortDate(x.date), value: x.revenueSen })), format: formatSen, axisFormat: ringgitShort, tableHead: ['Tarikh', 'Hasil'] }),
      ),
      h(
        'section',
        { class: 'card stack-sm' },
        h('h2', {}, 'Pro hampir tamat atau dalam toleransi'),
        h('p', { class: 'caption' }, 'Tekan Ingatkan untuk buka WhatsApp dengan mesej siap ke nombor kedai. Tindakan direkod dalam log audit.'),
        remindList,
      ),
    );
  }
  load();
  return wrap;
}
