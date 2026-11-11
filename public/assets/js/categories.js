// S-12 Kategori: tambah, nama semula, susun (butang naik/turun), padam (F-05).

import { api } from './api.js';
import { h, icon, toast } from './ui.js';
import { textInput } from './forms.js';
import { LIMITS, MSG, cleanText } from './rules.js';

const CATALOG_WARNING = 'katalog-gagal';

export function viewCategories(ctx) {
  const root = h('div', { class: 'stack' }, h('a', { class: 'back-link', href: '#/produk' }, '‹ Senarai produk'), h('h1', {}, 'Kategori'));
  const body = h('div', { class: 'stack' }, h('div', { class: 'skeleton', style: 'height:200px' }));
  root.appendChild(body);

  let categories = [];
  let plan = null;
  let busy = false;
  let editing = null;

  async function load() {
    try {
      const data = await api('/api/products');
      categories = data.categories;
      plan = data.plan;
      render();
    } catch (err) {
      if (err.status === 401) return ctx.onError(err);
      body.replaceChildren(h('div', { class: 'card stack' }, h('p', { role: 'alert' }, err.message), h('button', { type: 'button', class: 'btn btn-block', onclick: load }, 'Cuba semula')));
    }
  }

  // Jalankan permintaan; ralat katalog bermaksud data sudah disimpan, jadi muat semula senarai.
  async function run(fn, okText) {
    if (busy) return false;
    busy = true;
    try {
      await fn();
      if (okText) toast(okText, 'success');
      return true;
    } catch (err) {
      if (err.status === 401) {
        ctx.onError(err);
        return false;
      }
      toast(err.message, 'error');
      return err.code === CATALOG_WARNING;
    } finally {
      busy = false;
      ctx.reloadMe({ render: false });
      await load();
    }
  }

  function render() {
    const full = categories.length >= plan.maxCategories;
    const addIn = textInput({ maxlength: LIMITS.categoryNameMax, placeholder: 'Contoh: Minuman', 'aria-label': 'Nama kategori baharu', disabled: full });
    const addBtn = h('button', { type: 'button', class: 'btn', disabled: full }, icon('tambah'), h('span', {}, 'Tambah'));
    const add = async () => {
      const name = cleanText(addIn.value);
      if (!name) return toast(MSG.namaKategori, 'error');
      await run(() => api('/api/categories', { method: 'POST', body: { name } }), 'Kategori ditambah.');
    };
    addBtn.addEventListener('click', add);
    addIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') add();
    });

    const rows = categories.map((c, i) => {
      if (editing === c.id) {
        const input = textInput({ maxlength: LIMITS.categoryNameMax, 'aria-label': `Nama baharu untuk ${c.name}` });
        input.value = c.name;
        const save = async () => {
          const name = cleanText(input.value);
          if (!name) return toast(MSG.namaKategori, 'error');
          editing = null;
          await run(() => api(`/api/categories/${c.id}`, { method: 'PATCH', body: { name } }), 'Nama kategori disimpan.');
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') {
            editing = null;
            render();
          }
        });
        queueMicrotask(() => input.focus());
        return h(
          'li',
          { class: 'cat-row editing' },
          input,
          h('span', { class: 'cat-actions' },
            h('button', { type: 'button', class: 'btn btn-sm', onclick: save }, 'Simpan'),
            h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { editing = null; render(); } }, 'Batal')),
        );
      }
      const btn = (label, ic, onclick, disabled) =>
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${label} ${c.name}`, title: label, onclick, disabled: disabled || busy }, icon(ic));
      return h(
        'li',
        { class: 'cat-row' },
        h('span', { class: 'cat-name' }, c.name, i >= plan.maxCategories ? h('span', { class: 'badge badge-warning' }, 'Tersembunyi') : null),
        h(
          'span',
          { class: 'cat-actions' },
          btn('Nama semula', 'pensel', () => { editing = c.id; render(); }),
          btn('Naikkan', 'atas', () => move(i, -1), i === 0),
          btn('Turunkan', 'bawah', () => move(i, 1), i === categories.length - 1),
          btn('Padam', 'padam', () => remove(c)),
        ),
      );
    });

    body.replaceChildren(
      h(
        'section',
        { class: 'card stack' },
        h('div', { class: 'add-row' }, addIn, addBtn),
        h('p', { class: 'caption' }, full
          ? `Had ${plan.maxCategories} kategori pelan ${plan.name} dicapai.${plan.code === 'free' ? ' Pro membenarkan sehingga 50.' : ''}`
          : `${categories.length} daripada ${plan.maxCategories} kategori. Pelanggan boleh tapis produk ikut kategori.`),
      ),
      categories.length
        ? h('ul', { class: 'cat-list card', 'aria-label': 'Senarai kategori' }, rows)
        : h('p', { class: 'muted placeholder' }, 'Belum ada kategori. Contoh: Nasi, Minuman, Kuih.'),
    );
  }

  function move(i, dir) {
    const ids = categories.map((c) => c.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    return run(() => api('/api/categories/reorder', { method: 'POST', body: { ids } }));
  }

  function remove(c) {
    if (!window.confirm(`Padam kategori "${c.name}"? Produk di dalamnya tak dipadam, cuma jadi tanpa kategori.`)) return;
    return run(() => api(`/api/categories/${c.id}`, { method: 'DELETE' }), 'Kategori dipadam.');
  }

  load();
  return root;
}
