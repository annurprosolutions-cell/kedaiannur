// Tema landing dan halaman undang-undang: cerah (lalai) atau gelap. Skrip biasa (bukan modul) dimuatkan dalam <head>
// supaya tema dikenakan sebelum halaman dilukis dan tiada kilat warna. Pilihan disimpan dalam localStorage jika boleh.
(function () {
  var KEY = 'kedai-tema';
  var stored = null;
  try {
    stored = window.localStorage.getItem(KEY);
  } catch (e) {
    /* storan disekat */
  }
  // Cerah ialah rupa utama: tidak mengikut tetapan sistem. Gelap hanya jika pengguna memilihnya.
  var theme = stored === 'dark' ? 'dark' : 'light';

  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute('content', t === 'light' ? '#F7F8FC' : '#0A0F1F');
  }
  apply(theme);

  // Animasi scroll (site.js): tanda <html> sebelum lukisan pertama supaya bahagian bawah tersembunyi dari awal
  // (bukan pudar keluar selepas dimuat). Jika site.js tak berjalan dalam 2.5 s, buang tanda supaya kandungan kelihatan.
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('motion');
    window.setTimeout(function () {
      if (!window.kedaiMotionReady) document.documentElement.classList.remove('motion');
    }, 2500);
  }

  window.kedaiTheme = {
    get: function () {
      return document.documentElement.getAttribute('data-theme');
    },
    toggle: function () {
      var next = this.get() === 'light' ? 'dark' : 'light';
      apply(next);
      try {
        window.localStorage.setItem(KEY, next);
      } catch (e) {
        /* tak dapat simpan, tema kekal untuk halaman ini sahaja */
      }
      return next;
    },
  };
})();
