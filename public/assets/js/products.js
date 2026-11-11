// S-10 Senarai produk dan S-11 Borang produk (F-04, F-05, F-10).
// Senarai dimuat sekali (GET /api/products: produk, kategori, pelan, penggunaan); carian dan tapisan di browser.
// Gambar dimampatkan semasa dipilih (ralat awal), dimuat naik hanya semasa Simpan (kurang objek yatim).

import { api, upload } from './api.js';
import { getConfig, mediaUrl } from './config.js';
import { h, icon, toast } from './ui.js';
import { field, switchRow, textArea, textInput, formatBytes } from './forms.js';
import { compressImage, ImageError } from './image.js';
import { LIMITS, MSG, cleanText, formatSen, parsePriceToSen, senToInput } from './rules.js';

export const CATALOG_WARNING = 'katalog-gagal';

function loadingBox(height = 240) {
  return h('div', { class: 'skeleton', style: `height:${height}px` });
}

function errorBox(err, retry) {
  return h(
    'div',
    { class: 'card stack' },
    h('p', { role: 'alert' }, err.message),
    h('button', { type: 'button', class: 'btn btn-block', onclick: retry }, 'Cuba semula'),
  );
}

function thumbFor(cfg, key, alt) {
  const url = key ? mediaUrl(cfg, key) : '';
  return url
    ? h('img', { class: 'thumb', src: url, alt, loading: 'lazy', width: 56, height: 56 })
    : h('span', { class: 'thumb thumb-ph', 'aria-hidden': 'true' }, icon('gambar'));
}

// ================================================================ S-10 Senarai produk

