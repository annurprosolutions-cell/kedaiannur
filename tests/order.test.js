import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_LIMITS, addToCart, buildMessage, cartKey, emptyCart, lineKey, loadCart, reconcile, removeLine, saveCart, setNote,
  setQty, summarize, waLink,
} from '../public/assets/js/order.js';

const items = new Map([
  ['a', { id: 'a', n: 'Teh Tarik', p: 350, a: true }],
  ['b', { id: 'b', n: 'Kuih Lapis', p: null, a: true }],
  ['c', { id: 'c', n: 'Nasi Lemak', p: 600, a: true }],
  ['x', { id: 'x', n: 'Roti Habis', p: 200, a: false }],
]);
const shop = { name: 'Kedai Wakanda', wa: '60123456789', tpl: null };

function memStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test('IPD F-08: troli 3 item, 1 tanpa harga, nota dan nama menghasilkan mesej yang betul', () => {
  const cart = emptyCart();
  addToCart(cart, 'a', 2, 'kurang manis');
  addToCart(cart, 'b', 1);
  addToCart(cart, 'c', 1);
  const s = summarize(cart, items);
  assert.equal(s.count, 4);
  assert.equal(s.totalSen, 1300);
  assert.equal(s.hasUnpriced, true);
  const msg = buildMessage({ shop, summary: s, name: 'Ali', address: '', note: 'Ambil pukul 5' });
  assert.equal(
    msg,
    [
      'Hai Kedai Wakanda, saya nak order:',
      '',
      '1. Teh Tarik x2 = RM7.00',
      '   Nota: kurang manis',
      '2. Kuih Lapis x1 (harga belum ditetapkan)',
      '3. Nasi Lemak x1 = RM6.00',
      '',
      'Jumlah: RM13.00 (belum termasuk item tanpa harga)',
      '',
      'Nama: Ali',
      'Nota: Ambil pukul 5',
    ].join('\n'),
  );
});

test('jumlah tanpa item tanpa harga; semua tanpa harga', () => {
  const cart = emptyCart();
  addToCart(cart, 'a', 1);
  assert.match(buildMessage({ shop, summary: summarize(cart, items) }), /Jumlah: RM3\.50$/);
  const only = emptyCart();
  addToCart(only, 'b', 3);
  assert.match(buildMessage({ shop, summary: summarize(only, items) }), /Jumlah: Harga untuk disahkan oleh kedai$/);
});

test('alamat berbilang baris dimasukkan; medan kosong tak ditulis', () => {
  const cart = emptyCart();
  addToCart(cart, 'a', 1);
  const msg = buildMessage({ shop, summary: summarize(cart, items), name: '  ', address: 'No 1, Jalan Mawar\nTaman Indah' });
  assert.ok(msg.endsWith('Alamat: No 1, Jalan Mawar\nTaman Indah'));
  assert.ok(!msg.includes('Nama:'));
});

test('templat Pro: semua placeholder diganti, yang tak dikenali dibiarkan', () => {
  const cart = emptyCart();
  addToCart(cart, 'a', 1);
  const msg = buildMessage({
    shop: { ...shop, tpl: 'Order {kedai}\n{senarai_item}\nJumlah {jumlah}\nDari {nama} di {alamat} ({nota}) {lain}' },
    summary: summarize(cart, items), name: 'Siti', address: 'Shah Alam', note: 'cepat',
  });
  assert.equal(msg, 'Order Kedai Wakanda\n1. Teh Tarik x1 = RM3.50\nJumlah RM3.50\nDari Siti di Shah Alam (cepat) {lain}');
});

test('produk sama dengan nota berbeza ialah baris berasingan; nota sama digabungkan', () => {
  const cart = emptyCart();
  addToCart(cart, 'c', 1, 'pedas');
  addToCart(cart, 'c', 1, 'tak pedas');
  addToCart(cart, 'c', 2, '  pedas ');
  assert.deepEqual(cart.lines.map((l) => [l.note, l.qty]), [['pedas', 3], ['tak pedas', 1]]);
});

