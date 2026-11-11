// Halaman kedai awam (S-02 hingga S-06): banner, carian, kategori, grid produk, butiran produk, troli dan
// semak sebelum hantar ke WhatsApp. Data datang daripada:
//   1. JSON yang disuntik oleh functions/[slug].js (biasa), atau
//   2. fallback 404.html bila Functions tak berjalan: slug daripada URL, snapshot dari domain media.
// Semua teks kedai dan produk melalui textContent (h()), tak pernah innerHTML.

import { h, icon, toast } from './ui.js';
import { DEFAULT_THEME, formatSen, isReservedLocally, isThemeColor, normalizeSlug, slugFormatError } from './rules.js';
import {
  ORDER_LIMITS, addToCart, buildMessage, loadCart, reconcile, removeLine, saveCart, setNote, setQty, summarize, waLink,
} from './order.js';

const root = document.getElementById('shop');

// Element.append(null) menulis teks "null"; buang nilai kosong dahulu.
function appendAll(parent, ...children) {
  parent.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
}

function safeStorage() {
  try {
    const s = window.localStorage;
    s.getItem('x');
    return s;
  } catch {
    // Mod peribadi atau storan disekat: troli hanya kekal selagi halaman dibuka.
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  }
}
const store = safeStorage();

function readPageData() {
  try {
    return JSON.parse(document.getElementById('page-data').textContent);
  } catch {
    return null;
  }
}

function metaMediaBase() {
  const m = document.querySelector('meta[name="media-base"]');
  return m ? m.content.replace(/\/+$/, '') : '';
}

function state(title, text, actions = []) {
  root.removeAttribute('aria-busy');
  root.replaceChildren(h('main', { class: 'shop-wrap shop-state' }, icon('kedai'), h('h1', {}, title), h('p', { class: 'muted' }, text), ...actions));
}

const homeLink = () => h('a', { class: 'btn btn-secondary', href: '/' }, 'Ke laman utama');

async function boot() {
  let page = readPageData();
  if (!page) {
    // Fallback: 404.html dihidang untuk laluan yang Functions tak tangkap.
    const parts = location.pathname.split('/').filter(Boolean);
    let slug = '';
    try {
      slug = parts.length === 1 ? normalizeSlug(decodeURIComponent(parts[0])) : '';
    } catch {
      slug = '';
    }
    if (!slug || slugFormatError(slug) || isReservedLocally(slug)) {
      document.title = 'Halaman tidak dijumpai | Kedai AnnurPro';
      return state('Halaman tidak dijumpai', 'Link ini mungkin salah taip.', [homeLink()]);
    }
    page = { slug, media: metaMediaBase(), report: '', catalog: null };
    try {
      const res = await fetch(`${page.media}/catalog/${slug}.json`, { cache: 'no-cache' });
      if (res.status === 404 || res.status === 403) page.missing = true;
      else if (!res.ok) throw new Error(String(res.status));
      else page.catalog = await res.json();
    } catch {
      return state('Kedai tak dapat dimuatkan', 'Semak sambungan internet dan cuba lagi.', [
        h('button', { type: 'button', class: 'btn', onclick: () => location.reload() }, 'Cuba semula'),
      ]);
    }
  }
  if (page.missing || !page.catalog) {
    document.title = 'Kedai tak dijumpai | Kedai AnnurPro';
    return state('Kedai tak dijumpai', 'Link ini mungkin salah, atau kedai ini sudah tidak aktif.', [homeLink()]);
  }
  start(page);
}

// ================================================================ kedai

