import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_COLORS, DEFAULT_THEME, normalizeSlug, slugFormatError, slugFormatIssue, slugify,
  normalizeWhatsapp, formatWhatsapp, cleanText, isThemeColor, isReservedLocally,
} from '../public/assets/js/rules.js';

test('slug sah', () => {
  for (const s of ['wakanda', 'kedai-mak-cik', 'abc', 'a1b', 'x'.repeat(30), '123']) assert.equal(slugFormatError(s), null, s);
});

test('slug tak sah ikut IPD: 2 aksara, a--, awalan/akhiran sempang, simbol, ruang, terlalu panjang', () => {
  const bad = { ab: 'panjang', 'a--': 'sempang', '-abc': 'sempang', 'abc-': 'sempang', 'ab_c': 'aksara', 'ab c': 'aksara', 'ab.c': 'aksara', 'kédai': 'aksara', [`x`.repeat(31)]: 'panjang', '': 'panjang' };
  for (const [s, code] of Object.entries(bad)) assert.equal(slugFormatIssue(s)?.code, code, JSON.stringify(s));
});

test('huruf besar dinormalkan ke huruf kecil sebelum semakan', () => {
  assert.equal(normalizeSlug('  WaKanDa '), 'wakanda');
  assert.equal(slugFormatError(normalizeSlug('WAKANDA')), null);
});

test('slugify daripada nama kedai', () => {
  assert.equal(slugify('Kuih Mak Cik'), 'kuih-mak-cik');
  assert.equal(slugify("  Kedai Ánna's  Café!! "), 'kedai-anna-s-cafe');
  assert.equal(slugify('AB'), '');
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify('x'.repeat(50)).length, 30);
  assert.equal(slugFormatError(slugify('Kedai ' + 'abcdefghij '.repeat(5))), null, 'hasil slugify sentiasa slug sah');
});

test('slug index dan 404 dikeluarkan (bertembung dengan fail statik)', () => {
  assert.ok(isReservedLocally('index') && isReservedLocally('404'));
  assert.ok(!isReservedLocally('wakanda'));
});

test('normalisasi WhatsApp (BSD peraturan 5)', () => {
  const cases = [
    ['0123456789', '60123456789'],
    ['012-345 6789', '60123456789'],
    ['+60 12-345 6789', '60123456789'],
    ['60123456789', '60123456789'],
    ['(+60) 12 345 6789', '60123456789'],
    ['0060123456789', '60123456789'],
    ['+60 0123456789', '60123456789'],
    ['01112345678', '601112345678'],
    ['6581234567', '6581234567'],
    ['12345678901234', '12345678901234'],
  ];
  for (const [input, want] of cases) assert.equal(normalizeWhatsapp(input), want, input);
});

test('WhatsApp tak sah ditolak', () => {
  for (const bad of ['', '   ', 'abc', '0123', '12345678', '1234567890123456', null, undefined, '+++', '0']) {
    assert.equal(normalizeWhatsapp(bad), null, String(bad));
  }
});

test('formatWhatsapp untuk pengesahan oleh peniaga', () => {
  assert.equal(formatWhatsapp('60123456789'), '+60 12-345 6789');
  assert.equal(formatWhatsapp('601123456789'), '+60 11-2345 6789');
  assert.equal(formatWhatsapp('6581234567'), '+6581234567');
});

test('cleanText: buang aksara kawalan, ringkaskan ruang, kekalkan baris baharu bila multiline', () => {
  assert.equal(cleanText('  Kedai \u0000 Mak\u0007  Cik \n baru '), 'Kedai Mak Cik baru');
  assert.equal(cleanText('Baris 1\r\nBaris 2 \u0000', { multiline: true }), 'Baris 1\nBaris 2');
});

test('8 warna tema, hex sah, unik, termasuk warna lalai', () => {
  assert.equal(THEME_COLORS.length, 8);
  assert.equal(new Set(THEME_COLORS.map((c) => c.hex)).size, 8);
  for (const c of THEME_COLORS) assert.match(c.hex, /^#[0-9A-F]{6}$/);
  assert.ok(isThemeColor(DEFAULT_THEME));
  assert.ok(!isThemeColor('#FF0000'));
});

// DBD seksyen 3: "semua diuji untuk teks putih pada kontras 4.5:1 atau lebih; semak dengan alat checker semasa build".
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrastOnWhite = (hex) => 1.05 / (luminance(hex) + 0.05);

test('kontras teks putih pada setiap warna tema >= 4.5 (WCAG AA)', () => {
  for (const c of THEME_COLORS) {
    const ratio = contrastOnWhite(c.hex);
    console.log(`  ${c.name.padEnd(13)} ${c.hex} ${ratio.toFixed(2)}:1`);
    assert.ok(ratio >= 4.5, `${c.name} ${c.hex} hanya ${ratio.toFixed(2)}:1`);
  }
  assert.ok(contrastOnWhite('#15803D') >= 4.5, 'butang Hantar ke WhatsApp (Green 700)');
});
