// Google Identity Services: butang "Sign in with Google" yang memulangkan ID token.
// Skop asas sahaja (openid email profile). Tiada One Tap.

const GSI_SRC = 'https://accounts.google.com/gsi/client';
let loading = null;

export function loadGsi() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.onload = () => (window.google && window.google.accounts ? resolve() : reject(new Error('GSI tiada')));
    s.onerror = () => reject(new Error('GSI gagal dimuat'));
    document.head.appendChild(s);
  }).catch((err) => {
    loading = null; // benarkan cuba semula
    throw err;
  });
  return loading;
}

// Google mengesyorkan initialize dipanggil sekali sahaja; callback semasa disimpan di sini.
let initializedFor = null;
let currentCallback = () => {};

export async function renderGoogleButton(container, clientId, onCredential) {
  await loadGsi();
  const gid = window.google.accounts.id;
  currentCallback = onCredential;
  if (initializedFor !== clientId) {
    gid.initialize({
      client_id: clientId,
      callback: (resp) => currentCallback(resp && resp.credential),
      ux_mode: 'popup',
      auto_select: false,
      cancel_on_tap_outside: true,
      itp_support: true,
    });
    initializedFor = clientId;
  }
  if (pendingDisableAutoSelect) {
    gid.disableAutoSelect();
    pendingDisableAutoSelect = false;
  }
  container.replaceChildren();
  gid.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'left',
    width: Math.min(320, container.clientWidth || 320),
    locale: 'ms',
  });
}

// Selepas logout, elak Google pilih akaun secara automatik. Jika GIS belum dimuat,
// tangguh sehingga butang dilukis semula.
let pendingDisableAutoSelect = false;

export function googleSignOut() {
  try {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.disableAutoSelect();
      return;
    }
  } catch {
    /* abaikan */
  }
  pendingDisableAutoSelect = true;
}
