// S-08 Setup kedai dalam 3 langkah (AFD "Peniaga daftar dan siapkan kedai"):
//   1. nama kedai dan slug  2. nombor WhatsApp  3. warna dan banner (boleh langkau)
// Kedai dicipta sekali sahaja pada langkah akhir (Simpan). Banner dimuat naik selepas kedai wujud
// kerana kunci objek R2 bergantung pada id kedai; kegagalan banner tak membatalkan kedai.

import { api, upload } from './api.js';
import { h, icon, toast } from './ui.js';
import { field, textInput, swatches } from './forms.js';
import { compressBitmap, readImage, releaseImage, ImageError } from './image.js';
import { openCropper } from './cropper.js';
import {
  DEFAULT_THEME, LIMITS, MSG, cleanText, formatWhatsapp, isReservedLocally, normalizeSlug, normalizeWhatsapp,
  slugFormatIssue, slugify,
} from './rules.js';

const STEP_TITLES = ['Nama dan link kedai', 'Nombor WhatsApp', 'Warna dan banner'];

export function viewSetup(ctx) {
  const user = ctx.me.user;
  const st = { step: 1, name: '', slug: '', slugTouched: false, slugState: 'idle', wa: '', color: DEFAULT_THEME, banner: null, busy: false };
  const body = h('div', { class: 'stack' });
  const root = h(
    'div',
    { class: 'stack' },
    h('h1', {}, 'Setup kedai'),
    h('p', { class: 'muted', id: 'setup-greeting' }, `Hai, ${user.name || user.email}. Siapkan kedai anda dalam 3 langkah.`),
    body,
  );

  function clearBanner() {
    if (st.banner) URL.revokeObjectURL(st.banner.url);
    st.banner = null;
  }

  function progress() {
    return h(
      'div',
      { class: 'stepper' },
      h('p', { class: 'caption' }, `Langkah ${st.step} daripada 3`),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': '3', 'aria-valuenow': String(st.step) }, h('span', { style: `width:${(st.step / 3) * 100}%` })),
    );
  }

  function show(step, content) {
    st.step = step;
    body.replaceChildren(h('section', { class: 'card stack' }, progress(), h('h2', {}, STEP_TITLES[step - 1]), content));
    const first = body.querySelector('input:not([type=file]), button.swatch');
    if (first && step > 1) first.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ langkah 1
  function step1() {
    const nameIn = textInput({ maxlength: LIMITS.nameMax, autocomplete: 'organization', placeholder: 'Contoh: Kuih Mak Cik' });
    nameIn.value = st.name;
    const nameF = field({ id: 'f-name', label: 'Nama kedai', input: nameIn });

    const slugIn = textInput({
      maxlength: LIMITS.slugMax, inputmode: 'url', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', placeholder: 'kuih-mak-cik',
    });
    slugIn.value = st.slug;
    const linkHint = () => `Link kedai anda: kedai.annurpro.com/${st.slug || '...'}`;
    const slugF = field({ id: 'f-slug', label: 'Nama dalam link', input: slugIn, hint: linkHint() });

    const next = h('button', { type: 'button', class: 'btn btn-block', disabled: true }, 'Seterusnya');
    const nameValid = () => {
      const n = cleanText(nameIn.value);
      return n.length >= LIMITS.nameMin && n.length <= LIMITS.nameMax;
    };
    const refresh = () => {
      next.disabled = !(nameValid() && st.slugState === 'ok');
    };

    let timer = null;
    let seq = 0;
    let resolvedSlug = null; // slug yang keputusan semakannya sudah diterima dari server

    function checkSlug({ onBlur = false } = {}) {
      const slug = normalizeSlug(slugIn.value);
      // Keluar medan (blur) tak patut menyemak semula slug yang sudah ada keputusan: itu melumpuhkan butang
      // Seterusnya seketika dan klik peniaga hilang.
      if (onBlur && slug === resolvedSlug && st.slugState !== 'checking') return;
      clearTimeout(timer);
      if (slugIn.value !== slug) slugIn.value = slug;
      st.slug = slug;
      slugF.hint(linkHint());
      seq++;

      if (!slug) {
        st.slugState = 'idle';
        slugF.msg('');
        return refresh();
      }
      const issue = slugFormatIssue(slug);
      if (issue) {
        st.slugState = 'format';
        // Semasa menaip, "terlalu pendek" dan sempang di hujung ialah keadaan biasa; tunjuk ralat ini hanya bila keluar medan.
        const quiet = !onBlur && (issue.code === 'panjang' || issue.code === 'sempang') && slug.length < LIMITS.slugMax;
        slugF.msg(quiet ? '' : issue.message);
        return refresh();
      }
      if (isReservedLocally(slug)) {
        st.slugState = 'taken';
        slugF.msg(MSG.slugTakBoleh);
        return refresh();
      }

      st.slugState = 'checking';
      slugF.msg('Menyemak...', 'muted');
      refresh();
      const mine = seq;
      timer = setTimeout(async () => {
        try {
          const r = await api(`/api/slug-check?slug=${encodeURIComponent(slug)}`);
          if (mine !== seq) return; // jawapan lapuk (pengguna dah menaip lagi)
          resolvedSlug = slug;
          st.slugState = r.available ? 'ok' : 'taken';
          slugF.msg(r.available ? 'Tersedia' : r.message, r.available ? 'ok' : 'error');
        } catch (err) {
          if (mine !== seq) return;
          if (err.status === 401) return ctx.onError(err);
          st.slugState = 'error';
          slugF.msg(err.message, 'error');
        }
        refresh();
      }, 350);
    }

    nameIn.addEventListener('input', () => {
      st.name = nameIn.value;
      if (!st.slugTouched) {
        slugIn.value = slugify(nameIn.value);
        checkSlug();
      }
      nameF.msg('');
      refresh();
    });
    nameIn.addEventListener('blur', () => {
      if (nameIn.value && !nameValid()) nameF.msg(MSG.nama);
    });
    slugIn.addEventListener('input', () => {
      st.slugTouched = true;
      checkSlug();
    });
    slugIn.addEventListener('blur', () => checkSlug({ onBlur: true }));
    next.addEventListener('click', () => {
      st.name = cleanText(nameIn.value);
      go(2);
    });

    queueMicrotask(() => {
      if (st.slug) checkSlug();
      refresh();
    });
    return h('div', { class: 'stack' }, nameF.el, slugF.el, next);
  }

  // ------------------------------------------------------------ langkah 2
  function step2() {
    const waIn = textInput({ type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '0123456789', maxlength: 24 });
    waIn.value = st.wa;
    const waF = field({
      id: 'f-wa',
      label: 'Nombor WhatsApp',
      input: waIn,
      hint: 'Pelanggan akan hantar order ke nombor ini. Contoh: 0123456789',
    });
    const preview = h('p', { class: 'wa-preview', id: 'wa-preview', 'aria-live': 'polite' });

    const next = h('button', { type: 'button', class: 'btn btn-block', disabled: true }, 'Seterusnya');
    const back = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, 'Kembali');

    function update({ onBlur = false } = {}) {
      st.wa = waIn.value;
      const n = normalizeWhatsapp(waIn.value);
      next.disabled = !n;
      if (n) {
        waF.msg('');
        preview.replaceChildren(h('span', { class: 'caption' }, 'Disimpan sebagai'), h('strong', {}, formatWhatsapp(n)), h('span', { class: 'caption' }, 'Pastikan betul.'));
      } else {
        preview.replaceChildren();
        if (onBlur && waIn.value.trim()) waF.msg(MSG.whatsapp);
        else if (!onBlur) waF.msg('');
      }
    }

    waIn.addEventListener('input', () => update());
    waIn.addEventListener('blur', () => update({ onBlur: true }));
    next.addEventListener('click', () => go(3));
    back.addEventListener('click', () => go(1));
    update();
    return h('div', { class: 'stack' }, waF.el, preview, h('div', { class: 'btn-row' }, back, next));
  }

  // ------------------------------------------------------------ langkah 3
  function step3() {
    const sw = swatches(st.color, (hex) => {
      st.color = hex;
    });

    const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', id: 'f-banner', tabindex: '-1', 'aria-label': 'Fail gambar banner' });
    const pickBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, icon('gambar'), h('span', {}, 'Pilih gambar banner'));
    const bannerMsg = h('p', { class: 'field-msg', id: 'banner-msg', 'aria-live': 'polite' });
    const previewWrap = h('div', { class: 'banner-preview', hidden: true });
    const removeBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, icon('padam'), h('span', {}, 'Buang'));

    const setMsg = (text, kind = 'error') => {
      bannerMsg.textContent = text || '';
      bannerMsg.dataset.kind = text ? kind : '';
    };

    function renderBanner() {
      if (!st.banner) {
        previewWrap.hidden = true;
        previewWrap.replaceChildren();
        pickBtn.lastChild.textContent = 'Pilih gambar banner';
        return;
      }
      previewWrap.hidden = false;
      previewWrap.replaceChildren(h('img', { src: st.banner.url, alt: 'Pratonton banner' }), removeBtn);
      pickBtn.lastChild.textContent = 'Tukar gambar';
    }

    pickBtn.addEventListener('click', () => fileIn.click());
    removeBtn.addEventListener('click', () => {
      clearBanner();
      setMsg('');
      renderBanner();
    });
    fileIn.addEventListener('change', async () => {
      const file = fileIn.files && fileIn.files[0];
      fileIn.value = '';
      if (!file) return;
      pickBtn.disabled = true;
      save.disabled = true;
      let bitmap = null;
      try {
        bitmap = await readImage(file);
        const crop = await openCropper(bitmap, 'banner');
        if (!crop) return;
        setMsg('Memampatkan gambar...', 'muted');
        const out = await compressBitmap(bitmap, 'banner', crop);
        clearBanner();
        st.banner = { blob: out.blob, url: URL.createObjectURL(out.blob), kb: Math.round(out.blob.size / 1024) };
        setMsg(`Siap dimampatkan (${st.banner.kb} KB).`, 'ok');
      } catch (err) {
        setMsg(err instanceof ImageError ? err.message : 'Gambar tak dapat diproses. Cuba gambar lain.');
      } finally {
        releaseImage(bitmap);
        pickBtn.disabled = false;
        save.disabled = st.busy;
        renderBanner();
      }
    });

    const save = h('button', { type: 'button', class: 'btn btn-block' }, 'Simpan kedai');
    const back = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, 'Kembali');
    back.addEventListener('click', () => go(2));
    save.addEventListener('click', () => submit(save, back, pickBtn));

    renderBanner();
    return h(
      'div',
      { class: 'stack' },
      h('div', { class: 'stack-sm' }, h('h3', {}, 'Warna tema'), h('p', { class: 'caption' }, 'Warna butang dan harga di halaman kedai anda.'), sw.el),
      h(
        'div',
        { class: 'stack-sm' },
        h('h3', {}, 'Banner kedai (pilihan)'),
        h('p', { class: 'caption' }, 'Gambar di atas halaman kedai, nisbah 2:1. Dimampatkan automatik. Boleh langkau dan tambah kemudian.'),
        fileIn,
        pickBtn,
        previewWrap,
        bannerMsg,
      ),
      h('div', { class: 'btn-row' }, back, save),
    );
  }

  // ------------------------------------------------------------ simpan
  async function submit(save, back, pickBtn) {
    if (st.busy) return;
    st.busy = true;
    for (const b of [save, back, pickBtn]) b.disabled = true;
    save.lastChild.textContent = 'Sedang simpan...';

    try {
      const n = normalizeWhatsapp(st.wa);
      await api('/api/shop', { method: 'POST', body: { name: st.name, slug: st.slug, whatsapp: n, themeColor: st.color } });
    } catch (err) {
      st.busy = false;
      if (err.status === 401) return ctx.onError(err);
      if (err.code === 'ada-kedai') {
        await ctx.reloadMe(); // permintaan sebelum ini sebenarnya berjaya
        return;
      }
      if (err.fields && err.fields.slug) {
        st.slugState = 'taken';
        go(1);
        document.getElementById('f-slug-msg').textContent = err.fields.slug;
        document.getElementById('f-slug-msg').dataset.kind = 'error';
        return;
      }
      if (err.fields && err.fields.whatsapp) {
        go(2);
        return toast(err.fields.whatsapp, 'error');
      }
      toast(err.message, 'error');
      for (const b of [save, back, pickBtn]) b.disabled = false;
      save.lastChild.textContent = 'Simpan kedai';
      return;
    }

    // Kedai sudah wujud. Banner ialah bonus: kegagalan tak boleh membatalkan kedai.
    let bannerFailed = false;
    if (st.banner) {
      try {
        const up = await upload('banner', st.banner.blob);
        await api('/api/shop/banners', { method: 'PUT', body: { keys: [up.key] } });
      } catch {
        bannerFailed = true;
      }
      clearBanner();
    }

    st.busy = false;
    window.location.hash = '#/';
    await ctx.reloadMe();
    toast(
      bannerFailed ? 'Kedai siap. Banner tak berjaya dimuat naik, cuba semula di Tetapan.' : 'Kedai siap.',
      bannerFailed ? 'info' : 'success',
    );
  }

  function go(step) {
    show(step, step === 1 ? step1() : step === 2 ? step2() : step3());
  }

  go(1);
  return root;
}
