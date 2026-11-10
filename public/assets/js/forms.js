// Komponen borang kecil: medan berlabel dengan mesej, suis, pemilih warna. Semua teks melalui textContent.

import { h, icon } from './ui.js';
import { THEME_COLORS } from './rules.js';

/**
 * Medan dengan label di atas, input, dan satu baris mesej (ralat, berjaya atau neutral) yang diumumkan pembaca skrin.
 * msg(text, kind): kind = 'error' | 'ok' | 'muted'.
 */
export function field({ id, label, input, hint }) {
  input.id = id;
  const msgEl = h('p', { class: 'field-msg', id: `${id}-msg`, 'aria-live': 'polite' });
  const hintEl = hint ? h('p', { class: 'caption', id: `${id}-hint` }, hint) : null;
  input.setAttribute('aria-describedby', [hintEl && `${id}-hint`, `${id}-msg`].filter(Boolean).join(' '));
  const el = h('div', { class: 'field' }, h('label', { for: id }, label), input, hintEl, msgEl);

  return {
    el,
    input,
    msg(text, kind = 'error') {
      msgEl.textContent = text || '';
      msgEl.dataset.kind = text ? kind : '';
      if (text && kind === 'error') input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    },
    hint(text) {
      if (hintEl) hintEl.textContent = text;
    },
  };
}

export function textInput(attrs = {}) {
  return h('input', { class: 'input', type: 'text', ...attrs });
}

export function textArea(attrs = {}) {
  return h('textarea', { class: 'input', rows: 3, ...attrs });
}

/** Baris suis: seluruh baris boleh disentuh. */
export function switchRow({ id, title, desc, checked, onChange }) {
  const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch', id });
  input.checked = !!checked;
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  const el = h(
    'label',
    { class: 'switch-row', for: id },
    h('span', { class: 'switch-text' }, h('span', { class: 'switch-title' }, title), desc ? h('span', { class: 'caption' }, desc) : null),
    input,
  );
  return { el, input };
}

/** Pemilih warna tema: 8 butang radio bulat (sasaran sentuh 44 px). */
export function swatches(current, onChange) {
  let value = current;
  const buttons = THEME_COLORS.map((c) => {
    const btn = h('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-label': c.name, 'aria-checked': 'false', 'data-hex': c.hex });
    btn.style.background = c.hex;
    btn.appendChild(icon('semak'));
    btn.addEventListener('click', () => set(c.hex, true));
    return btn;
  });
  const el = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Warna tema kedai' }, buttons);

  function set(hex, fromUser = false) {
    value = hex;
    for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.hex === hex));
    if (fromUser && onChange) onChange(hex);
  }
  set(current);
  return { el, get: () => value, set };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / 1048576;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
