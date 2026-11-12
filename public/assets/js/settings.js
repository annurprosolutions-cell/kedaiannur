// S-13 Tetapan kedai: maklumat, slug, WhatsApp, warna, suis buka/tutup dan minta nama/alamat, serta banner.
// Template mesej WhatsApp (Pro) dibuka dalam Fasa 5. Banner disimpan serta-merta setiap tindakan;
// bahagian lain disimpan dengan butang Simpan perubahan (hanya medan yang berubah dihantar).

import { api, upload } from './api.js';
import { getConfig, mediaUrl } from './config.js';
import { h, icon, toast } from './ui.js';
import { field, textArea, textInput, switchRow, swatches, formatBytes } from './forms.js';
import { compressBitmap, readImage, releaseImage, ImageError } from './image.js';
import { openCropper } from './cropper.js';
import {
  LIMITS, MSG, TEMPLATE_PLACEHOLDERS, cleanText, formatWhatsapp, isReservedLocally, normalizeHours, normalizeMapsUrl, normalizeSlug,
  normalizeSocial, normalizeWhatsapp, slugFormatIssue, validateTemplate, SHOP_CATEGORIES, MARKET_MIN_PRODUCTS,
} from './rules.js';
import { addToCart, buildMessage, emptyCart, summarize } from './order.js';

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

    // ------------------------------------------------ maklumat hubungan (waktu, lokasi, media sosial)
    const hoursIn = textArea({ rows: 2, maxlength: LIMITS.hoursMax, placeholder: 'Contoh: Isnin hingga Jumaat, 9 pagi hingga 6 petang' });
    hoursIn.value = shop.openingHours || '';
    const hoursF = field({ id: 's-hours', label: 'Waktu operasi', input: hoursIn, hint: 'Pilihan. Dipaparkan di bawah nama kedai.' });
    const urlInput = (placeholder) => textInput({ inputmode: 'url', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', placeholder });
    const mapsIn = urlInput('https://maps.app.goo.gl/...');
    mapsIn.value = shop.mapsUrl || '';
    const mapsF = field({ id: 's-maps', label: 'Lokasi Google Maps', input: mapsIn, hint: 'Dalam Google Maps: cari kedai anda, tekan Kongsi, kemudian salin pautan.' });
    const igIn = urlInput('@namakedai');
    igIn.value = shop.instagram ? `@${shop.instagram}` : '';
    const igF = field({ id: 's-ig', label: 'Instagram', input: igIn });
    const ttIn = urlInput('@namakedai');
    ttIn.value = shop.tiktok ? `@${shop.tiktok}` : '';
    const ttF = field({ id: 's-tt', label: 'TikTok', input: ttIn });
    const fbIn = urlInput('namakedai atau pautan halaman');
    fbIn.value = shop.facebook || '';
    const fbF = field({ id: 's-fb', label: 'Facebook', input: fbIn });
    // [kunci API, input, medan, penormal, nilai semasa]
    const contact = [
      ['openingHours', hoursIn, hoursF, normalizeHours, shop.openingHours || ''],
      ['mapsUrl', mapsIn, mapsF, normalizeMapsUrl, shop.mapsUrl || ''],
      ['instagram', igIn, igF, (v) => normalizeSocial('instagram', v), shop.instagram || ''],
      ['tiktok', ttIn, ttF, (v) => normalizeSocial('tiktok', v), shop.tiktok || ''],
      ['facebook', fbIn, fbF, (v) => normalizeSocial('facebook', v), shop.facebook || ''],
    ];

    // ------------------------------------------------ Marketplace (jenis kedai dan pilihan disenaraikan)
    const market = shop.market || { listed: false, issues: [], defaultOn: false };
    const catSel = h(
      'select',
      { class: 'input' },
      h('option', { value: '' }, 'Pilih jenis kedai'),
      SHOP_CATEGORIES.map((c) => h('option', { value: c.code, selected: c.code === shop.category }, c.name)),
    );
    const catF = field({ id: 's-cat', label: 'Jenis kedai', input: catSel, hint: 'Pembeli boleh tapis Marketplace ikut jenis kedai.' });
    const marketOn = shop.marketOpt === null || shop.marketOpt === undefined ? market.defaultOn : shop.marketOpt;
    const marketRow = switchRow({
      id: 's-market',
      title: 'Senaraikan kedai saya di Marketplace',
      desc: shop.plan.code !== 'free' ? 'Pelan Pro disenaraikan secara automatik. Matikan jika tak mahu.' : 'Pilihan untuk pelan Percuma. Pelan Pro disenaraikan secara automatik.',
      checked: marketOn,
      onChange: () => refresh(),
    });
    const marketStatus = h(
      'div',
      { class: market.listed ? 'notice notice-success' : 'notice notice-info', role: 'status' },
      market.listed
        ? h('p', { class: 'm0' }, 'Kedai anda dipaparkan di Marketplace.')
        : h(
            'div',
            {},
            h('p', { class: 'm0' }, market.wants ? 'Belum dipaparkan. Lengkapkan perkara ini dahulu:' : 'Kedai anda tidak dipaparkan di Marketplace.'),
            market.wants && market.issues.length ? h('ul', { class: 'issue-list' }, market.issues.map((t) => h('li', {}, t))) : null,
          ),
    );

    // ------------------------------------------------ warna dan paparan
    const sw = swatches(shop.themeColor, () => refresh());
    const openRow = switchRow({ id: 's-open', title: 'Kedai sedang buka', desc: 'Bila ditutup, pelanggan nampak kedai tapi tak boleh hantar order.', checked: shop.isOpen, onChange: () => refresh() });
    const nameRow = switchRow({ id: 's-askname', title: 'Minta nama pelanggan', desc: 'Pelanggan isi nama sebelum hantar ke WhatsApp.', checked: shop.askName, onChange: () => refresh() });
    const addrRow = switchRow({ id: 's-askaddr', title: 'Minta alamat pelanggan', desc: 'Sesuai untuk penghantaran.', checked: shop.askAddress, onChange: () => refresh() });

    // ------------------------------------------------ templat mesej WhatsApp (Pro, F-12)
    const canTemplate = shop.plan.customTemplate;
    const tplIn = textArea({ rows: 7, maxlength: LIMITS.templateMax, placeholder: 'Kosongkan untuk guna templat lalai.', disabled: !canTemplate });
    tplIn.value = shop.messageTemplate || '';
    const tplF = field({ id: 's-tpl', label: 'Templat mesej order', input: tplIn, hint: `${tplIn.value.length}/${LIMITS.templateMax}` });
    const tplPreview = h('pre', { class: 'msg-preview', id: 'tpl-preview', 'aria-live': 'polite' });
    const sampleItems = new Map([
      ['s1', { id: 's1', n: 'Nasi Lemak Ayam', p: 850, a: true }],
      ['s2', { id: 's2', n: 'Teh Tarik', p: 350, a: true }],
      ['s3', { id: 's3', n: 'Kek Tempahan', p: null, a: true }],
    ]);
    const sampleCart = emptyCart();
    addToCart(sampleCart, 's1', 2, 'tak pedas');
    addToCart(sampleCart, 's2', 1);
    addToCart(sampleCart, 's3', 1);

    function renderTplPreview() {
      const t = validateTemplate(tplIn.value);
      tplF.hint(`${tplIn.value.length}/${LIMITS.templateMax}${t.value === null ? ' · templat lalai digunakan' : ''}`);
      tplF.msg(t.error || '');
      tplPreview.textContent = buildMessage({
        shop: { name: nameIn.value || shop.name, tpl: t.error ? null : t.value },
        summary: summarize(sampleCart, sampleItems),
        name: 'Ali',
        address: addrRow.input.checked ? 'No 1, Jalan Contoh, Shah Alam' : '',
        note: 'Ambil pukul 5 petang',
      });
    }

    const chips = h(
      'div',
      { class: 'chips chips-wrap', role: 'group', 'aria-label': 'Masukkan maklumat ke dalam templat' },
      TEMPLATE_PLACEHOLDERS.map((p) => {
        const b = h('button', { type: 'button', class: 'chip', disabled: !canTemplate, title: p.label }, p.key);
        b.addEventListener('click', () => {
          tplIn.focus();
          tplIn.setRangeText(p.key, tplIn.selectionStart, tplIn.selectionEnd, 'end');
          tplIn.dispatchEvent(new Event('input'));
        });
        return b;
      }),
    );
    const resetTpl = h('button', { type: 'button', class: 'btn btn-secondary btn-block', disabled: !canTemplate }, 'Guna templat lalai');
    resetTpl.addEventListener('click', () => {
      tplIn.value = '';
      tplIn.dispatchEvent(new Event('input'));
    });
    tplIn.addEventListener('input', () => {
      renderTplPreview();
      refresh();
    });
    addrRow.input.addEventListener('change', renderTplPreview);
    nameIn.addEventListener('input', renderTplPreview);

    const templateSection = h(
      'section',
      { class: 'card stack' },
      h('h2', {}, 'Mesej WhatsApp'),
      canTemplate
        ? h('p', { class: 'muted' }, 'Tulis ayat mesej order mengikut gaya kedai anda. Tekan butang untuk masukkan maklumat order.')
        : h('p', { class: 'notice notice-warning' }, 'Templat mesej sendiri untuk pelan Pro. Pratonton di bawah ialah templat lalai. ', h('a', { href: '#/langganan' }, 'Naik taraf ke Pro')),
      tplF.el,
      chips,
      canTemplate ? resetTpl : null,
      h('p', { class: 'd-label' }, 'Pratonton (contoh order)'),
      tplPreview,
    );
    renderTplPreview();

    // ------------------------------------------------ simpan
    const saveBtn = h('button', { type: 'button', class: 'btn btn-block', disabled: true }, 'Simpan perubahan');

    function collect() {
      const diff = {};
      if (catSel.value !== (shop.category || '')) diff.category = catSel.value;
      if (marketRow.input.checked !== marketOn) diff.marketOpt = marketRow.input.checked;
      for (const [key, input, , norm, current] of contact) {
        const r = norm(input.value);
        const next = r.error ? input.value.trim() : r.value;
        if (next !== current) diff[key] = input.value;
      }
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
      if (canTemplate) {
        const t = validateTemplate(tplIn.value);
        const next = t.error ? tplIn.value : t.value;
        if (next !== shop.messageTemplate) diff.messageTemplate = next;
      }
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
    catSel.addEventListener('change', () => {
      catF.msg('');
      refresh();
    });
    for (const [, input, f] of contact) {
      input.addEventListener('input', () => {
        f.msg('');
        refresh();
      });
    }
    descIn.addEventListener('input', () => {
      descF.hint(`${descIn.value.length}/${LIMITS.descMax}`);
      refresh();
    });

    saveBtn.addEventListener('click', async () => {
      const diff = collect();
      const errors = {};
      if ('name' in diff && (diff.name.length < LIMITS.nameMin || diff.name.length > LIMITS.nameMax)) errors.name = MSG.nama;
      if ('whatsapp' in diff && !normalizeWhatsapp(diff.whatsapp)) errors.whatsapp = MSG.whatsapp;
      if ('messageTemplate' in diff) {
        const t = validateTemplate(diff.messageTemplate);
        if (t.error) errors.messageTemplate = t.error;
        else diff.messageTemplate = t.value;
      }
      for (const [key, , f, norm] of contact) {
        if (!(key in diff)) continue;
        const r = norm(diff[key]);
        if (r.error) {
          errors[key] = r.error;
          f.msg(r.error);
        }
      }
      if (errors.messageTemplate) tplF.msg(errors.messageTemplate);
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
        if (err.code === 'katalog-gagal') {
          // Tetapan sudah disimpan; hanya katalog awam gagal dikemas kini.
          toast(err.message, 'error');
          await ctx.reloadMe();
          return;
        }
        if (err.fields) {
          if (err.fields.name) nameF.msg(err.fields.name);
          if (err.fields.slug) {
            slugState = 'bad';
            slugF.msg(err.fields.slug);
          }
          if (err.fields.whatsapp) waF.msg(err.fields.whatsapp);
          if (err.fields.description) descF.msg(err.fields.description);
          if (err.fields.messageTemplate) tplF.msg(err.fields.messageTemplate);
          for (const [key, , f] of contact) if (err.fields[key]) f.msg(err.fields[key]);
          if (err.fields.category) catF.msg(err.fields.category);
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
        else if (err.code === 'katalog-gagal') {
          // Banner sudah disimpan; muat semula senarai sebenar dari server.
          try {
            const fresh = await api('/api/shop');
            banners = fresh.banners;
            storageBytes = fresh.shop.storageBytes;
          } catch {
            /* biar senarai lama */
          }
          setBannerMsg(err.message);
          return true;
        } else setBannerMsg(err.message);
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
      let bitmap = null;
      try {
        bitmap = await readImage(file);
        const crop = await openCropper(bitmap, 'banner');
        if (!crop) {
          busy = false;
          renderBanners();
          return;
        }
        setBannerMsg('Memampatkan dan memuat naik...', 'muted');
        const out = await compressBitmap(bitmap, 'banner', crop);
        releaseImage(bitmap);
        bitmap = null;
        const up = await upload('banner', out.blob);
        busy = false;
        await applyKeys([...banners.map((b) => b.key), up.key], 'Banner ditambah.');
      } catch (err) {
        busy = false;
        if (err.status === 401) ctx.onError(err);
        else setBannerMsg(err instanceof ImageError || err.message ? err.message : 'Banner tak berjaya dimuat naik.');
        renderBanners();
      } finally {
        releaseImage(bitmap);
      }
    });
    renderBanners();

    // ------------------------------------------------ logo (semua pelan; Pro: juga favicon kedai)
    let logoKey = shop.logoKey || null;
    let logoBusy = false;
    const logoMsg = h('p', { class: 'field-msg', id: 'logo-msg', 'aria-live': 'polite' });
    const logoPreview = h('div', { class: 'logo-preview-wrap' });
    const logoFile = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', id: 's-logo-file', tabindex: '-1', 'aria-label': 'Fail gambar logo' });
    const logoPick = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, icon('gambar'), h('span', {}, 'Muat naik logo'));
    const logoRemove = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, icon('padam'), h('span', {}, 'Buang logo'));
    const isPro = shop.plan.hideBranding;
    const logoNote = h(
      'p',
      { class: 'caption' },
      isPro
        ? 'Saiz terbaik 512 x 512 piksel, segi empat. Dipaparkan dalam bulatan di atas kedai dan dalam pratonton link WhatsApp. Pelan Pro: logo juga menjadi ikon tab dan ikon skrin utama kedai anda.'
        : 'Saiz terbaik 512 x 512 piksel, segi empat. Dipaparkan dalam bulatan di atas kedai dan dalam pratonton link WhatsApp. Pelan Pro: logo juga menjadi ikon tab dan ikon skrin utama kedai.',
    );
    const setLogoMsg = (text, kind = 'error') => {
      logoMsg.textContent = text || '';
      logoMsg.dataset.kind = text ? kind : '';
    };
    function renderLogo() {
      const url = logoKey ? mediaUrl(cfg, logoKey) : '';
      logoPreview.replaceChildren(
        url ? h('img', { class: 'logo-preview', src: url, alt: 'Logo kedai' }) : h('span', { class: 'logo-preview', 'aria-hidden': 'true' }, icon('kedai')),
      );
      logoPick.lastChild.textContent = logoKey ? 'Tukar logo' : 'Muat naik logo';
      logoRemove.hidden = !logoKey;
      logoPick.disabled = logoBusy;
      logoRemove.disabled = logoBusy;
    }
    async function saveLogo(key, okText) {
      const res = await api('/api/shop/logo', { method: 'PUT', body: { key } });
      logoKey = res.logoKey;
      storageBytes = res.storageBytes;
      shop = { ...shop, logoKey, storageBytes };
      setLogoMsg(okText, 'ok');
      renderBanners();
    }
    logoPick.addEventListener('click', () => logoFile.click());
    logoRemove.addEventListener('click', async () => {
      if (logoBusy) return;
      logoBusy = true;
      renderLogo();
      try {
        await saveLogo(null, 'Logo dibuang.');
      } catch (err) {
        if (err.status === 401) ctx.onError(err);
        else setLogoMsg(err.message || 'Logo tak berjaya dibuang.');
      } finally {
        logoBusy = false;
        renderLogo();
      }
    });
    logoFile.addEventListener('change', async () => {
      const file = logoFile.files && logoFile.files[0];
      logoFile.value = '';
      if (!file || logoBusy) return;
      logoBusy = true;
      renderLogo();
      let bitmap = null;
      try {
        bitmap = await readImage(file);
        const crop = await openCropper(bitmap, 'logo');
        if (!crop) return;
        setLogoMsg('Memampatkan dan memuat naik...', 'muted');
        const out = await compressBitmap(bitmap, 'logo', crop);
        releaseImage(bitmap);
        bitmap = null;
        const up = await upload('logo', out.blob);
        await saveLogo(up.key, 'Logo disimpan.');
      } catch (err) {
        if (err.status === 401) ctx.onError(err);
        else setLogoMsg(err instanceof ImageError || err.message ? err.message : 'Logo tak berjaya dimuat naik.');
      } finally {
        releaseImage(bitmap);
        logoBusy = false;
        renderLogo();
      }
    });
    renderLogo();

    // ------------------------------------------------ susun atur
    return h(
      'div',
      { class: 'stack' },
      h('section', { class: 'card stack' }, h('h2', {}, 'Maklumat kedai'), nameF.el, slugF.el, slugWarn, waF.el, descF.el),
      h(
        'section',
        { class: 'card stack' },
        h('h2', {}, 'Waktu, lokasi dan media sosial'),
        h('p', { class: 'caption' }, 'Semua pilihan. Yang diisi sahaja dipaparkan di halaman kedai.'),
        hoursF.el,
        mapsF.el,
        igF.el,
        ttF.el,
        fbF.el,
      ),
      h(
        'section',
        { class: 'card stack' },
        h('h2', {}, 'Marketplace'),
        h('p', { class: 'caption' }, `Marketplace menyenaraikan kedai di kedai.annurpro.com/marketplace. Syarat: jenis kedai dipilih, ada logo atau banner, dan sekurang-kurangnya ${MARKET_MIN_PRODUCTS} produk yang ada stok.`),
        catF.el,
        h('div', { class: 'switch-list' }, marketRow.el),
        marketStatus,
        h('a', { class: 'btn btn-secondary btn-sm', href: '/marketplace', target: '_blank', rel: 'noopener' }, icon('luar'), h('span', {}, 'Lihat Marketplace')),
      ),
      h(
        'section',
        { class: 'card stack' },
        h('h2', {}, 'Warna dan paparan'),
        h('div', { class: 'stack-sm' }, h('h3', {}, 'Warna tema'), sw.el),
        h('div', { class: 'switch-list' }, openRow.el, nameRow.el, addrRow.el),
      ),
      templateSection,
      saveBtn,
      h(
        'section',
        { class: 'card stack' },
        h('h2', {}, 'Logo'),
        h('div', { class: 'logo-row' }, logoPreview, h('div', { class: 'stack-sm' }, logoFile, logoPick, logoRemove)),
        logoNote,
        logoMsg,
      ),
      h(
        'section',
        { class: 'card stack' },
        h('h2', {}, 'Banner'),
        h(
          'div',
          { class: 'guide stack-sm' },
          h('p', { class: 'caption' }, 'Saiz terbaik 1600 x 800 piksel (nisbah 2:1). Letak tajuk dan teks penting di tengah; bahagian bawah kiri dilindungi logo kedai jika ada.'),
          h('a', { class: 'btn btn-secondary btn-sm', href: '/assets/templates/templat-banner-1600x800.png', download: 'templat-banner-kedai-1600x800.png' }, icon('gambar'), h('span', {}, 'Muat turun templat banner')),
        ),
        bannerList, bannerNote, bannerStorage, fileIn, addBtn, upgrade, bannerMsg),
    );
  }

  load();
  return root;
}
