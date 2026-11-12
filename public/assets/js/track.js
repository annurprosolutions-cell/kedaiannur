// Penjejak statistik tanpa nama untuk halaman kedai. Satu lawatan dikira sekali setiap sesi pelayar (sessionStorage),
// acara dikumpul dan dihantar sekali gus (sendBeacon) bila halaman disembunyikan atau bila order dihantar.
// Tiada kuki, ID pelawat atau data peribadi dihantar: hanya kiraan dan ID produk kedai itu sendiri.

function store() {
  try {
    const s = window.sessionStorage;
    s.getItem('x');
    return s;
  } catch {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  }
}

export function createTracker(slug, { src = '' } = {}) {
  const ss = store();
  const seen = (key) => {
    if (ss.getItem(key)) return true;
    ss.setItem(key, '1');
    return false;
  };
  const q = { view: false, src: '', items: 0, carts: 0, orders: 0, products: new Set() };
  let dirty = false;

  function flush() {
    if (!dirty) return;
    const body = JSON.stringify({ view: q.view, src: q.src, items: q.items, carts: q.carts, orders: q.orders, products: [...q.products] });
    q.view = false;
    q.items = 0;
    q.carts = 0;
    q.orders = 0;
    q.products.clear();
    dirty = false;
    const url = `/api/track/${encodeURIComponent(slug)}`;
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return;
    } catch {
      /* jatuh ke fetch */
    }
    fetch(url, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);

  return {
    view() {
      if (seen(`kedai-lawat-${slug}`)) return;
      q.view = true;
      q.src = src;
      dirty = true;
    },
    item(id) {
      if (seen(`kedai-produk-${slug}-${id}`)) return;
      q.items += 1;
      q.products.add(String(id));
      dirty = true;
    },
    cart() {
      q.carts += 1;
      dirty = true;
    },
    order() {
      q.orders += 1;
      dirty = true;
      flush(); // pelanggan mungkin terus ke WhatsApp dan tak kembali
    },
    flush,
  };
}

/** Baca ?src=qr (daripada kod QR atau poster) dan buang daripada URL supaya pautan yang dikongsi kekal bersih. */
export function takeSource() {
  try {
    const u = new URL(window.location.href);
    const src = u.searchParams.get('src');
    if (!src) return '';
    u.searchParams.delete('src');
    window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`);
    return src === 'qr' ? 'qr' : '';
  } catch {
    return '';
  }
}
