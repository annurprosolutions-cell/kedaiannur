// Panel superadmin: tab Artikel. Senarai artikel dan editor Markdown dengan gambar, pratonton dan semakan SEO.
// Halaman awam /artikel/<slug> dijana server daripada data yang sama (lib/articlepage.js).

import { api, upload } from './api.js';
import { h, icon, toast } from './ui.js';
import { field, switchRow, textArea, textInput } from './forms.js';
import { formatDate } from './plannotice.js';
import { ARTICLE_LIMITS, readingMinutes, renderMarkdown, seoChecks, slugify } from './artikel.js';
import { compressBitmap, readImage, releaseImage } from './image.js';
import { openCropper } from './cropper.js';

const UPLOAD_PATH = '/api/admin/upload';

// Editor yang sedang dibuka: amaran sebelum keluar jika ada perubahan belum disimpan.
let active = null;
window.addEventListener('beforeunload', (e) => {
  if (active && active.isDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/** Dipanggil oleh router admin sebelum menukar skrin. false = kekal di editor. */
export function canLeaveEditor() {
  if (!active || !active.isDirty()) return true;
  if (!window.confirm('Ada perubahan belum disimpan. Keluar tanpa simpan?')) return false;
  active = null;
  return true;
}

function statusBadges(a) {
  return [
    a.status === 'published' ? h('span', { class: 'badge badge-pro' }, 'Diterbitkan') : h('span', { class: 'badge badge-warning' }, 'Draf'),
    a.featured ? h('span', { class: 'badge' }, 'Pilihan') : null,
    a.noindex ? h('span', { class: 'badge' }, 'noindex') : null,
  ];
}

// ---------------------------------------------------------------- senarai

export function viewArticles({ onError }) {
  const wrap = h('div', { class: 'stack' });
  const head = h(
    'div',
    { class: 'page-head' },
    h('h1', {}, 'Artikel'),
    h('a', { class: 'btn', href: '#/artikel/baru' }, icon('tambah'), h('span', {}, 'Tulis artikel baru')),
  );
  const note = h('p', { class: 'caption' }, 'Artikel diterbitkan dipaparkan di /artikel/, tab Artikel di menu sale page, seksyen Artikel terkini di landing page, dan sitemap.xml.');
  const body = h('div', { class: 'skeleton', style: 'height:160px' });
  wrap.append(head, note, body);

  async function load() {
    try {
      const { articles } = await api('/api/admin/articles');
      if (!articles.length) {
        body.replaceWith(h('div', { class: 'card stack-sm' }, h('p', { class: 'muted' }, 'Belum ada artikel.'), h('a', { class: 'btn', href: '#/artikel/baru' }, 'Tulis artikel pertama')));
        return;
      }
      const rows = articles.map((a) =>
        h(
          'tr',
          {},
          h('td', {}, h('a', { class: 'row-link block', href: `#/artikel/${encodeURIComponent(a.id)}` }, a.title), h('span', { class: 'caption' }, `/artikel/${a.slug}`)),
          h('td', {}, ...statusBadges(a)),
          h('td', {}, a.publishedAt ? formatDate(a.publishedAt) : '-'),
          h('td', {}, formatDate(a.updatedAt)),
          h('td', {}, h('a', { href: `/artikel/${encodeURIComponent(a.slug)}${a.status === 'published' ? '' : '?pratonton=1'}`, target: '_blank', rel: 'noopener' }, 'Lihat')),
        ),
      );
      const table = h(
        'div',
        { class: 'table-wrap card' },
        h('table', { class: 'data-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Tajuk'), h('th', {}, 'Status'), h('th', {}, 'Diterbitkan'), h('th', {}, 'Dikemas kini'), h('th', {}, ''))), h('tbody', {}, rows)),
      );
      body.replaceWith(table);
    } catch (err) {
      if (err.status === 401) return onError(err);
      body.replaceWith(h('div', { class: 'card stack-sm' }, h('p', { role: 'alert' }, err.message), h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => location.reload() }, 'Cuba semula')));
    }
  }
  load();
  return wrap;
}

