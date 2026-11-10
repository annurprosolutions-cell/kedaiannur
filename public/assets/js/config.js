// Konfigurasi awam daripada /api/config (client id Google, URL media). Dimuat sekali.

import { api } from './api.js';

let promise = null;

export function getConfig() {
  if (!promise) {
    promise = api('/api/config').catch((err) => {
      promise = null; // benarkan cuba semula
      throw err;
    });
  }
  return promise;
}

export function mediaUrl(cfg, key) {
  const base = String((cfg && cfg.mediaBaseUrl) || '').replace(/\/+$/, '');
  return base ? `${base}/${key}` : '';
}
