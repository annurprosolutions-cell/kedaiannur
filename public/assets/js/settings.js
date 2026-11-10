// S-13 Tetapan kedai: maklumat, slug, WhatsApp, warna, suis buka/tutup dan minta nama/alamat, serta banner.
// Template mesej WhatsApp (Pro) dibuka dalam Fasa 5. Banner disimpan serta-merta setiap tindakan;
// bahagian lain disimpan dengan butang Simpan perubahan (hanya medan yang berubah dihantar).

import { api, upload } from './api.js';
import { getConfig, mediaUrl } from './config.js';
import { h, icon, toast } from './ui.js';
import { field, textArea, textInput, switchRow, swatches, formatBytes } from './forms.js';
import { compressImage, ImageError } from './image.js';
import {
  LIMITS, MSG, cleanText, formatWhatsapp, isReservedLocally, normalizeSlug, normalizeWhatsapp, slugFormatIssue,
} from './rules.js';

export function viewSettings(ctx) {
  const root = h('div', { class: 'stack' }, h('h1', {}, 'Tetapan kedai'));
  const loading = h('div', { class: 'skeleton', style: 'height:240px' });
  root.appendChild(loading);

  async function load() {
    try {
      const [cfg, data] = await Promise.all([getConfig(), api('/api/shop')]);
      loading.remove();
      root.appendChild(build(cfg, data));
    } catch (err) {
      if (err.status === 401) return ctx.onError(err);
      loading.replaceWith(
        h(
          'div',
          { class: 'card stack' },
          h('p', { role: 'alert' }, err.message),
          h('button', { type: 'button', class: 'btn btn-block', onclick: () => location.reload() }, 'Cuba semula'),
        ),
      );
    }
  }

  function build(cfg, data) {
    let shop = data.shop;
    let banners = data.banners;

    // ------------------------------------------------ maklumat kedai
    const nameIn = textInput({ maxlength: LIMITS.nameMax, autocomplete: 'organization' });
    nameIn.value = shop.name;
    const nameF = field({ id: 's-name', label: 'Nama kedai', input: nameIn });

    const slugIn = textInput({ maxlength: LIMITS.slugMax, inputmode: 'url', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false' });
    slugIn.value = shop.slug;
    const slugLocked = shop.slugChangesLeft <= 0;
    if (slugLocked) slugIn.readOnly = true;
    const slugF = field({
      id: 's-slug',
      label: 'Nama dalam link',
      input: slugIn,
      hint: slugLocked
        ? `Nama link sudah ditukar ${LIMITS.slugChangesMax} kali, had dicapai.`
        : `kedai.annurpro.com/${shop.slug}. Boleh ditukar ${shop.slugChangesLeft} kali lagi.`,
    });
    const slugWarn = h('p', { class: 'notice notice-warning', role: 'status', hidden: true });

    const waIn = textInput({ type: 'tel', inputmode: 'tel', autocomplete: 'tel', maxlength: 24 });
    waIn.value = formatWhatsapp(shop.whatsapp);
    const waF = field({ id: 's-wa', label: 'Nombor WhatsApp', input: waIn, hint: 'Nombor yang menerima order pelanggan.' });

    const descIn = textArea({ maxlength: LIMITS.descMax, placeholder: 'Contoh: Kuih tradisional, buat atas tempahan.' });
    descIn.value = shop.description;
    const descF = field({ id: 's-desc', label: 'Penerangan ringkas', input: descIn, hint: `${shop.description.length}/${LIMITS.descMax}` });

    // ------------------------------------------------ warna dan paparan
    const sw = swatches(shop.themeColor, () => refresh());
    const openRow = switchRow({ id: 's-open', title: 'Kedai sedang buka', desc: 'Bila ditutup, pelanggan nampak kedai tapi tak boleh hantar order.', checked: shop.isOpen, onChange: () => refresh() });
    const nameRow = switchRow({ id: 's-askname', title: 'Minta nama pelanggan', desc: 'Pelanggan isi nama sebelum hantar ke WhatsApp.', checked: shop.askName, onChange: () => refresh() });
    const addrRow = switchRow({ id: 's-askaddr', title: 'Minta alamat pelanggan', desc: 'Sesuai untuk penghantaran.', checked: shop.askAddress, onChange: () => refresh() });

    // ------------------------------------------------ simpan
    const saveBtn = h('button', { type: 'button', class: 'btn btn-block', disabled: true }, 'Simpan perubahan');

    function collect() {
      const diff = {};
      const name = cleanText(nameIn.value);
      if (name !== shop.name) diff.name = name;
      const slug = normalizeSlug(slugIn.value);
      if (!slugLocked && slug !== shop.slug) diff.slug = slug;
      const wa = normalizeWhatsapp(waIn.value);
      if (wa !== shop.whatsapp) diff.whatsapp = wa ?? waIn.value;
      const desc = cleanText(descIn.value, { multiline: true });
      if (desc !== shop.description) diff.description = desc;
      if (sw.get() !== shop.themeColor) diff.themeColor = sw.get();
      if (openRow.input.checked !== shop.isOpen) diff.isOpen = openRow.input.checked;
      if (nameRow.input.checked !== shop.askName) diff.askName = nameRow.input.checked;
      if (addrRow.input.checked !== shop.askAddress) diff.askAddress = addrRow.input.checked;
      return diff;
    }

    let slugState = 'ok'; // 'ok' = tak berubah atau tersedia
    let slugTimer = null;
    let slugSeq = 0;
    let resolvedSlug = null; // slug yang keputusan semakannya sudah diterima dari server

    function refresh() {
      const dirty = Object.keys(collect()).length > 0;
      saveBtn.disabled = !dirty || slugState === 'checking' || slugState === 'bad';
    }

    function checkSlug({ onBlur = false } = {}) {
      const slug = normalizeSlug(slugIn.value);
      // Blur tak patut menyemak semula slug yang sudah ada keputusan: butang Simpan akan dilumpuhkan seketika
      // dan klik peniaga hilang.
      if (onBlur && slug === resolvedSlug && slugState !== 'checking') return;
      clearTimeout(slugTimer);
      slugSeq++;
      if (slugIn.value !== slug) slugIn.value = slug;

      if (slug === shop.slug) {
        slugState = 'ok';
        slugF.msg('');
        slugWarn.hidden = true;
        return refresh();
      }
      slugWarn.hidden = false;
      slugWarn.textContent = `Menukar nama link akan mematikan link lama (kedai.annurpro.com/${shop.slug}). Pelanggan yang simpan link lama tak akan sampai ke kedai anda. Baki tukar: ${shop.slugChangesLeft}.`;

      const issue = slugFormatIssue(slug);
      if (issue || isReservedLocally(slug)) {
        slugState = 'bad';
        const quiet = issue && !onBlur && (issue.code === 'panjang' || issue.code === 'sempang');
        slugF.msg(quiet ? '' : issue ? issue.message : MSG.slugTakBoleh);
        return refresh();
      }
      slugState = 'checking';
      slugF.msg('Menyemak...', 'muted');
      refresh();
      const mine = slugSeq;
      slugTimer = setTimeout(async () => {
        try {
          const r = await api(`/api/slug-check?slug=${encodeURIComponent(slug)}`);
          if (mine !== slugSeq) return;
          resolvedSlug = slug;
          slugState = r.available ? 'ok' : 'bad';
          slugF.msg(r.available ? 'Tersedia' : r.message, r.available ? 'ok' : 'error');
        } catch (err) {
          if (mine !== slugSeq) return;
          if (err.status === 401) return ctx.onError(err);
          slugState = 'bad';
          slugF.msg(err.message, 'error');
        }
        refresh();
      }, 350);
    }

    nameIn.addEventListener('input', () => {
      nameF.msg('');
      refresh();
    });
    slugIn.addEventListener('input', () => checkSlug());
    slugIn.addEventListener('blur', () => checkSlug({ onBlur: true }));
    waIn.addEventListener('input', () => {
      waF.msg('');
      refresh();
    });
    descIn.addEventListener('input', () => {
      descF.hint(`${descIn.value.length}/${LIMITS.descMax}`);
      refresh();
    });

    saveBtn.addEventListener('click', async () => {
      const diff = collect();
      const errors = {};
      if ('name' in diff && (diff.name.length < LIMITS.nameMin || diff.name.length > LIMITS.nameMax)) errors.name = MSG.nama;
      if ('whatsapp' in diff && !normalizeWhatsapp(diff.whatsapp)) errors.whatsapp = MSG.whatsapp;
      if (errors.name) nameF.msg(errors.name);
      if (errors.whatsapp) waF.msg(errors.whatsapp);
      if (Object.keys(errors).length) return;

      saveBtn.disabled = true;
      saveBtn.textContent = 'Sedang simpan...';
      try {
        await api('/api/shop', { method: 'PATCH', body: diff });
        toast('Tetapan disimpan.', 'success');
        await ctx.reloadMe(); // render semula: tetapan dimuat semula daripada server
      } catch (err) {
        saveBtn.textContent = 'Simpan perubahan';
        if (err.status === 401) return ctx.onError(err);
        if (err.fields) {
          if (err.fields.name) nameF.msg(err.fields.name);
          if (err.fields.slug) {
            slugState = 'bad';
            slugF.msg(err.fields.slug);
          }
          if (err.fields.whatsapp) waF.msg(err.fields.whatsapp);
          if (err.fields.description) descF.msg(err.fields.description);
        }
        toast(err.message, 'error');
        refresh();
      }
    });

    // ------------------------------------------------ banner
    const bannerList = h('ul', { class: 'banner-list', 'aria-label': 'Senarai banner' });
    const bannerMsg = h('p', { class: 'field-msg', id: 'banner-msg', 'aria-live': 'polite' });
    const bannerNote = h('p', { class: 'caption' });
    const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', id: 's-banner-file', tabindex: '-1', 'aria-label': 'Fail gambar banner' });
    const addBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, icon('tambah'), h('span', {}, 'Tambah banner'));
    const upgrade = h('a', { class: 'btn btn-secondary btn-block', href: '#/langganan', hidden: true }, 'Lihat pelan Pro');
    let busy = false;
    let storageBytes = shop.storageBytes;

    const setBannerMsg = (text, kind = 'error') => {
      bannerMsg.textContent = text || '';
      bannerMsg.dataset.kind = text ? kind : '';
    };

    function renderBanners() {
      const max = shop.plan.maxBanners;
      bannerList.replaceChildren(
        ...banners.map((b, i) => {
          const url = mediaUrl(cfg, b.key);
          const thumb = url ? h('img', { src: url, alt: `Banner ${i + 1}`, loading: 'lazy' }) : h('div', { class: 'banner-ph' }, icon('gambar'));
          const btn = (label, ic, onclick, disabled) =>
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label, onclick, disabled: disabled || busy }, icon(ic));
          return h(
            'li',
            { class: 'banner-item', 'data-key': b.key },
            thumb,
            h('span', { class: 'caption banner-size' }, formatBytes(b.bytes)),
            h(
              'span',
              { class: 'banner-actions' },
              btn(`Naikkan banner ${i + 1}`, 'atas', () => move(i, -1), i === 0),
              btn(`Turunkan banner ${i + 1}`, 'bawah', () => move(i, 1), i === banners.length - 1),
              btn(`Buang banner ${i + 1}`, 'padam', () => removeAt(i)),
            ),
          );
        }),
      );
      const full = banners.length >= max;
      addBtn.disabled = full || busy;
      upgrade.hidden = !(full && shop.plan.code === 'free');
      bannerNote.textContent = full
        ? `Had ${max} banner pelan ${shop.plan.name} dicapai.${shop.plan.code === 'free' ? ' Pro membenarkan sehingga 5 banner yang berputar.' : ''}`
        : `${banners.length} daripada ${max} banner. Nisbah 2:1, dimampatkan automatik.`;
      bannerStorage.textContent = `Storage gambar: ${formatBytes(storageBytes)} daripada ${formatBytes(shop.plan.maxStorageBytes)}`;
    }
    const bannerStorage = h('p', { class: 'caption', id: 'storage-note' });

    async function applyKeys(keys, okText) {
      if (busy) return false;
      busy = true;
      renderBanners();
      try {
        const res = await api('/api/shop/banners', { method: 'PUT', body: { keys } });
        banners = res.banners;
        storageBytes = res.storageBytes;
        setBannerMsg(okText, 'ok');
        return true;
      } catch (err) {
        if (err.status === 401) ctx.onError(err);
        else setBannerMsg(err.message);
        return false;
      } finally {
        busy = false;
        renderBanners();
      }
    }

    const move = (i, d) => {
      const keys = banners.map((b) => b.key);
      [keys[i], keys[i + d]] = [keys[i + d], keys[i]];
      return applyKeys(keys, 'Susunan banner dikemas kini.');
    };
    const removeAt = (i) => applyKeys(banners.filter((_, j) => j !== i).map((b) => b.key), 'Banner dibuang.');

    addBtn.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', async () => {
      const file = fileIn.files && fileIn.files[0];
      fileIn.value = '';
      if (!file || busy) return;
      busy = true;
      renderBanners();
      setBannerMsg('Memampatkan dan memuat naik...', 'muted');
      try {
        const out = await compressImage(file, 'banner');
        const up = await upload('banner', out.blob);
        busy = false;
        await applyKeys([...banners.map((b) => b.key), up.key], 'Banner ditambah.');
      } catch (err) {
        busy = false;
        if (err.status === 401) ctx.onError(err);
        else setBannerMsg(err instanceof ImageError || err.message ? err.message : 'Banner tak berjaya dimuat naik.');
        renderBanners();
      }
    });
    renderBanners();

    // ------------------------------------------------ susun atur
    return h(
      'div',
      { class: 'stack' },
      h('section', { class: 'card stack' }, h('h2', {}, 'Maklumat kedai'), nameF.el, slugF.el, slugWarn, waF.el, descF.el),
      h(
        'section',
        { class: 'card stack' },
        h('h2', {}, 'Warna dan paparan'),
        h('div', { class: 'stack-sm' }, h('h3', {}, 'Warna tema'), sw.el),
        h('div', { class: 'switch-list' }, openRow.el, nameRow.el, addrRow.el),
      ),
      saveBtn,
      h('section', { class: 'card stack' }, h('h2', {}, 'Banner'), bannerList, bannerNote, bannerStorage, fileIn, addBtn, upgrade, bannerMsg),
    );
  }

  load();
  return root;
}