function start(page) {
  const { catalog, slug } = page;
  const shop = catalog.shop;
  const media = page.media || metaMediaBase();
  const items = Array.isArray(catalog.items) ? catalog.items : [];
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const cats = (catalog.cats || []).filter((c) => items.some((i) => i.c === c.id));
  const open = shop.open !== false;
  const theme = isThemeColor(String(shop.theme || '').toUpperCase()) ? shop.theme.toUpperCase() : DEFAULT_THEME;
  document.documentElement.style.setProperty('--theme', theme);
  if (!document.title || document.title.startsWith('Kedai |')) document.title = shop.name;

  const imgUrl = (key) => (typeof key === 'string' && /^[\w/.-]+$/.test(key) && !key.includes('..') && media ? `${media}/${key}` : '');

  let cart = loadCart(store, slug);
  const removed = reconcile(cart, itemsById);
  if (removed.length) {
    saveCart(store, slug, cart);
    setTimeout(() => toast(`Dibuang dari troli kerana habis atau tiada lagi: ${removed.join(', ')}`, 'info'), 300);
  }
  const persist = () => {
    saveCart(store, slug, cart);
    renderCartBar();
  };

  const filter = { q: '', cat: '' };

  // ---------------- kepala kedai
  const banner = catalog.banners && catalog.banners[0] ? imgUrl(catalog.banners[0].k) : '';
  const header = h(
    'header',
    { class: 'shop-head' },
    banner ? h('img', { class: 'shop-banner', src: banner, alt: shop.name, width: 1600, height: 800, fetchpriority: 'high' }) : null,
    h(
      'div',
      { class: 'shop-wrap shop-title' },
      h('h1', {}, shop.name),
      shop.desc ? h('p', { class: 'shop-desc muted' }, shop.desc) : null,
      open ? null : h('p', { class: 'notice notice-warning', role: 'status' }, 'Kedai sedang tutup. Order tak dapat dihantar buat masa ini.'),
    ),
  );

  // ---------------- carian dan kategori
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Cari produk', 'aria-label': 'Cari produk', autocomplete: 'off' });
  search.addEventListener('input', () => {
    filter.q = search.value.trim().toLowerCase();
    renderGrid();
  });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Tapis ikut kategori' });
  function renderChips() {
    const opts = [['', 'Semua'], ...cats.map((c) => [c.id, c.n])];
    chips.replaceChildren(
      ...opts.map(([id, label]) => {
        const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(filter.cat === id) }, label);
        b.addEventListener('click', () => {
          filter.cat = id;
          renderChips();
          renderGrid();
        });
        return b;
      }),
    );
  }

  // ---------------- grid produk
  const grid = h('ul', { class: 'shop-grid', 'aria-label': 'Produk' });
  const emptyMsg = h('p', { class: 'muted shop-empty', hidden: true });

  function priceEl(item) {
    return Number.isInteger(item.p) ? h('span', { class: 'p-price' }, formatSen(item.p)) : h('span', { class: 'p-price p-ask' }, 'Hubungi untuk harga');
  }

  function thumb(item, cls, key) {
    const url = imgUrl(key);
    return url
      ? h('img', { class: cls, src: url, alt: '', loading: 'lazy', decoding: 'async', width: 400, height: 400 })
      : h('span', { class: `${cls} p-ph`, 'aria-hidden': 'true' }, icon('gambar'));
  }

  function renderGrid() {
    const list = items.filter((i) => (!filter.cat || i.c === filter.cat) && (!filter.q || i.n.toLowerCase().includes(filter.q)));
    grid.replaceChildren(
      ...list.map((item) => {
        const add = h('button', {
          type: 'button', class: 'p-add', 'aria-label': `Tambah ${item.n} ke troli`, disabled: !open || !item.a,
        }, icon('tambah'));
        add.addEventListener('click', () => quickAdd(item));
        const card = h(
          'button',
          { type: 'button', class: 'p-open', 'aria-label': `Lihat ${item.n}` },
          h('span', { class: 'p-img-wrap' }, thumb(item, 'p-img', item.t), item.a ? null : h('span', { class: 'p-sold' }, 'Habis')),
          h('span', { class: 'p-name' }, item.n),
          priceEl(item),
        );
        card.addEventListener('click', () => openDetail(item));
        return h('li', { class: item.a ? 'p-card' : 'p-card sold-out' }, card, add);
      }),
    );
    emptyMsg.hidden = list.length > 0;
    emptyMsg.textContent = items.length ? 'Tiada produk sepadan.' : 'Kedai ini belum ada produk.';
  }

  function quickAdd(item, qty = 1, note = '') {
    const r = addToCart(cart, item.id, qty, note);
    if (!r.ok) {
      toast(r.reason === 'had-item' ? `Troli penuh (maksimum ${ORDER_LIMITS.maxLines} item berbeza).` : `Maksimum ${ORDER_LIMITS.maxQty} unit setiap item.`, 'error');
      return false;
    }
    persist();
    toast(`Ditambah: ${item.n}`, 'success');
    return true;
  }

  // ---------------- bar troli
  const cartBar = h('button', { type: 'button', class: 'cart-bar', hidden: true });
  cartBar.addEventListener('click', openCart);
  function renderCartBar() {
    const s = summarize(cart, itemsById);
    cartBar.hidden = !open || s.count === 0;
    cartBar.replaceChildren(
      icon('troli'),
      h('span', { class: 'cart-count' }, `${s.count} item`),
      h('span', { class: 'cart-total' }, s.lines.some((l) => l.lineSen !== null) ? `${formatSen(s.totalSen)}${s.hasUnpriced ? ' +' : ''}` : ''),
      h('span', { class: 'cart-go' }, 'Lihat troli'),
    );
  }

  // ---------------- lembaran bawah (bottom sheet)
  let closeCurrent = null;
  function openSheet(label, build) {
    if (closeCurrent) closeCurrent();
    const prevFocus = document.activeElement;
    const body = h('div', { class: 'sheet-body' });
    const closeBtn = h('button', { type: 'button', class: 'icon-btn sheet-close', 'aria-label': 'Tutup' }, icon('tutup'));
    const overlay = h('div', { class: 'sheet-overlay' });
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }), closeBtn, body);
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    function close() {
      overlay.remove();
      sheet.remove();
      document.body.classList.remove('sheet-open');
      document.removeEventListener('keydown', onKey);
      closeCurrent = null;
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    }
    overlay.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    build(body, close);
    document.body.append(overlay, sheet);
    document.body.classList.add('sheet-open');
    closeCurrent = close;
    sheet.setAttribute('tabindex', '-1');
    sheet.focus({ preventScroll: true });
    return close;
  }

  function stepper(value, onChange, label) {
    const out = h('span', { class: 'qty-val', 'aria-live': 'polite' }, String(value));
    const minus = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Kurangkan ${label}` }, icon('tolak'));
    const plus = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Tambah ${label}` }, icon('tambah'));
    minus.addEventListener('click', () => onChange(-1));
    plus.addEventListener('click', () => onChange(1));
    return { el: h('span', { class: 'qty' }, minus, out, plus), set: (v) => (out.textContent = String(v)), minus, plus };
  }

  // ---------------- S-03 butiran produk
  function openDetail(item) {
    openSheet(item.n, (body, close) => {
      let qty = 1;
      const note = h('input', { class: 'input', type: 'text', maxlength: ORDER_LIMITS.itemNoteMax, placeholder: 'Contoh: tak pedas', id: 'd-note', autocomplete: 'off' });
      const addBtn = h('button', { type: 'button', class: 'btn btn-theme btn-block', disabled: !open || !item.a });
      const refresh = () => {
        if (!item.a) addBtn.textContent = 'Habis stok';
        else if (!open) addBtn.textContent = 'Kedai sedang tutup';
        else addBtn.textContent = Number.isInteger(item.p) ? `Tambah ke troli · ${formatSen(item.p * qty)}` : 'Tambah ke troli';
      };
      const st = stepper(qty, (d) => {
        qty = Math.min(ORDER_LIMITS.maxQty, Math.max(1, qty + d));
        st.set(qty);
        refresh();
      }, item.n);
      addBtn.addEventListener('click', () => {
        if (quickAdd(item, qty, note.value)) close();
      });
      refresh();
      appendAll(body, 
        thumb(item, 'd-img', item.i || item.t),
        h('h2', { class: 'd-name' }, item.n),
        priceEl(item),
        item.d ? h('p', { class: 'd-desc' }, item.d) : null,
        item.a && open
          ? h(
              'div',
              { class: 'stack-sm' },
              h('div', { class: 'd-row' }, h('span', { class: 'd-label' }, 'Kuantiti'), st.el),
              h('label', { class: 'd-label', for: 'd-note' }, 'Nota (pilihan)'),
              note,
            )
          : null,
        addBtn,
      );
    });
  }

  // ---------------- S-04 troli
  function openCart() {
    openSheet('Troli', (body, close) => {
      function render() {
        const s = summarize(cart, itemsById);
        if (!s.lines.length) {
          body.replaceChildren(h('h2', {}, 'Troli'), h('p', { class: 'muted' }, 'Troli kosong.'), h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: close }, 'Teruskan membeli'));
          return;
        }
        const rows = s.lines.map((l) => {
          const st = stepper(l.qty, (d) => {
            setQty(cart, l.key, l.qty + d);
            persist();
            render();
          }, l.name);
          const noteIn = h('input', { class: 'input input-sm', type: 'text', maxlength: ORDER_LIMITS.itemNoteMax, placeholder: 'Tambah nota', 'aria-label': `Nota untuk ${l.name}`, autocomplete: 'off' });
          noteIn.value = l.note;
          noteIn.addEventListener('change', () => {
            setNote(cart, l.key, noteIn.value);
            persist();
            render();
          });
          const del = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Buang ${l.name}` }, icon('padam'));
          del.addEventListener('click', () => {
            removeLine(cart, l.key);
            persist();
            render();
          });
          return h(
            'li',
            { class: 'c-line' },
            h('div', { class: 'c-top' }, h('span', { class: 'c-name' }, l.name), h('span', { class: l.lineSen === null ? 'c-price p-ask' : 'c-price' }, l.lineSen === null ? 'Harga belum ditetapkan' : formatSen(l.lineSen))),
            h('div', { class: 'c-bottom' }, st.el, noteIn, del),
          );
        });
        const next = h('button', { type: 'button', class: 'btn btn-theme btn-block' }, 'Teruskan');
        next.addEventListener('click', openCheckout);
        body.replaceChildren(
          h('h2', {}, 'Troli'),
          h('ul', { class: 'c-list' }, rows),
          h('div', { class: 'c-sum' }, h('span', {}, 'Jumlah'), h('strong', {}, s.lines.some((l) => l.lineSen !== null) ? formatSen(s.totalSen) : '-')),
          s.hasUnpriced ? h('p', { class: 'caption' }, 'Item tanpa harga tak dikira dalam jumlah. Kedai akan sahkan harganya di WhatsApp.') : null,
          next,
        );
      }
      render();
    });
  }

  // ---------------- S-05 semak dan hantar
  function openCheckout() {
    openSheet('Semak dan hantar', (body, close) => {
      const fields = [];
      const mk = (id, label, el, required) => {
        const msg = h('p', { class: 'field-msg', id: `${id}-msg` });
        el.id = id;
        el.setAttribute('aria-describedby', `${id}-msg`);
        if (required) el.setAttribute('required', '');
        const wrap = h('div', { class: 'field' }, h('label', { for: id }, label), el, msg);
        fields.push({ el, msg, required, label });
        return wrap;
      };
      const nameIn = h('input', { class: 'input', type: 'text', maxlength: ORDER_LIMITS.nameMax, autocomplete: 'name' });
      const addrIn = h('textarea', { class: 'input', rows: 3, maxlength: ORDER_LIMITS.addressMax, autocomplete: 'street-address' });
      const noteIn = h('textarea', { class: 'input', rows: 2, maxlength: ORDER_LIMITS.orderNoteMax, placeholder: 'Contoh: ambil pukul 5 petang' });
      const preview = h('pre', { class: 'msg-preview', 'aria-label': 'Pratonton mesej' });
      const warn = h('p', { class: 'notice notice-warning', hidden: true });
      const send = h('a', { class: 'btn btn-wa btn-block', target: '_blank', rel: 'noopener' }, icon('whatsapp'), h('span', {}, 'Hantar ke WhatsApp'));
      const after = h('div', { class: 'stack-sm', hidden: true });

      function message() {
        return buildMessage({ shop, summary: summarize(cart, itemsById), name: nameIn.value, address: addrIn.value, note: noteIn.value });
      }
      function valid() {
        return fields.every((f) => !f.required || f.el.value.trim());
      }
      function update() {
        const text = message();
        preview.textContent = text;
        send.href = waLink(shop.wa, text);
        warn.hidden = text.length <= ORDER_LIMITS.messageWarn;
        warn.textContent = `Mesej agak panjang (${text.length} aksara). Jika terpotong di WhatsApp, cuba hantar dalam dua order.`;
        for (const f of fields) {
          if (f.el.value.trim()) {
            f.msg.textContent = '';
            f.el.removeAttribute('aria-invalid');
          }
        }
      }
      send.addEventListener('click', (e) => {
        if (!valid()) {
          e.preventDefault();
          for (const f of fields) {
            if (f.required && !f.el.value.trim()) {
              f.msg.textContent = `${f.label} diperlukan.`;
              f.msg.dataset.kind = 'error';
              f.el.setAttribute('aria-invalid', 'true');
            }
          }
          const first = fields.find((f) => f.required && !f.el.value.trim());
          if (first) first.el.focus();
          return;
        }
        after.hidden = false;
      });
      for (const el of [nameIn, addrIn, noteIn]) el.addEventListener('input', update);

      const clearBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, 'Kosongkan troli');
      clearBtn.addEventListener('click', () => {
        cart.lines = [];
        persist();
        close();
        toast('Troli dikosongkan. Terima kasih.', 'success');
      });
      after.append(h('p', { class: 'caption' }, 'WhatsApp dibuka dengan mesej siap. Tekan Send di WhatsApp untuk menghantar order. Dah hantar?'), clearBtn);

      appendAll(body, 
        h('h2', {}, 'Semak dan hantar'),
        shop.askName ? mk('o-name', 'Nama', nameIn, true) : null,
        shop.askAddr ? mk('o-addr', 'Alamat penghantaran', addrIn, true) : null,
        mk('o-note', 'Nota untuk kedai (pilihan)', noteIn, false),
        h('p', { class: 'd-label' }, 'Mesej yang akan dihantar'),
        preview,
        warn,
        send,
        after,
        h('p', { class: 'caption' }, 'Order dihantar terus ke WhatsApp kedai. Tiada bayaran diambil di sini.'),
      );
      update();
    });
  }

  // ---------------- kaki halaman
  const footer = h(
    'footer',
    { class: 'shop-wrap shop-foot' },
    shop.branding !== false ? h('a', { href: '/' }, 'Dikuasakan oleh Kedai AnnurPro') : null,
    page.report ? h('a', { href: page.report }, 'Lapor kedai ini') : null,
  );

  renderChips();
  renderGrid();
  renderCartBar();
  root.removeAttribute('aria-busy');
  root.replaceChildren(
    header,
    h(
      'main',
      { class: 'shop-wrap shop-main' },
      items.length ? search : null,
      cats.length ? chips : null,
      grid,
      emptyMsg,
    ),
    footer,
    cartBar,
  );
}

boot();
