// Piksel iklan peniaga Pro: Meta (Facebook dan Instagram), TikTok, Google (Analytics G- atau Ads AW-).
// Hanya ID daripada snapshot; kod pemuat di bawah ialah salinan rasmi yang ditulis semula tanpa skrip inline (CSP).
// Dimuat selepas halaman siap supaya tak melambatkan paparan pertama (LCP).
// Acara: PageView (automatik), ViewContent, AddToCart, InitiateCheckout (tekan Hantar ke WhatsApp), mata wang MYR.

import { PIXELS } from './rules.js';

const enabled = { meta: false, tiktok: false, google: false };

function loadScript(src) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

function initMeta(id) {
  // Setara dengan kod asas Meta Pixel: fbq menyimpan panggilan dalam queue sehingga fbevents.js dimuatkan.
  if (window.fbq) return;
  const n = function fbq(...args) {
    if (n.callMethod) n.callMethod(...args);
    else n.queue.push(args);
  };
  window.fbq = n;
  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  n.queue = [];
  loadScript('https://connect.facebook.net/en_US/fbevents.js');
  n('init', id);
  n('track', 'PageView');
  enabled.meta = true;
}

function initTiktok(id) {
  // Setara dengan kod asas TikTok Pixel.
  if (window.ttq) return;
  window.TiktokAnalyticsObject = 'ttq';
  const ttq = [];
  window.ttq = ttq;
  ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
  ttq.setAndDefer = (t, e) => {
    t[e] = (...args) => t.push([e, ...args]);
  };
  for (const m of ttq.methods) ttq.setAndDefer(ttq, m);
  ttq.instance = (t) => {
    const e = ttq._i[t] || [];
    for (const m of ttq.methods) ttq.setAndDefer(e, m);
    return e;
  };
  ttq.load = (e, opts) => {
    const r = 'https://analytics.tiktok.com/i18n/pixel/events.js';
    ttq._i = ttq._i || {};
    ttq._i[e] = [];
    ttq._i[e]._u = r;
    ttq._t = ttq._t || {};
    ttq._t[e] = Date.now();
    ttq._o = ttq._o || {};
    ttq._o[e] = opts || {};
    loadScript(`${r}?sdkid=${encodeURIComponent(e)}&lib=ttq`);
  };
  ttq.load(id);
  ttq.page();
  enabled.tiktok = true;
}

function initGoogle(id) {
  window.dataLayer = window.dataLayer || [];
  // gtag perlu menolak objek "arguments" (bukan tatasusunan) ke dataLayer.
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', id);
  loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
  enabled.google = true;
}

/** Mulakan piksel yang sah sahaja. px = { meta?, tiktok?, google? } daripada snapshot. */
export function initPixels(px) {
  if (!px || typeof px !== 'object') return false;
  const ok = {
    meta: typeof px.meta === 'string' && PIXELS.metaPixel.re.test(px.meta),
    tiktok: typeof px.tiktok === 'string' && PIXELS.tiktokPixel.re.test(px.tiktok),
    google: typeof px.google === 'string' && PIXELS.googleTag.re.test(px.google),
  };
  if (!ok.meta && !ok.tiktok && !ok.google) return false;
  const start = () => {
    if (ok.meta) initMeta(px.meta);
    if (ok.tiktok) initTiktok(px.tiktok);
    if (ok.google) initGoogle(px.google);
  };
  if (document.readyState === 'complete') setTimeout(start, 300);
  else window.addEventListener('load', () => setTimeout(start, 300), { once: true });
  return true;
}

const rm = (sen) => (Number.isInteger(sen) ? sen / 100 : undefined);

/**
 * Hantar acara ke semua piksel yang aktif.
 * @param {'view'|'cart'|'checkout'} kind
 * @param {{ items: { id: string, name: string, priceSen: number|null, qty?: number }[], valueSen?: number|null }} d
 */
export function pixelEvent(kind, d) {
  if (!enabled.meta && !enabled.tiktok && !enabled.google) return;
  const items = d.items || [];
  const value = rm(d.valueSen ?? (items.length === 1 ? items[0].priceSen : null));
  const base = value === undefined ? { currency: 'MYR' } : { currency: 'MYR', value };
  const meta = { view: 'ViewContent', cart: 'AddToCart', checkout: 'InitiateCheckout' }[kind];
  const ga = { view: 'view_item', cart: 'add_to_cart', checkout: 'begin_checkout' }[kind];
  if (!meta) return;
  try {
    if (enabled.meta && window.fbq) {
      window.fbq('track', meta, { ...base, content_type: 'product', content_ids: items.map((i) => i.id), num_items: items.reduce((a, i) => a + (i.qty || 1), 0) });
    }
    if (enabled.tiktok && window.ttq) {
      window.ttq.track(meta, { ...base, contents: items.map((i) => ({ content_id: i.id, content_name: i.name, quantity: i.qty || 1, price: rm(i.priceSen) })) });
    }
    if (enabled.google && window.gtag) {
      window.gtag('event', ga, { ...base, items: items.map((i) => ({ item_id: i.id, item_name: i.name, quantity: i.qty || 1, price: rm(i.priceSen) })) });
    }
  } catch {
    /* piksel pihak ketiga tak boleh mengganggu order */
  }
}
