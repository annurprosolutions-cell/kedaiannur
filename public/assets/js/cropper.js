// Cropper gambar ringan (tanpa library): bingkai tetap dengan nisbah jenis gambar (produk 1:1, banner 2:1).
// Seret untuk alih, cubit (dua jari), roda tetikus atau slider untuk zum, anak panah dan +/- dari papan kekunci.
// Gambar sentiasa menutup bingkai sepenuhnya, jadi tiada jalur kosong dalam hasil.

import { h } from './ui.js';
import { ASPECT, centerCrop } from './image.js';

const MAX_ZOOM = 4;

/**
 * Buka cropper. Pulangkan Promise { sx, sy, sw, sh } dalam piksel sumber, atau null jika dibatalkan.
 * @param {ImageBitmap|HTMLImageElement} bitmap
 * @param {'product'|'banner'} kind
 */
export function openCropper(bitmap, kind, { title } = {}) {
  const aspect = ASPECT[kind] || 1;
  const W = bitmap.width;
  const H = bitmap.height;

  return new Promise((resolve) => {
    const canvas = h('canvas', { class: 'crop-canvas', 'aria-hidden': 'true' });
    const frame = h('div', { class: kind === 'logo' ? 'crop-frame crop-round' : 'crop-frame', tabindex: '0', role: 'img', 'aria-label': 'Kawasan gambar. Seret untuk alih, anak panah untuk alih, tambah atau tolak untuk zum.' }, canvas);
    const zoomIn = h('input', { type: 'range', min: '1', max: String(MAX_ZOOM), step: '0.01', value: '1', class: 'crop-zoom', 'aria-label': 'Zum gambar' });
    const cancelBtn = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Batal');
    const okBtn = h('button', { type: 'button', class: 'btn' }, 'Guna gambar');
    const resetBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, 'Set semula');
    const dialog = h(
      'div',
      { class: 'crop-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'crop-title' },
      h(
        'div',
        { class: 'crop-sheet stack-sm' },
        h('h2', { id: 'crop-title' }, title || { banner: 'Potong banner', logo: 'Potong logo', cover: 'Potong gambar utama' }[kind] || 'Potong gambar produk'),
        h('p', { class: 'caption' }, {
          banner: 'Banner dipaparkan dalam nisbah 2:1 di atas kedai.',
          logo: 'Logo dipaparkan dalam bulatan di atas kedai. Pastikan bahagian penting berada di tengah.',
          cover: 'Gambar utama artikel 1200 x 630, juga dipaparkan bila link dikongsi di WhatsApp dan Facebook.',
        }[kind] || 'Gambar produk dipaparkan dalam bentuk segi empat di kedai.'),
        frame,
        h('div', { class: 'crop-zoom-row' }, h('span', { 'aria-hidden': 'true' }, '−'), zoomIn, h('span', { 'aria-hidden': 'true' }, '+'), resetBtn),
        h('div', { class: 'crop-actions' }, cancelBtn, okBtn),
      ),
    );

    // Keadaan dalam piksel bingkai: V = lebar bingkai, base = skala "cover", zoom = gandaan pengguna.
    let V = 0;
    let VH = 0;
    let base = 1;
    let zoom = 1;
    let ox = 0;
    let oy = 0;
    const scale = () => base * zoom;

    function clamp() {
      const s = scale();
      ox = Math.min(0, Math.max(V - W * s, ox));
      oy = Math.min(0, Math.max(VH - H * s, oy));
    }

    function draw() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(V * dpr)) {
        canvas.width = Math.round(V * dpr);
        canvas.height = Math.round(VH * dpr);
      }
      const c = canvas.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.imageSmoothingQuality = 'high';
      c.clearRect(0, 0, V, VH);
      const s = scale();
      c.drawImage(bitmap, ox, oy, W * s, H * s);
    }

    // Zum di sekitar satu titik dalam bingkai (tengah, jari, atau penunjuk tetikus).
    function setZoom(z, cx = V / 2, cy = VH / 2) {
      const nz = Math.min(MAX_ZOOM, Math.max(1, z));
      const before = scale();
      const after = base * nz;
      ox = cx - ((cx - ox) * after) / before;
      oy = cy - ((cy - oy) * after) / before;
      zoom = nz;
      zoomIn.value = String(nz);
      clamp();
      draw();
    }

    function layout() {
      const prevS = V ? scale() : 0;
      const centerSrc = V ? { x: (V / 2 - ox) / prevS, y: (VH / 2 - oy) / prevS } : { x: W / 2, y: H / 2 };
      V = Math.round(frame.clientWidth);
      VH = Math.round(V / aspect);
      frame.style.height = `${VH}px`;
      base = Math.max(V / W, VH / H);
      const s = scale();
      ox = V / 2 - centerSrc.x * s;
      oy = VH / 2 - centerSrc.y * s;
      clamp();
      draw();
    }

    function reset() {
      zoom = 1;
      zoomIn.value = '1';
      const c = centerCrop(kind, W, H);
      ox = -c.sx * base;
      oy = -c.sy * base;
      clamp();
      draw();
    }

    // Seret dan cubit dengan Pointer Events (tetikus, sentuhan, pen).
    const pointers = new Map();
    let pinch = null;
    frame.addEventListener('pointerdown', (e) => {
      frame.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      }
    });
    frame.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const rect = frame.getBoundingClientRect();
        setZoom(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      } else if (pointers.size === 1) {
        ox += cur.x - prev.x;
        oy += cur.y - prev.y;
        clamp();
        draw();
      }
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    frame.addEventListener('pointerup', up);
    frame.addEventListener('pointercancel', up);
    frame.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = frame.getBoundingClientRect();
        setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - rect.left, e.clientY - rect.top);
      },
      { passive: false },
    );
    frame.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 40 : 10;
      const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (moves[e.key]) {
        e.preventDefault();
        ox += moves[e.key][0];
        oy += moves[e.key][1];
        clamp();
        draw();
      } else if (e.key === '+' || e.key === '=') setZoom(zoom * 1.1);
      else if (e.key === '-') setZoom(zoom / 1.1);
    });
    zoomIn.addEventListener('input', () => setZoom(Number(zoomIn.value)));
    resetBtn.addEventListener('click', reset);

    const prevFocus = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    function close(result) {
      window.removeEventListener('resize', layout);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      dialog.remove();
      if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Tab') {
        // Fokus kekal dalam dialog.
        const items = [frame, zoomIn, resetBtn, cancelBtn, okBtn];
        const i = items.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          okBtn.focus();
        } else if (!e.shiftKey && i === items.length - 1) {
          e.preventDefault();
          frame.focus();
        }
      }
    }
    cancelBtn.addEventListener('click', () => close(null));
    okBtn.addEventListener('click', () => {
      const s = scale();
      close({ sx: -ox / s, sy: -oy / s, sw: V / s, sh: VH / s });
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close(null);
    });

    document.body.appendChild(dialog);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', layout);
    layout();
    reset();
    okBtn.focus();
  });
}
