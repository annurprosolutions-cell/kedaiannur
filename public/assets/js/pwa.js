// PWA: daftar service worker dan urus butang "Pasang app". Dikongsi oleh landing dan dashboard.
// beforeinstallprompt hanya ada pada Chrome, Edge dan Android; Safari iOS perlu langkah manual (lihat FAQ landing).

let deferred = null;
const listeners = new Set();

export function isStandalone() {
  return (
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true
  );
}

export function canInstall() {
  return deferred !== null && !isStandalone();
}

export function onInstallChange(fn) {
  listeners.add(fn);
  fn(canInstall());
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(canInstall());
}

/** Tunjuk dialog pemasangan pelayar. Pulangkan 'accepted', 'dismissed' atau null jika tak tersedia. */
export async function promptInstall() {
  if (!deferred) return null;
  const evt = deferred;
  deferred = null; // satu prompt hanya boleh digunakan sekali
  notify();
  try {
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    return outcome;
  } catch {
    return null;
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const go = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}

/** Sambungkan semua butang [data-install] dalam halaman: tersembunyi sehingga pemasangan tersedia. */
export function bindInstallButtons(root = document) {
  const buttons = [...root.querySelectorAll('[data-install]')];
  for (const b of buttons) b.addEventListener('click', () => promptInstall());
  onInstallChange((ok) => {
    for (const b of buttons) b.hidden = !ok;
  });
}
