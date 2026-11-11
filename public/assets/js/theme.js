// Tema landing dan halaman undang-undang: gelap (lalai) atau cerah. Skrip biasa (bukan modul) dimuatkan dalam <head>
// supaya tema dikenakan sebelum halaman dilukis dan tiada kilat warna. Pilihan disimpan dalam localStorage jika boleh.
(function () {
  var KEY = 'kedai-tema';
  var stored = null;
  try {
    stored = window.localStorage.getItem(KEY);
  } catch (e) {
    /* storan disekat */
  }
  // Gelap ialah rupa utama: tidak mengikut tetapan sistem. Cerah hanya jika pengguna memilihnya.
  var theme = stored === 'light' ? 'light' : 'dark';

  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute('content', t === 'light' ? '#F7F8FC' : '#0A0F1F');
  }
  apply(theme);

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
