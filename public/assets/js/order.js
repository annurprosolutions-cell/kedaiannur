// Troli dan mesej order WhatsApp (F-07, F-08). Fungsi tulen tanpa DOM supaya boleh diuji dalam Node.
// Troli disimpan dalam localStorage pelanggan sahaja; tiada order disimpan di server (PRD andaian 6).

import { formatSen } from './rules.js';

export const ORDER_LIMITS = {
  maxLines: 30, // item berbeza dalam troli (AFD keadaan khas)
  maxQty: 99,
  itemNoteMax: 100,
  nameMax: 60,
  addressMax: 300,
  orderNoteMax: 300,
  messageWarn: 1500, // melebihi ini: amaran supaya mesej tak terpotong
};

export const DEFAULT_TEMPLATE = 'Hai {kedai}, saya nak order:\n\n{senarai_item}\n\nJumlah: {jumlah}';

export function cartKey(slug) {
  return `kedai:troli:${slug}`;
}

export function emptyCart() {
  return { v: 1, lines: [] };
}

// Baris troli dikenal pasti oleh produk + nota: "Nasi Lemak (tak pedas)" dan "Nasi Lemak" ialah baris berbeza.
export function lineKey(id, note) {
  return `${id}\n${note}`;
}

function cleanNote(note) {
  return String(note ?? '').replace(/\s+/g, ' ').trim().slice(0, ORDER_LIMITS.itemNoteMax);
}

export function loadCart(storage, slug) {
  try {
    const raw = storage.getItem(cartKey(slug));
    const cart = raw ? JSON.parse(raw) : null;
    if (!cart || cart.v !== 1 || !Array.isArray(cart.lines)) return emptyCart();
    const lines = cart.lines
      .filter((l) => l && typeof l.id === 'string' && Number.isInteger(l.qty) && l.qty > 0)
      .map((l) => ({ id: l.id, qty: Math.min(l.qty, ORDER_LIMITS.maxQty), note: cleanNote(l.note) }))
      .slice(0, ORDER_LIMITS.maxLines);
    return { v: 1, lines };
  } catch {
    return emptyCart(); // storan disekat (mod peribadi) atau data rosak
  }
}

export function saveCart(storage, slug, cart) {
  try {
    if (cart.lines.length) storage.setItem(cartKey(slug), JSON.stringify(cart));
    else storage.removeItem(cartKey(slug));
    return true;
  } catch {
    return false;
  }
}

/** Tambah produk. Pulangkan { ok: true } atau { ok: false, reason: 'had-item' | 'had-qty' }. */
export function addToCart(cart, id, qty = 1, note = '') {
  const n = cleanNote(note);
  const existing = cart.lines.find((l) => l.id === id && l.note === n);
  if (existing) {
    if (existing.qty >= ORDER_LIMITS.maxQty) return { ok: false, reason: 'had-qty' };
    existing.qty = Math.min(existing.qty + qty, ORDER_LIMITS.maxQty);
    return { ok: true };
  }
  if (cart.lines.length >= ORDER_LIMITS.maxLines) return { ok: false, reason: 'had-item' };
  cart.lines.push({ id, qty: Math.min(Math.max(1, qty), ORDER_LIMITS.maxQty), note: n });
  return { ok: true };
}

export function setQty(cart, key, qty) {
  const line = cart.lines.find((l) => lineKey(l.id, l.note) === key);
  if (!line) return;
  if (qty <= 0) cart.lines = cart.lines.filter((l) => l !== line);
  else line.qty = Math.min(qty, ORDER_LIMITS.maxQty);
}

export function removeLine(cart, key) {
  cart.lines = cart.lines.filter((l) => lineKey(l.id, l.note) !== key);
}

// Tukar nota baris; jika baris lain dengan produk dan nota yang sama sudah wujud, gabungkan kuantiti.
export function setNote(cart, key, note) {
  const line = cart.lines.find((l) => lineKey(l.id, l.note) === key);
  if (!line) return;
  const n = cleanNote(note);
  const twin = cart.lines.find((l) => l !== line && l.id === line.id && l.note === n);
  if (twin) {
    twin.qty = Math.min(twin.qty + line.qty, ORDER_LIMITS.maxQty);
    cart.lines = cart.lines.filter((l) => l !== line);
  } else {
    line.note = n;
  }
}

/**
 * Selaraskan troli dengan katalog semasa: buang produk yang sudah tiada atau habis stok.
 * Pulangkan nama produk yang dibuang supaya pelanggan boleh diberitahu.
 */
export function reconcile(cart, itemsById) {
  const removed = [];
  cart.lines = cart.lines.filter((l) => {
    const item = itemsById.get(l.id);
    if (item && item.a) return true;
    if (item) removed.push(item.n);
    return false;
  });
  return removed;
}

export function summarize(cart, itemsById) {
  let totalSen = 0;
  let count = 0;
  let hasUnpriced = false;
  const lines = [];
  for (const l of cart.lines) {
    const item = itemsById.get(l.id);
    if (!item) continue;
    const priced = Number.isInteger(item.p);
    const lineSen = priced ? item.p * l.qty : null;
    if (priced) totalSen += lineSen;
    else hasUnpriced = true;
    count += l.qty;
    lines.push({ key: lineKey(l.id, l.note), id: l.id, name: item.n, qty: l.qty, note: l.note, priceSen: priced ? item.p : null, lineSen });
  }
  return { lines, count, totalSen, hasUnpriced };
}

export function itemListText(summary) {
  return summary.lines
    .map((l, i) => {
      const price = l.lineSen === null ? ' (harga belum ditetapkan)' : ` = ${formatSen(l.lineSen)}`;
      const note = l.note ? `\n   Nota: ${l.note}` : '';
      return `${i + 1}. ${l.name} x${l.qty}${price}${note}`;
    })
    .join('\n');
}

export function totalText(summary) {
  if (!summary.lines.some((l) => l.lineSen !== null)) return 'Harga untuk disahkan oleh kedai';
  return summary.hasUnpriced ? `${formatSen(summary.totalSen)} (belum termasuk item tanpa harga)` : formatSen(summary.totalSen);
}

const clean = (s) => String(s ?? '').trim();

/**
 * Bina mesej order. tpl (Pro) boleh guna {kedai} {senarai_item} {jumlah} {nama} {alamat} {nota}.
 * Templat lalai menambah Nama, Alamat dan Nota hanya jika diisi.
 */
export function buildMessage({ shop, summary, name = '', address = '', note = '' }) {
  const values = {
    kedai: shop.name,
    senarai_item: itemListText(summary),
    jumlah: totalText(summary),
    nama: clean(name),
    alamat: clean(address),
    nota: clean(note),
  };
  if (shop.tpl) {
    return shop.tpl.replace(/\{(kedai|senarai_item|jumlah|nama|alamat|nota)\}/g, (_, k) => values[k]).trim();
  }
  const parts = [DEFAULT_TEMPLATE.replace(/\{(kedai|senarai_item|jumlah)\}/g, (_, k) => values[k])];
  const extra = [];
  if (values.nama) extra.push(`Nama: ${values.nama}`);
  if (values.alamat) extra.push(`Alamat: ${values.alamat}`);
  if (values.nota) extra.push(`Nota: ${values.nota}`);
  if (extra.length) parts.push(extra.join('\n'));
  return parts.join('\n\n');
}

export function waLink(wa, text) {
  return `https://wa.me/${String(wa).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}
