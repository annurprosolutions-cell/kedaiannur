/* global self, caches, Response */
// Service worker Kedai AnnurPro. Tujuan: (1) boleh dipasang sebagai app, (2) paparan offline yang kemas.
//
// Peraturan yang sengaja dikekalkan ketat:
//  - Hanya GET same-origin untuk laluan di bawah (landing, privasi, terma, /app/, /assets/). Semua yang lain
//    (termasuk /api/*, /admin/*, dan halaman kedai /<slug>) tak disentuh dan terus ke rangkaian.
//  - Network-first: fail tak mempunyai hash dalam nama (tiada bundler), jadi cache-first akan menghidang JS lama
//    selepas deploy. Cache hanya dipakai bila rangkaian gagal.
//  - Tiada data peribadi dalam cache: HTML dan aset statik sahaja. Data peniaga hanya melalui /api/* yang tak di-cache.

const VERSION = 'v10';
const CACHE = `kedai-${VERSION}`;
const PRECACHE = [
  '/offline.html',
  '/assets/css/base.css',
  '/assets/css/site.css',
  '/assets/js/theme.js',
  '/favicon.svg',
  '/assets/icons/icon-192.png',
];

const PAGES = new Set(['/', '/index.html', '/privasi', '/terma', '/marketplace', '/artikel/', '/app', '/app/', '/app/index.html']);

function handles(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  return PAGES.has(p) || p.startsWith('/assets/') || p === '/manifest.webmanifest';
}

// Response yang melalui redirect (contoh Pages menukar /offline.html kepada /offline) tak boleh disajikan untuk navigasi.
// Salin isinya menjadi response biasa sebelum disimpan.
async function clean(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        PRECACHE.map(async (path) => {
          const res = await fetch(path);
          if (!res.ok) throw new Error(`precache ${path}: ${res.status}`);
          await cache.put(path, await clean(res));
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kedai-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (!handles(url)) return;

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(request);
        // Jangan cache respons redirect (contoh /app -> /app/): ia akan gagal bila disajikan semula untuk navigasi.
        if (res.ok && res.type === 'basic' && !res.redirected) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((c) => c.put(request, copy)));
        }
        return res;
      } catch (err) {
        // ignoreSearch: HTML memautkan aset dengan ?v=<versi>, manakala precache menyimpan URL tanpa query.
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const fallback = await caches.match('/offline.html');
          if (fallback) return fallback;
        }
        throw err;
      }
    })(),
  );
});