// ---------------------------------------------------------------- editor

// Toolbar Markdown: bungkus pilihan teks atau sisip pada permulaan baris.
function wrapSel(ta, before, after = before, placeholder = 'teks') {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const sel = value.slice(s, e) || placeholder;
  ta.setRangeText(`${before}${sel}${after}`, s, e, 'end');
  ta.setSelectionRange(s + before.length, s + before.length + sel.length);
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

function prefixLines(ta, prefix) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const start = value.lastIndexOf('\n', s - 1) + 1;
  const lines = value.slice(start, e).split('\n');
  const text = lines.map((l, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + l.replace(/^(#{1,3}\s+|[-*]\s+|\d+\.\s+|>\s?)/, '')).join('\n');
  ta.setRangeText(text, start, e, 'end');
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

function insertBlock(ta, text) {
  const { selectionStart: s, value } = ta;
  const pre = s === 0 || value[s - 1] === '\n' ? (s > 1 && value[s - 2] !== '\n' ? '\n' : '') : '\n\n';
  ta.setRangeText(`${pre}${text}\n\n`, s, ta.selectionEnd, 'end');
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

function counter(input, [lo, hi], max) {
  const el = h('span', { class: 'caption counter', 'aria-live': 'polite' });
  const upd = () => {
    const n = input.value.trim().length;
    el.textContent = `${n} / ${hi} aksara`;
    el.dataset.state = n === 0 ? '' : n < lo ? 'short' : n > hi ? 'long' : 'ok';
    if (n > max) el.dataset.state = 'long';
  };
  input.addEventListener('input', upd);
  upd();
  return { el, upd };
}

const EMPTY = {
  id: null, title: '', slug: '', seoTitle: '', description: '', body: '', coverKey: null, coverUrl: '', coverAlt: '',
  focusKeyword: '', author: 'Kedai AnnurPro', status: 'draft', noindex: false, featured: false, publishedAt: null,
};

export function viewArticleEditor({ onError }, id) {
  const isNew = id === 'baru';
  const wrap = h('div', { class: 'stack' }, h('a', { class: 'back-link', href: '#/artikel' }, '‹ Semua artikel'), h('div', { class: 'skeleton', style: 'height:320px' }));

  (async () => {
    let a = { ...EMPTY };
    if (!isNew) {
      try {
        a = { ...EMPTY, ...(await api(`/api/admin/articles/${encodeURIComponent(id)}`)).article };
      } catch (err) {
        if (err.status === 401) return onError(err);
        wrap.replaceChildren(h('a', { class: 'back-link', href: '#/artikel' }, '‹ Semua artikel'), h('div', { class: 'card' }, h('p', { role: 'alert' }, err.message)));
        return;
      }
    }
    render(a);
  })();

  function render(a) {
    let dirty = false;
    let slugTouched = !isNew;
    const markDirty = () => {
      dirty = true;
      saveState.textContent = 'Belum disimpan';
    };
    active = { isDirty: () => dirty && document.body.contains(wrap) };

    // --- medan utama
    const title = field({ id: 'a-title', label: 'Tajuk artikel', input: textInput({ maxlength: ARTICLE_LIMITS.title.max, value: a.title, placeholder: 'Contoh: Cara buat katalog online untuk kedai kuih' }) });
    const bodyTa = textArea({ rows: 22, class: 'input md-input', spellcheck: 'true', placeholder: 'Tulis artikel di sini. Guna butang di atas untuk subtajuk, senarai, pautan dan gambar.' });
    bodyTa.value = a.body;
    const bodyField = field({ id: 'a-body', label: 'Kandungan', input: bodyTa });
    const preview = h('div', { class: 'md-preview legal article', hidden: true });
    const stats = h('p', { class: 'caption' });

    const inlineFile = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const tool = (label, title2, fn, ic) => {
      const b = h('button', { type: 'button', class: 'md-btn', title: title2, 'aria-label': title2 }, ic ? icon(ic) : label);
      b.addEventListener('click', fn);
      return b;
    };
    const imgBtn = tool('', 'Masukkan gambar', () => inlineFile.click(), 'gambar');
    const toolbar = h(
      'div',
      { class: 'md-toolbar', role: 'toolbar', 'aria-label': 'Format kandungan' },
      tool('H2', 'Subtajuk (##)', () => prefixLines(bodyTa, '## ')),
      tool('H3', 'Subtajuk kecil (###)', () => prefixLines(bodyTa, '### ')),
      tool('B', 'Tebal', () => wrapSel(bodyTa, '**')),
      tool('I', 'Condong', () => wrapSel(bodyTa, '*')),
      tool('Link', 'Pautan', () => {
        const url = window.prompt('Alamat pautan (https://... atau /artikel/...):', 'https://');
        if (url && url !== 'https://') wrapSel(bodyTa, '[', `](${url.trim()})`, 'teks pautan');
      }),
      tool('• Senarai', 'Senarai', () => prefixLines(bodyTa, '- ')),
      tool('1. Senarai', 'Senarai bernombor', () => prefixLines(bodyTa, (i) => `${i + 1}. `)),
      tool('❝', 'Petikan', () => prefixLines(bodyTa, '> ')),
      tool('—', 'Garis pemisah', () => insertBlock(bodyTa, '---')),
      imgBtn,
    );
    const tabWrite = h('button', { type: 'button', class: 'md-tab', 'aria-pressed': 'true' }, 'Tulis');
    const tabPreview = h('button', { type: 'button', class: 'md-tab', 'aria-pressed': 'false' }, 'Pratonton');
    const showPreview = (on) => {
      tabWrite.setAttribute('aria-pressed', String(!on));
      tabPreview.setAttribute('aria-pressed', String(on));
      bodyField.el.hidden = on;
      toolbar.hidden = on;
      preview.hidden = !on;
      if (on) {
        const md = renderMarkdown(bodyTa.value, { origin: location.origin });
        // HTML dijana oleh renderMarkdown yang meng-escape semua teks; hanya tag yang dibenarkan.
        preview.replaceChildren(h('h1'));
        preview.firstChild.textContent = title.input.value || 'Tajuk artikel';
        preview.insertAdjacentHTML('beforeend', md.html || '<p class="muted">Tiada kandungan lagi.</p>');
      }
    };
    tabWrite.addEventListener('click', () => showPreview(false));
    tabPreview.addEventListener('click', () => showPreview(true));

    inlineFile.addEventListener('change', async () => {
      const file = inlineFile.files[0];
      inlineFile.value = '';
      if (!file) return;
      imgBtn.disabled = true;
      let bitmap = null;
      try {
        bitmap = await readImage(file);
        const { blob } = await compressBitmap(bitmap, 'inline');
        const res = await upload('inline', blob, UPLOAD_PATH);
        const start = bodyTa.selectionStart;
        insertBlock(bodyTa, `![Terangkan gambar ini](${res.url})`);
        // Pilih teks alt supaya terus boleh ditaip.
        const at = bodyTa.value.indexOf('![Terangkan gambar ini]', Math.max(0, start - 2));
        if (at >= 0) bodyTa.setSelectionRange(at + 2, at + 22);
        toast('Gambar dimasukkan. Tukar teks dalam [ ] kepada penerangan gambar.', 'success');
      } catch (err) {
        if (err.status === 401) return onError(err);
        toast(err.message || 'Gambar gagal dimuat naik.', 'error');
      } finally {
        releaseImage(bitmap);
        imgBtn.disabled = false;
      }
    });

    // --- penerbitan
    const saveState = h('span', { class: 'caption', 'aria-live': 'polite' }, isNew ? 'Belum disimpan' : `Disimpan ${formatDate(a.updatedAt || new Date().toISOString())}`);
    const featured = switchRow({ id: 'a-featured', title: 'Artikel Pilihan', desc: 'Didahulukan di seksyen Artikel terkini di landing page.', checked: a.featured, onChange: markDirty });
    const noindex = switchRow({ id: 'a-noindex', title: 'Jangan indeks di Google', desc: 'Halaman tetap boleh dibuka, tetapi Google diminta tidak menyenaraikannya.', checked: a.noindex, onChange: markDirty });
    const statusLine = h('div', { class: 'publish-status' });
    const draftBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block' });
    const publishBtn = h('button', { type: 'button', class: 'btn btn-block' });
    const viewLink = h('a', { class: 'btn btn-secondary btn-block', target: '_blank', rel: 'noopener' }, icon('luar'), h('span', {}, 'Lihat halaman'));
    const delBtn = h('button', { type: 'button', class: 'btn btn-danger-ghost btn-block' }, icon('padam'), h('span', {}, 'Padam artikel'));
    const author = field({ id: 'a-author', label: 'Penulis', input: textInput({ maxlength: ARTICLE_LIMITS.author.max, value: a.author }) });

    function syncPublish() {
      statusLine.replaceChildren(...statusBadges(a), a.publishedAt ? h('span', { class: 'caption' }, ` sejak ${formatDate(a.publishedAt)}`) : null);
      draftBtn.textContent = a.status === 'published' ? 'Tukar ke draf' : 'Simpan draf';
      publishBtn.textContent = a.status === 'published' ? 'Kemas kini' : 'Terbitkan';
      viewLink.hidden = !a.id;
      viewLink.href = `/artikel/${encodeURIComponent(a.slug)}${a.status === 'published' ? '' : '?pratonton=1'}`;
      delBtn.hidden = !a.id;
    }

    // --- gambar utama
    const coverFile = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const coverImg = h('img', { class: 'cover-preview', alt: '', hidden: !a.coverUrl, src: a.coverUrl || null });
    const coverBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, icon('gambar'), h('span', {}, a.coverKey ? 'Tukar gambar utama' : 'Pilih gambar utama'));
    const coverRemove = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', hidden: !a.coverKey }, 'Buang gambar');
    const coverAlt = field({ id: 'a-cover-alt', label: 'Teks alt gambar utama', input: textInput({ maxlength: ARTICLE_LIMITS.coverAlt.max, value: a.coverAlt, placeholder: 'Contoh: Kuih muih tersusun atas meja kayu' }), hint: 'Penerangan ringkas gambar untuk Google dan pembaca skrin.' });
    coverBtn.addEventListener('click', () => coverFile.click());
    coverRemove.addEventListener('click', () => {
      a.coverKey = null;
      coverImg.hidden = true;
      coverRemove.hidden = true;
      coverBtn.lastChild.textContent = 'Pilih gambar utama';
      markDirty();
      refresh();
    });
    coverFile.addEventListener('change', async () => {
      const file = coverFile.files[0];
      coverFile.value = '';
      if (!file) return;
      let bitmap = null;
      coverBtn.disabled = true;
      try {
        bitmap = await readImage(file);
        const crop = await openCropper(bitmap, 'cover');
        if (!crop) return;
        const { blob } = await compressBitmap(bitmap, 'cover', crop);
        const res = await upload('cover', blob, UPLOAD_PATH);
        a.coverKey = res.key;
        coverImg.src = res.url;
        coverImg.hidden = false;
        coverRemove.hidden = false;
        coverBtn.lastChild.textContent = 'Tukar gambar utama';
        markDirty();
        refresh();
      } catch (err) {
        if (err.status === 401) return onError(err);
        toast(err.message || 'Gambar gagal dimuat naik.', 'error');
      } finally {
        releaseImage(bitmap);
        coverBtn.disabled = false;
      }
    });

    // --- SEO
    const slugIn = textInput({ maxlength: ARTICLE_LIMITS.slug.max, value: a.slug, autocapitalize: 'off', spellcheck: 'false' });
    const slug = field({ id: 'a-slug', label: 'Slug (alamat artikel)', input: slugIn, hint: '' });
    const seoTitle = field({ id: 'a-seo-title', label: 'Tajuk SEO (pilihan)', input: textInput({ maxlength: ARTICLE_LIMITS.seoTitle.max, value: a.seoTitle }), hint: 'Dipaparkan di tab browser dan Google. Kosong = guna tajuk artikel.' });
    const desc = field({ id: 'a-desc', label: 'Meta description', input: textArea({ rows: 3, maxlength: ARTICLE_LIMITS.description.max }), hint: 'Ringkasan di bawah tajuk dalam Google dan pratonton WhatsApp.' });
    desc.input.value = a.description;
    const kw = field({ id: 'a-kw', label: 'Kata kunci fokus', input: textInput({ maxlength: ARTICLE_LIMITS.focusKeyword.max, value: a.focusKeyword, placeholder: 'Contoh: katalog online' }), hint: 'Frasa utama yang anda mahu artikel ini muncul di Google. Untuk semakan sahaja, tidak dipaparkan.' });
    const seoCount = counter(seoTitle.input, ARTICLE_LIMITS.seoTitle.ideal, ARTICLE_LIMITS.seoTitle.max);
    const descCount = counter(desc.input, ARTICLE_LIMITS.description.ideal, ARTICLE_LIMITS.description.max);
    seoTitle.el.querySelector('label').append(' ', seoCount.el);
    desc.el.querySelector('label').append(' ', descCount.el);
    const snippet = h('div', { class: 'serp', 'aria-label': 'Pratonton hasil carian Google' }, h('span', { class: 'serp-url' }), h('span', { class: 'serp-title' }), h('span', { class: 'serp-desc' }));
    const checklist = h('ul', { class: 'seo-checks' });
    const score = h('span', { class: 'badge' });

    function current() {
      return {
        title: title.input.value,
        slug: slugIn.value,
        seoTitle: seoTitle.input.value,
        description: desc.input.value,
        body: bodyTa.value,
        coverKey: a.coverKey,
        coverAlt: coverAlt.input.value,
        focusKeyword: kw.input.value,
        author: author.input.value,
        noindex: noindex.input.checked,
        featured: featured.input.checked,
      };
    }

    function refresh() {
      const c = current();
      if (!slugTouched) slugIn.value = slugify(c.title);
      c.slug = slugIn.value;
      slug.hint(`${location.host}/artikel/${slugify(c.slug) || '...'}`);
      const md = renderMarkdown(c.body, { origin: location.origin });
      stats.textContent = `${md.words} patah perkataan · ${readingMinutes(md.words)} min bacaan · ${md.images.length} gambar`;
      const t = (c.seoTitle.trim() || c.title.trim() || 'Tajuk artikel');
      snippet.children[0].textContent = `${location.host} › artikel › ${slugify(c.slug) || '...'}`;
      snippet.children[1].textContent = `${t.length > 60 ? `${t.slice(0, 59)}…` : t} | Kedai AnnurPro`;
      const d = c.description.trim() || md.firstParagraph || 'Isi meta description supaya Google tak memilih teks sendiri.';
      snippet.children[2].textContent = d.length > 160 ? `${d.slice(0, 159)}…` : d;
      const checks = seoChecks(c, md);
      const okN = checks.filter((x) => x.ok).length;
      score.textContent = `${okN}/${checks.length} lulus`;
      score.className = okN === checks.length ? 'badge badge-pro' : okN >= checks.length - 3 ? 'badge' : 'badge badge-warning';
      checklist.replaceChildren(
        ...checks.map((x) => h('li', { 'data-ok': String(x.ok) }, h('span', { class: 'seo-mark', 'aria-hidden': 'true' }, x.ok ? '✓' : '!'), h('span', {}, h('span', { class: 'sr-only' }, x.ok ? 'Lulus: ' : 'Perlu perhatian: '), x.label, x.ok ? null : h('span', { class: 'caption block' }, x.tip)))),
      );
    }

    for (const inp of [title.input, seoTitle.input, desc.input, kw.input, coverAlt.input, author.input, bodyTa]) {
      inp.addEventListener('input', () => {
        markDirty();
        refresh();
      });
    }
    slugIn.addEventListener('input', () => {
      slugTouched = true;
      markDirty();
      refresh();
    });
    slugIn.addEventListener('blur', () => {
      slugIn.value = slugify(slugIn.value);
      refresh();
    });
    bodyTa.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save(a.status);
      }
    });

    const fields = { title, slug, seoTitle, description: desc, body: bodyField, coverAlt, focusKeyword: kw, author };
    async function save(status) {
      const payload = { ...current(), status };
      for (const f of Object.values(fields)) f.msg('');
      if (a.status === 'published' && a.slug && slugify(payload.slug) !== a.slug &&
        !window.confirm(`Tukar slug dari "${a.slug}" ke "${slugify(payload.slug)}"? Link lama yang sudah dikongsi akan jadi 404.`)) return;
      if (status === 'published' && a.status !== 'published' && !window.confirm('Terbitkan artikel ini? Ia akan muncul di /artikel/, landing page dan sitemap.')) return;
      draftBtn.disabled = true;
      publishBtn.disabled = true;
      try {
        const res = a.id
          ? await api(`/api/admin/articles/${encodeURIComponent(a.id)}`, { method: 'PATCH', body: payload })
          : await api('/api/admin/articles', { method: 'POST', body: payload });
        const wasNew = !a.id;
        Object.assign(a, res.article);
        slugIn.value = a.slug;
        slugTouched = true;
        dirty = false;
        saveState.textContent = `Disimpan ${new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' })}`;
        syncPublish();
        refresh();
        toast(a.status === 'published' ? 'Artikel diterbitkan dan dikemas kini.' : 'Draf disimpan.', 'success');
        if (wasNew) history.replaceState(null, '', `#/artikel/${encodeURIComponent(a.id)}`);
      } catch (err) {
        if (err.status === 401) return onError(err);
        if (err.fields) {
          for (const [k, msg] of Object.entries(err.fields)) (fields[k] || title).msg(msg);
          const first = Object.keys(err.fields)[0];
          (fields[first] || title).input.focus();
        }
        toast(err.message, 'error');
      } finally {
        draftBtn.disabled = false;
        publishBtn.disabled = false;
      }
    }
    draftBtn.addEventListener('click', () => save('draft'));
    publishBtn.addEventListener('click', () => save('published'));
    delBtn.addEventListener('click', async () => {
      if (!window.confirm(`Padam "${a.title}"? Artikel dan gambarnya dibuang terus dan link akan jadi 404.`)) return;
      try {
        await api(`/api/admin/articles/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
        dirty = false;
        active = null;
        toast('Artikel dipadam.', 'success');
        location.hash = '#/artikel';
      } catch (err) {
        if (err.status === 401) return onError(err);
        toast(err.message, 'error');
      }
    });

    const main = h(
      'div',
      { class: 'editor-main stack' },
      title.el,
      h('div', { class: 'md-tabs' }, tabWrite, tabPreview, h('span', { class: 'md-help caption' }, '## subtajuk · **tebal** · *condong* · - senarai · [teks](link)')),
      toolbar,
      bodyField.el,
      inlineFile,
      preview,
      stats,
    );
    const side = h(
      'div',
      { class: 'editor-side stack' },
      h('section', { class: 'card stack-sm' }, h('h2', {}, 'Penerbitan'), statusLine, saveState, publishBtn, draftBtn, viewLink, featured.el, noindex.el, author.el, delBtn),
      h('section', { class: 'card stack-sm' }, h('h2', {}, 'Gambar utama'), h('p', { class: 'caption' }, '1200 x 630. Dipaparkan di atas artikel, dalam senarai, dan bila link dikongsi.'), coverImg, coverBtn, coverRemove, coverFile, coverAlt.el),
      h('section', { class: 'card stack-sm' }, h('div', { class: 'seo-head' }, h('h2', {}, 'SEO'), score), snippet, slug.el, seoTitle.el, desc.el, kw.el, h('h3', { class: 'caption' }, 'Semakan'), checklist),
    );
    wrap.replaceChildren(
      h('a', { class: 'back-link', href: '#/artikel' }, '‹ Semua artikel'),
      h('h1', {}, isNew ? 'Artikel baru' : 'Sunting artikel'),
      h('div', { class: 'editor-grid' }, main, side),
    );
    syncPublish();
    refresh();
    if (isNew) title.input.focus();
  }
  return wrap;
}