export function viewProducts(ctx) {
  const root = h('div', { class: 'stack' }, h('h1', {}, 'Produk'));
  const body = h('div', { class: 'stack' }, loadingBox());
  root.appendChild(body);

  let data;
  let cfg;
  let busy = false;
  const filter = { q: '', cat: 'semua' };

  async function load() {
    body.replaceChildren(loadingBox());
    try {
      [cfg, data] = await Promise.all([getConfig(), api('/api/products')]);
      render();
    } catch (err) {
      if (err.status === 401) return ctx.onError(err);
      body.replaceChildren(errorBox(err, load));
    }
  }

  const search = textInput({ type: 'search', placeholder: 'Cari produk', 'aria-label': 'Cari produk', autocomplete: 'off' });
  search.addEventListener('input', () => {
    filter.q = search.value.trim().toLowerCase();
    renderList();
  });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Tapis ikut kategori' });
  const list = h('ul', { class: 'product-list', 'aria-label': 'Senarai produk' });
  const countLine = h('p', { class: 'caption' });

  function render() {
    const { plan, usage, products } = data;
    const full = usage.products >= plan.maxProducts;
    const hidden = products.filter((p) => p.hidden).length;

    const actions = h(
      'div',
      { class: 'btn-row' },
      h('a', { class: 'btn btn-secondary', href: '#/kategori' }, 'Kategori'),
      full
        ? h('a', { class: 'btn btn-secondary', href: '#/langganan' }, 'Naik taraf')
        : h('a', { class: 'btn', href: '#/produk/baru' }, icon('tambah'), h('span', {}, 'Tambah produk')),
    );

    const notices = [];
    if (full) {
      notices.push(
        h('p', { class: 'notice notice-warning', role: 'status' }, `Had ${plan.maxProducts} produk pelan ${plan.name} dicapai. Naik taraf ke Pro untuk tambah lagi.`),
      );
    }
    if (hidden) {
      notices.push(
        h(
          'p',
          { class: 'notice notice-warning', role: 'status' },
          `${hidden} produk tersembunyi daripada katalog awam kerana melebihi had ${plan.maxProducts} produk pelan ${plan.name}. Data tak dipadam.`,
        ),
      );
    }

    if (!products.length) {
      body.replaceChildren(
        actions,
        h(
          'section',
          { class: 'card placeholder' },
          icon('produk'),
          h('h2', {}, 'Belum ada produk'),
          h('p', { class: 'muted' }, 'Tambah produk pertama: gambar, nama dan harga sudah cukup.'),
          h('a', { class: 'btn', href: '#/produk/baru' }, 'Tambah produk pertama'),
        ),
      );
      return;
    }

    renderChips();
    renderList();
    body.replaceChildren(actions, ...notices, search, chips, countLine, list);
  }

  function renderChips() {
    const opts = [['semua', 'Semua'], ...data.categories.map((c) => [c.id, c.name])];
    if (data.products.some((p) => !p.categoryId)) opts.push(['tiada', 'Tanpa kategori']);
    chips.replaceChildren(
      ...opts.map(([value, label]) => {
        const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(filter.cat === value) }, label);
        b.addEventListener('click', () => {
          filter.cat = value;
          renderChips();
          renderList();
        });
        return b;
      }),
    );
  }

  function visible() {
    return data.products.filter((p) => {
      if (filter.cat === 'tiada' && p.categoryId) return false;
      if (filter.cat !== 'semua' && filter.cat !== 'tiada' && p.categoryId !== filter.cat) return false;
      return !filter.q || p.name.toLowerCase().includes(filter.q);
    });
  }

  function renderList() {
    const items = visible();
    const filtered = filter.q || filter.cat !== 'semua';
    const catName = new Map(data.categories.map((c) => [c.id, c.name]));
    countLine.textContent = `${data.usage.products} daripada ${data.plan.maxProducts} produk${filtered ? `, ${items.length} dipaparkan` : ''}`;

    list.replaceChildren(
      ...items.map((p) => {
        const index = data.products.indexOf(p);
        const avail = h('input', { type: 'checkbox', role: 'switch', class: 'switch', 'aria-label': `${p.name} tersedia` });
        avail.checked = p.isAvailable;
        avail.addEventListener('change', () => toggleAvailable(p, avail));

        const move = (dir, label, ic) =>
          h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': `${label} ${p.name}`, title: label,
            disabled: filtered || busy || (dir < 0 ? index === 0 : index === data.products.length - 1),
            onclick: () => moveProduct(index, dir),
          }, icon(ic));

        return h(
          'li',
          { class: 'product-row', 'data-id': p.id },
          h(
            'a',
            { class: 'product-link', href: `#/produk/${p.id}` },
            thumbFor(cfg, p.thumbKey, ''),
            h(
              'span',
              { class: 'product-info' },
              h('span', { class: 'product-name' }, p.name),
              h('span', { class: p.priceSen === null ? 'caption' : 'product-price' }, formatSen(p.priceSen)),
              h(
                'span',
                { class: 'product-tags' },
                p.categoryId ? h('span', { class: 'caption' }, catName.get(p.categoryId) || '') : null,
                p.isAvailable ? null : h('span', { class: 'badge' }, 'Habis'),
                p.hidden ? h('span', { class: 'badge badge-warning' }, 'Tersembunyi') : null,
              ),
            ),
          ),
          h(
            'span',
            { class: 'product-actions' },
            avail,
            h('span', { class: 'move-btns' }, move(-1, 'Naikkan', 'atas'), move(1, 'Turunkan', 'bawah')),
          ),
        );
      }),
    );
    if (!items.length) list.replaceChildren(h('li', { class: 'caption empty-row' }, 'Tiada produk sepadan.'));
  }

  async function toggleAvailable(p, input) {
    const next = input.checked;
    try {
      const res = await api(`/api/products/${p.id}`, { method: 'PATCH', body: { isAvailable: next } });
      Object.assign(p, res.product, { hidden: p.hidden });
      toast(next ? `${p.name} tersedia.` : `${p.name} ditanda habis stok.`, 'success');
    } catch (err) {
      if (err.code === CATALOG_WARNING) {
        p.isAvailable = next;
        toast(err.message, 'error');
      } else {
        input.checked = !next;
        if (err.status === 401) return ctx.onError(err);
        toast(err.message, 'error');
      }
    }
    renderList();
  }

  async function moveProduct(index, dir) {
    if (busy) return;
    const ids = data.products.map((p) => p.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    busy = true;
    renderList();
    try {
      await api('/api/products/reorder', { method: 'POST', body: { ids } });
    } catch (err) {
      if (err.status === 401) return ctx.onError(err);
      if (err.code !== CATALOG_WARNING) {
        busy = false;
        toast(err.message, 'error');
        return load(); // senarai lapuk: muat semula dari server
      }
      toast(err.message, 'error');
    }
    // Susunan baharu juga menentukan produk mana yang tersembunyi jika melebihi had.
    const byId = new Map(data.products.map((p) => [p.id, p]));
    data.products = ids.map((id, i) => ({ ...byId.get(id), hidden: i >= data.plan.maxProducts }));
    busy = false;
    renderList();
  }

  load();
  return root;
}