test('IPD: had 30 item berbeza dan 99 unit setiap item', () => {
  const cart = emptyCart();
  for (let i = 0; i < 30; i++) assert.equal(addToCart(cart, 'a', 1, `nota ${i}`).ok, true);
  assert.deepEqual(addToCart(cart, 'a', 1, 'nota 31'), { ok: false, reason: 'had-item' });
  assert.equal(cart.lines.length, ORDER_LIMITS.maxLines);
  const c2 = emptyCart();
  addToCart(c2, 'a', 99);
  assert.deepEqual(addToCart(c2, 'a', 1), { ok: false, reason: 'had-qty' });
  addToCart(c2, 'c', 500);
  assert.equal(c2.lines[1].qty, 99);
});

test('setQty, removeLine, setNote (gabung jika bertindih)', () => {
  const cart = emptyCart();
  addToCart(cart, 'a', 2, 'x');
  addToCart(cart, 'a', 1, 'y');
  setQty(cart, lineKey('a', 'x'), 5);
  assert.equal(cart.lines[0].qty, 5);
  setNote(cart, lineKey('a', 'y'), 'x');
  assert.deepEqual(cart.lines.map((l) => [l.note, l.qty]), [['x', 6]]);
  setQty(cart, lineKey('a', 'x'), 0);
  assert.equal(cart.lines.length, 0);
  addToCart(cart, 'c', 1);
  removeLine(cart, lineKey('c', ''));
  assert.equal(cart.lines.length, 0);
});

test('IPD F-07: troli kekal dalam storan per slug; data rosak atau storan disekat tak memecahkan halaman', () => {
  const st = memStorage();
  const cart = emptyCart();
  addToCart(cart, 'a', 2, 'kurang manis');
  saveCart(st, 'wakanda', cart);
  assert.deepEqual(loadCart(st, 'wakanda').lines, [{ id: 'a', qty: 2, note: 'kurang manis' }]);
  assert.deepEqual(loadCart(st, 'kedai-lain').lines, [], 'troli berasingan setiap kedai');
  st.setItem(cartKey('rosak'), '{bukan json');
  assert.deepEqual(loadCart(st, 'rosak').lines, []);
  st.setItem(cartKey('pelik'), JSON.stringify({ v: 1, lines: [{ id: 'a', qty: -3 }, { id: 5, qty: 1 }, { id: 'c', qty: 1000, note: 'x'.repeat(500) }] }));
  const l = loadCart(st, 'pelik').lines;
  assert.equal(l.length, 1);
  assert.equal(l[0].qty, 99);
  assert.equal(l[0].note.length, ORDER_LIMITS.itemNoteMax);
  const blocked = { getItem() { throw new Error('disekat'); }, setItem() { throw new Error('disekat'); }, removeItem() {} };
  assert.deepEqual(loadCart(blocked, 'x').lines, []);
  assert.equal(saveCart(blocked, 'x', cart), false);
  saveCart(st, 'wakanda', emptyCart());
  assert.equal(st.getItem(cartKey('wakanda')), null, 'troli kosong dibuang dari storan');
});

test('reconcile: buang produk yang tiada lagi atau habis stok, dan laporkan namanya', () => {
  const cart = emptyCart();
  for (const id of ['a', 'x', 'hilang']) addToCart(cart, id, 1);
  assert.deepEqual(reconcile(cart, items), ['Roti Habis']);
  assert.deepEqual(cart.lines.map((l) => l.id), ['a']);
});

test('waLink: nombor digit sahaja, teks dikodkan (emoji, baris baharu, &)', () => {
  const link = waLink('+60 12-345 6789', 'A & B\nRM3.50 😀');
  assert.equal(link, `https://wa.me/60123456789?text=${encodeURIComponent('A & B\nRM3.50 😀')}`);
  assert.equal(decodeURIComponent(new URL(link).searchParams.get('text')), 'A & B\nRM3.50 😀');
});

test('mesej panjang dikesan melebihi had amaran', () => {
  const cart = emptyCart();
  for (let i = 0; i < 30; i++) addToCart(cart, 'c', 1, `nota panjang untuk item ini supaya mesej besar ${i}`);
  const msg = buildMessage({ shop, summary: summarize(cart, items), name: 'Ali' });
  assert.ok(msg.length > ORDER_LIMITS.messageWarn);
});