// ================================================================ S-11 Borang produk

export function viewProductForm(ctx, productId) {
  const isNew = !productId;
  const root = h('div', { class: 'stack' }, h('a', { class: 'back-link', href: '#/produk' }, '‹ Senarai produk'), h('h1', {}, isNew ? 'Tambah produk' : 'Ubah produk'));
  const body = h('div', { class: 'stack' }, loadingBox(360));
  root.appendChild(body);

  async function load() {
    body.replaceChildren(loadingBox(360));
    try {
      const [cfg, data] = await Promise.all([getConfig(), api('/api/products')]);
      const product = isNew ? null : data.products.find((p) => p.id === productId);
      if (!isNew && !product) {
        body.replaceChildren(h('div', { class: 'card stack' }, h('p', {}, 'Produk tak dijumpai. Mungkin sudah dipadam.'), h('a', { class: 'btn btn-block', href: '#/produk' }, 'Kembali ke senarai')));
        return;
      }
      if (isNew && data.usage.products >= data.plan.maxProducts) {
        body.replaceChildren(
          h(
            'div',
            { class: 'card stack' },
            h('p', { class: 'notice notice-warning' }, `Had ${data.plan.maxProducts} produk pelan ${data.plan.name} dicapai. Naik taraf ke Pro`),
            h('a', { class: 'btn btn-block', href: '#/langganan' }, 'Lihat pelan Pro'),
          ),
        );
        return;
      }
      body.replaceChildren(build(cfg, data, product));
    } catch (err) {
      if (err.status === 401) return ctx.onError(err);
      body.replaceChildren(errorBox(err, load));
    }
  }

  function build(cfg, data, product) {
    // ---------------- gambar
    let picked = null; // { big, thumb, url } selepas dimampatkan
    let removeImage = false;
    const preview = h('div', { class: 'image-preview' });
    const imgMsg = h('p', { class: 'field-msg', id: 'img-msg', 'aria-live': 'polite' });
    const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', id: 'p-image', tabindex: '-1', 'aria-label': 'Fail gambar produk' });
    const pickBtn = h('button', { type: 'button', class: 'btn btn-secondary' }, icon('gambar'), h('span', {}, 'Pilih gambar'));
    const removeBtn = h('button', { type: 'button', class: 'btn btn-secondary' }, icon('padam'), h('span', {}, 'Buang gambar'));

    const setImgMsg = (text, kind = 'error') => {
      imgMsg.textContent = text || '';
      imgMsg.dataset.kind = text ? kind : '';
    };

    function renderImage() {
      const current = !removeImage && product && product.thumbKey ? mediaUrl(cfg, product.thumbKey) : '';
      const src = picked ? picked.url : current;
      preview.replaceChildren(src ? h('img', { src, alt: 'Gambar produk' }) : h('span', { class: 'thumb-ph big', 'aria-hidden': 'true' }, icon('gambar')));
      pickBtn.lastChild.textContent = src ? 'Tukar gambar' : 'Pilih gambar';
      removeBtn.hidden = !src;
    }

    pickBtn.addEventListener('click', () => fileIn.click());
    removeBtn.addEventListener('click', () => {
      if (picked) URL.revokeObjectURL(picked.url);
      picked = null;
      removeImage = !!(product && product.imageKey);
      setImgMsg('');
      renderImage();
    });
    fileIn.addEventListener('change', async () => {
      const file = fileIn.files && fileIn.files[0];
      fileIn.value = '';
      if (!file) return;
      pickBtn.disabled = true;
      saveBtn.disabled = true;
      setImgMsg('Memampatkan gambar...', 'muted');
      try {
        // Satu demi satu: jimat memori di phone murah.
        const big = await compressImage(file, 'product');
        const thumb = await compressImage(file, 'thumb');
        if (picked) URL.revokeObjectURL(picked.url);
        picked = { big: big.blob, thumb: thumb.blob, url: URL.createObjectURL(thumb.blob) };
        removeImage = false;
        setImgMsg(`Siap dimampatkan (${formatBytes(big.blob.size + thumb.blob.size)}).`, 'ok');
      } catch (err) {
        setImgMsg(err instanceof ImageError ? err.message : 'Gambar tak dapat diproses. Cuba gambar lain.');
      } finally {
        pickBtn.disabled = false;
        saveBtn.disabled = false;
        renderImage();
      }
    });

    // ---------------- medan
    const nameIn = textInput({ maxlength: LIMITS.productNameMax, placeholder: 'Contoh: Nasi Lemak Ayam' });
    nameIn.value = product ? product.name : '';
    const nameF = field({ id: 'p-name', label: 'Nama produk', input: nameIn });

    const priceIn = textInput({ inputmode: 'decimal', placeholder: 'Contoh: 12.50', autocomplete: 'off' });
    priceIn.value = product ? senToInput(product.priceSen) : '';
    const priceF = field({ id: 'p-price', label: 'Harga (RM)', input: priceIn, hint: 'Kosongkan untuk "Hubungi untuk harga".' });

    const descIn = textArea({ maxlength: LIMITS.productDescMax, placeholder: 'Contoh: Pedas sederhana, dengan telur rebus.' });
    descIn.value = product ? product.description : '';
    const descF = field({ id: 'p-desc', label: 'Penerangan (pilihan)', input: descIn, hint: `${descIn.value.length}/${LIMITS.productDescMax}` });
    descIn.addEventListener('input', () => descF.hint(`${descIn.value.length}/${LIMITS.productDescMax}`));

    const catSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Tiada kategori'), data.categories.map((c) => h('option', { value: c.id }, c.name)));
    catSel.value = product && product.categoryId ? product.categoryId : '';
    const catF = field({
      id: 'p-cat',
      label: 'Kategori',
      input: catSel,
      hint: data.categories.length ? null : 'Belum ada kategori. Boleh ditambah kemudian di skrin Kategori.',
    });

    const availRow = switchRow({ id: 'p-avail', title: 'Tersedia', desc: 'Matikan bila habis stok. Produk kekal dipaparkan dengan label "Habis".', checked: product ? product.isAvailable : true });

    nameIn.addEventListener('input', () => nameF.msg(''));
    // Harga terformat dipapar semasa menaip, bukan semasa blur: mesej yang muncul ketika blur menolak butang
    // Simpan ke bawah tepat ketika peniaga menekannya, dan tekanan itu terlepas.
    const showPrice = () => {
      const sen = parsePriceToSen(priceIn.value);
      priceF.msg(sen === undefined || sen === null ? '' : formatSen(sen), 'ok');
    };
    priceIn.addEventListener('input', showPrice);
    priceIn.addEventListener('blur', () => {
      if (parsePriceToSen(priceIn.value) === undefined) priceF.msg(MSG.harga);
    });
    showPrice();

    // ---------------- simpan dan padam
    const saveBtn = h('button', { type: 'button', class: 'btn btn-block' }, isNew ? 'Simpan produk' : 'Simpan perubahan');
    const deleteBtn = isNew ? null : h('button', { type: 'button', class: 'btn btn-danger btn-block' }, icon('padam'), h('span', {}, 'Padam produk'));

    saveBtn.addEventListener('click', async () => {
      const name = cleanText(nameIn.value);
      const priceSen = parsePriceToSen(priceIn.value);
      let bad = false;
      if (!name) {
        nameF.msg(MSG.namaProduk);
        bad = true;
      }
      if (priceSen === undefined) {
        priceF.msg(MSG.harga);
        bad = true;
      }
      if (bad) return;

      const payload = {
        name,
        priceSen,
        description: cleanText(descIn.value, { multiline: true }),
        categoryId: catSel.value || null,
        isAvailable: availRow.input.checked,
      };

      saveBtn.disabled = true;
      saveBtn.textContent = 'Sedang simpan...';
      try {
        if (picked) {
          setImgMsg('Memuat naik gambar...', 'muted');
          const big = await upload('product', picked.big);
          const thumb = await upload('thumb', picked.thumb);
          payload.imageKey = big.key;
          payload.thumbKey = thumb.key;
        } else if (removeImage) {
          payload.imageKey = null;
          payload.thumbKey = null;
        }
        if (isNew) await api('/api/products', { method: 'POST', body: payload });
        else await api(`/api/products/${product.id}`, { method: 'PATCH', body: payload });
        toast(isNew ? 'Produk ditambah.' : 'Produk disimpan.', 'success');
        done();
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = isNew ? 'Simpan produk' : 'Simpan perubahan';
        if (err.status === 401) return ctx.onError(err);
        if (err.code === CATALOG_WARNING) {
          toast(err.message, 'error');
          return done();
        }
        setImgMsg('');
        if (err.fields) {
          if (err.fields.name) nameF.msg(err.fields.name);
          if (err.fields.priceSen) priceF.msg(err.fields.priceSen);
          if (err.fields.description) descF.msg(err.fields.description);
          if (err.fields.categoryId) catF.msg(err.fields.categoryId);
        }
        if (err.code === 'had-produk' || err.code === 'had-storage') {
          setImgMsg(err.message);
        }
        toast(err.message, 'error');
      }
    });

    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (!window.confirm(`Padam "${product.name}"? Gambar produk ini juga akan dipadam.`)) return;
        deleteBtn.disabled = true;
        try {
          await api(`/api/products/${product.id}`, { method: 'DELETE' });
          toast('Produk dipadam.', 'success');
          done();
        } catch (err) {
          deleteBtn.disabled = false;
          if (err.status === 401) return ctx.onError(err);
          if (err.code === CATALOG_WARNING) {
            toast(err.message, 'error');
            return done();
          }
          toast(err.message, 'error');
        }
      });
    }

    function done() {
      if (picked) URL.revokeObjectURL(picked.url);
      ctx.reloadMe({ render: false }); // kemas kini meter penggunaan
      window.location.hash = '#/produk';
    }

    renderImage();
    return h(
      'div',
      { class: 'stack' },
      h(
        'section',
        { class: 'card stack' },
        h('div', { class: 'image-field' }, preview, h('div', { class: 'stack-sm' }, fileIn, pickBtn, removeBtn, h('p', { class: 'caption' }, 'Dimampatkan automatik. Gambar besar dari kamera pun boleh.'))),
        imgMsg,
        nameF.el,
        priceF.el,
        catF.el,
        descF.el,
        h('div', { class: 'switch-list' }, availRow.el),
      ),
      saveBtn,
      deleteBtn,
    );
  }

  load();
  return root;
}
