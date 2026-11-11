# Kedai AnnurPro

Katalog digital untuk peniaga kecil: pelanggan pilih produk, troli dihantar sebagai mesej siap ke WhatsApp peniaga.
Stack: Cloudflare Pages (frontend statik tanpa build step) + Pages Functions (API) + D1 + R2. Login Google.

## Status fasa

| Fasa | Skop | Status |
|---|---|---|
| 0 | Repo, `_routes.json`, `_headers`, halaman Hello, skema D1 | Kod siap. Setup akaun Cloudflare/Google ikut langkah di bawah |
| 1 | Login Google, sesi D1, `/api/me`, logout, semakan Origin, kerangka `/app/` | Kod siap, ujian lulus |
| 2 | Setup kedai 3 langkah (S-08), semakan slug, WhatsApp, warna, mampat dan muat naik gambar, banner, tetapan kedai (S-13) | Kod siap, ujian lulus. Perlu R2 dan binding `MEDIA` untuk uji secara live |
| 3 | Kategori (S-12), produk (S-10, S-11), had pelan di server, snapshot `catalog/<slug>.json` ke R2, dashboard dengan meter (S-09), pembersihan gambar yatim | Kod siap, ujian lulus |
| 4 | Halaman kedai awam `/<slug>` (S-02 hingga S-06), troli, hantar order ke WhatsApp, pratonton link, salin dan kongsi link (S-09), fallback 404.html | Kod siap, ujian lulus |
| 5 | Status pelan (aktif, hampir tamat, toleransi, tamat) dengan notis di dashboard dan Langganan (S-14), templat mesej WhatsApp Pro dengan pratonton, banner berputar Pro, buang branding Pro | Kod siap, ujian lulus |
| 7 | Panel superadmin `/admin/`: ringkasan kiraan, senarai dan carian kedai (S-16), tetapkan pelan, tambah bulan, gantung (S-17), padankan bayaran, slug reserved, bina semula katalog (S-18), audit log | Kod siap, ujian lulus |
| 8 | Landing page (S-01) dengan tangkapan skrin sebenar, halaman `/privasi` dan `/terma`, eksport data JSON dan padam kedai (S-15), `/api/plans` awam, ukuran LCP | Kod siap, ujian lulus. Teks privasi dan terma ialah draf: semak sebelum launch |
| 6 | Bayaran BCL dan webhook | Ditahan atas permintaan |
| 8b | Tema baharu landing (gelap midnight navy + aksen amber, mod cerah), PWA (manifest, service worker, ikon, offline, kad Pasang app) | Kod siap, ujian lulus |

## Struktur

```
public/            fail statik yang dihidang (build output directory)
  _routes.json     Functions hanya untuk /api/* dan /<slug>; fail statik dikecualikan
  _headers         CSP dan header keselamatan untuk fail statik
  index.html       landing page (S-01); privasi.html, terma.html dan offline.html di sebelahnya
  manifest.webmanifest, sw.js   PWA (lihat bahagian Tema dan PWA)
  app/             dashboard peniaga (S-07 hingga S-15)
  admin/           panel superadmin (Fasa 7)
  assets/          CSS dan modul JS
functions/api/     Pages Functions (API): auth, me, shop, shop/banners, slug-check, upload, products, categories, billing, config, ping
functions/[slug].js halaman kedai awam
lib/               kod kongsi untuk Functions (tidak dihidang kepada awam)
db/0001_init.sql   skema D1 (jalankan sekali dalam Console)
scripts/           landing-shots.js (tangkapan skrin landing), make-icons.js (ikon PWA)
tests/             ujian unit (node --test) dan e2e (Playwright + wrangler)
```

Perbezaan kecil daripada IPD 0.1: fail statik diletak dalam `public/` (bukan akar repo) supaya `db/`, `lib/`, `tests/`
dan `README.md` tidak boleh dimuat turun dari laman web. Kesannya hanya pada satu tetapan: **Build output directory = `public`**.

## Setup Fasa 0 (sekali sahaja)

Nama menu dalam dashboard mungkin berbeza sedikit; ikut label semasa.

1. **Zon DNS.** dash.cloudflare.com, pastikan `annurpro.com` ada dalam senarai domain akaun. Jika tiada, berhenti dan pindahkan nameserver dahulu.
2. **D1.** Storage & Databases, D1 SQL Database, Create, nama `kedai-db`. Buka tab Console, tampal isi `db/0001_init.sql`, Execute.
   Semak: `SELECT code, max_products FROM plans;` mesti pulang `free 20` dan `pro 500`;
   `SELECT count(*) FROM reserved_slugs;` mesti lebih 50.
3. **R2.** R2 Object Storage, Create bucket, nama `kedai-media`. Tab Settings, Custom Domains, tambah `media.annurpro.com`.
4. **Pages.** Workers & Pages, Create, tab Pages, Connect to Git, pilih repo `kedaiannur`.
   - Production branch: `main`
   - Framework preset: None. Build command: kosong. **Build output directory: `public`**
   - **Mesti projek Pages, bukan Worker.** Kod ini guna Pages Functions (`functions/`). Projek Worker jenis static assets tak boleh
     ditambah binding D1/R2 (dashboard papar "Bindings cannot be added to a Worker that only has static assets") dan tak menjalankan
     `functions/`. Butang Create lalai di dashboard kadang-kadang membawa ke Worker; cari tab atau pautan **Pages**.
   - Kalau repo tak muncul dalam dropdown: GitHub, Settings, Applications, Installed GitHub Apps, **Cloudflare Workers and Pages**,
     Configure, dan tambah repo di Repository access. Lepas itu taip nama repo dalam kotak Search dan **klik hasilnya**, tunggu
     Production branch terisi `main` sebelum tekan Connect.
   - Build output kosong bermaksud seluruh repo dihidang (termasuk `db/`, `lib/`, `tests/`) dan `/` jadi 404. Pastikan `public`.
   - Banner "disconnected from your Git account" bermaksud push tak akan mencetuskan deployment. Penyelesaian: Settings, Git repository,
     Disconnect, kemudian Connect semula. Tetapan build, binding dan variable perlu disemak selepas itu.
   - Tetapan build, binding dan variable hanya terpakai pada deployment **baharu** (push baru, atau Retry deployment).
5. **Tetapan projek Pages** (Settings):
   - Custom domains: tambah `kedai.annurpro.com`.
   - Bindings: D1 database, nama `DB`, pilih `kedai-db`. R2 bucket, nama `MEDIA`, pilih `kedai-media`.
     Tetapkan untuk Production dan Preview.
   - Variables and Secrets (Production):

     | Nama | Nilai | Jenis |
     |---|---|---|
     | `GOOGLE_CLIENT_ID` | dari langkah 6 | Text |
     | `SUPERADMIN_EMAILS` | e-mel Google superadmin, pisah dengan koma | Text |
     | `MEDIA_BASE_URL` | `https://media.annurpro.com` | Text |
     | `SESSION_DAYS` | `30` | Text |
     | `GRACE_DAYS` | `7` | Text |
     | `SUPPORT_EMAIL` | e-mel sokongan: pautan "Lapor kedai ini", kaki landing, privasi dan terma (wajib sebelum launch; kosong = pautan disembunyikan) | Text |

     `BCL_*` hanya diperlukan dalam Fasa 6. Secret dimasukkan terus di sini, jangan tampal dalam chat.
   - Binding `MEDIA` dan bucket `kedai-media` (langkah 3) **diperlukan mulai Fasa 2** untuk muat naik gambar. Tanpa binding,
     `/api/upload` dan `/api/shop/banners` pulang ralat "Sistem sibuk". Tanpa custom domain `media.annurpro.com`, gambar tersimpan
     tetapi tak dipaparkan.
   - Runtime: Compatibility date `2025-09-01` atau lebih baharu (ujian local guna tarikh ini).
   - Functions: mod had harian biasanya "fail open" secara lalai. Pastikan ia tidak ditukar ke "fail closed".
6. **Google Cloud Console.** Cipta projek, Google Auth Platform (OAuth consent screen): External, mod Testing dahulu,
   tambah e-mel sendiri sebagai test user. Clients, Create client, jenis Web application:
   - Authorised JavaScript origins: `https://kedai.annurpro.com` (tambah juga URL `https://<projek>.pages.dev` jika mahu uji sebelum domain siap)
   - Redirect URI tidak diperlukan (aliran ID token melalui popup).
   - Salin Client ID ke `GOOGLE_CLIENT_ID` (langkah 5), kemudian Retry deployment supaya nilai baharu terpakai.
   - Tukar consent screen ke Production hanya selepas halaman privasi siap (Fasa 8).
7. **Rate limiting (pilihan, IPD keselamatan).** Security, WAF, Rate limiting rules: hadkan `/api/auth/` sekitar 20 permintaan seminit
   setiap IP, dan `/api/upload` sekitar 30 permintaan seminit setiap IP (muat naik ialah satu-satunya laluan yang menulis ke R2).

## Semak selepas deploy (IPD 0.6 dan Fasa 1)

- `https://kedai.annurpro.com/` papar halaman Hello.
- `https://kedai.annurpro.com/api/ping` pulang `{"ok":true,...}`.
- `https://kedai.annurpro.com/api/me` tanpa login pulang 401 `perlu-login`.
- Buka `/app/`, log masuk dengan Google. Akaun baharu nampak wizard "Setup kedai" 3 langkah. Log keluar kembali ke skrin login.

Fasa 2 (selepas binding R2 dan domain media siap):

- Wizard: taip nama kedai, slug dicadangkan dan disemak serta-merta. Cuba `admin` (ditolak), langkah 2 isi `0123456789` (dipaparkan `+60 12-345 6789`).
- Langkah 3: pilih warna dan gambar dari galeri phone (gambar 5 MB patut jadi bawah 500 KB). Simpan, kemudian dashboard terbuka.
- Tetapan: tukar nama, warna, suis buka/tutup. Banner muncul. Pelan Percuma had 1 banner.
- Cloudflare Dashboard, R2, `kedai-media`: objek `shops/<id>/b_<uuid>.webp` wujud, dan hilang bila banner dibuang.
- D1 Console: `SELECT slug, whatsapp, storage_bytes FROM shops;` nombor WhatsApp berformat `60...`.
- Metrics projek Pages: buka beberapa halaman statik dan `/api/ping`; hanya `/api/*` dan `/<slug>` patut menambah kiraan Functions requests.
- Metrics Functions: CPU time median login patut jauh di bawah 10 ms.

## Ujian

```bash
npm test
```

```bash
npm run test:e2e
```

`npm test` tidak memerlukan pakej luar (Node 22.13+, guna `node:sqlite` sebagai D1 tiruan dengan skema sebenar).
`npm run test:e2e` menjalankan `wrangler pages dev` (dimuat turun melalui npx) dan Playwright; butang Google dipalsukan
dan sesi disuntik terus ke D1 local.

## Peraturan kod (ringkas)

- Semua `/api/*` memerlukan sesi kecuali senarai awam dalam `functions/api/_middleware.js`. Laluan baharu dilindungi secara lalai.
- `/api/admin/*` disemak terhadap `SUPERADMIN_EMAILS` pada setiap request.
- Mutasi (`POST/PUT/PATCH/DELETE`) mesti dari origin sama dan `Content-Type: application/json` (kecuali `/api/upload` dan `/api/webhooks/*`).
- Handler peniaga tak pernah menerima `shop_id` dari client; kedai dicari melalui `owner_user_id` sesi.
- Teks pengguna dipapar dengan `textContent`, bukan `innerHTML`.
- Setiap fail atau folder statik baharu di akar `public/` mesti ditambah ke `exclude` dalam `_routes.json` (ujian `tests/static.test.js` akan gagal jika terlupa).
- Ralat API: `{ "ok": false, "code": "...", "message": "..." }` dalam Bahasa Malaysia. Ralat validasi tambah `fields: { medan: mesej }`.
- Peraturan slug, WhatsApp dan warna tema hidup di satu tempat, `public/assets/js/rules.js`, dan di-import oleh borang dan server.
- Gambar: browser mampat ke WebP (JPEG jika tak sokong), server semak magic bytes dan had saiz (produk 400 KB, thumbnail 80 KB, banner 500 KB).
  `storage_bytes` dikira mengikut saiz sebenar objek R2 semasa gambar dipautkan, bukan daripada angka client.

## Snapshot katalog (Fasa 3)

- Setiap tulisan (kedai, banner, produk, kategori, susunan) membina semula `catalog/<slug>.json` dalam R2 daripada pelan efektif:
  hanya `max_products` produk pertama mengikut susunan, `max_categories` kategori dan `max_banners` banner. Data lebih tak dipadam.
- Tukar slug memadam snapshot slug lama. Kedai `suspended` tiada snapshot.
- Jika tulis R2 gagal: perubahan tetap disimpan dalam D1, `shops.catalog_dirty = 1`, API pulang 500 `katalog-gagal`, dan dashboard papar notis.
  Tulisan seterusnya yang berjaya menetapkan semula `catalog_dirty = 0`.
- Semak di D1 Console: `SELECT slug, catalog_dirty FROM shops WHERE catalog_dirty = 1;`

## Gambar yatim

Gambar yang dimuat naik tetapi tak pernah disimpan (borang ditinggalkan) dipadam secara oportunistik selepas setiap muat naik
baharu kedai itu, jika berumur lebih 6 jam dan tak dirujuk oleh produk atau banner (`sweepOrphans` dalam `lib/media.js`).

## Halaman kedai awam (Fasa 4)

- `functions/[slug].js` baca `catalog/<slug>.json` dari R2 (tiada D1), suntik meta OG (pratonton WhatsApp) dan data ke `public/shop.html`.
  Header keselamatan diset dalam `lib/shoppage.js` kerana `_headers` tak terpakai pada respons Function (ujian memastikan CSP sama).
- Troli dalam `localStorage` pelanggan (`kedai:troli:<slug>`), maksimum 30 item berbeza. Tiada order disimpan di server.
- Mesej WhatsApp dibina oleh `public/assets/js/order.js` (templat lalai, atau templat Pro dengan `{kedai}` `{senarai_item}` `{jumlah}`
  `{nama}` `{alamat}` `{nota}`). Amaran bila melebihi 1,500 aksara.
- **Fallback "fail open":** bila had Functions harian dicapai, Pages hidang `404.html` untuk `/<slug>`. Halaman itu baca slug dari URL
  dan ambil `https://media.annurpro.com/catalog/<slug>.json` terus. Ini memerlukan **CORS pada bucket R2**:
  R2, `kedai-media`, Settings, CORS Policy, tambah:

  ```json
  [{ "AllowedOrigins": ["https://kedai.annurpro.com"], "AllowedMethods": ["GET"], "AllowedHeaders": [], "MaxAgeSeconds": 3600 }]
  ```

  Jangan guna `_redirects` untuk fallback ini: peraturan `/:slug` mengatasi fail statik sebenar (`/robots.txt`, `/favicon.svg`).
- Pratonton WhatsApp guna banner pertama sebagai `og:image`, atau `public/assets/og-default.png` jika tiada banner.

## Pelan dan langganan (Fasa 5)

- Status pelan dikira di server (`planStatus` dalam `lib/plan.js`, UTC, selaras dengan `effectivePlanCode`):
  `active`, `ending` (14 hari atau kurang), `grace` (dalam `GRACE_DAYS`), `expired`. Notis dipapar di dashboard dan S-14.
- Templat mesej (Pro): mesti mengandungi `{senarai_item}`, maksimum 800 aksara; kosong = templat lalai. Bila pelan turun, templat
  kekal dalam D1 tetapi tak diterbitkan.
- Tukar pelan melalui panel superadmin (`/admin/`, Fasa 7). Jika diubah terus dalam D1 Console, tekan "Bina semula semua" di panel
  supaya katalog awam ikut serta.

## Panel superadmin (Fasa 7)

- `/admin/`: log masuk Google dengan e-mel dalam `SUPERADMIN_EMAILS`. E-mel lain nampak "Akses ditolak"; API `/api/admin/*` pulang 403.
- Tambah bulan ikut BSD peraturan 4 (`lib/subscription.js`, dikongsi dengan webhook BCL Fasa 6): dari tarikh tamat jika masih aktif atau
  dalam toleransi, jika tidak dari hari ini; 31 Jan + 1 bulan = 28/29 Feb dan kembali ke 31hb.
- Setiap tindakan (pelan, tambah bulan, gantung, padankan bayaran, slug reserved, bina semula) direkod dalam `audit_log`.
  Membuka tab Bayaran membuang rekod audit lebih 12 bulan.
- Bina semula katalog berjalan 8 kedai setiap panggilan supaya kekal dalam had CPU dan subrequest Functions percuma.

## Akaun, privasi dan landing (Fasa 8)

- Akaun (S-15): "Muat turun data saya" (`GET /api/account/export`, JSON) dan "Padam kedai" (`DELETE /api/shop` dengan
  `confirmSlug`). Padam membuang semua objek R2 `shops/<id>/` dan snapshot dahulu, kemudian rekod kedai (produk, kategori
  dan banner ikut cascade). Rekod bayaran kekal dengan `shop_id` kosong, dan `audit_log` merekod `delete_shop`.
- `/privasi` dan `/terma` ialah fail statik (dikecualikan dalam `_routes.json`). E-mel sokongan diisi daripada `/api/config`
  supaya tiada e-mel peribadi dalam repo awam. `terma` juga disekat sebagai slug kedai.
- Landing: harga diambil daripada `/api/plans` (teks lalai dalam HTML jika API gagal). Butang "Lihat contoh kedai" hanya
  muncul bila `HEAD /contoh` pulang 200.
- Tangkapan skrin landing dijana daripada aplikasi sebenar dengan kedai demo:

```bash
WRANGLER_BIN=<path ke wrangler.js> node scripts/landing-shots.js
```

- LCP halaman kedai diukur dalam e2e: rangkaian dimodelkan sebagai Slow 4G (1.6 Mbps dikongsi, RTT 150 ms, +3 RTT untuk
  sambungan pertama) dan CPU diperlahankan 4x, dengan banner WebP 1600x800 sebenar (~115 KB). Keputusan terakhir sekitar 1.9 s
  (sasaran 2.5 s). Ini anggaran makmal pada `wrangler pages dev`; semak semula dengan PageSpeed Insights selepas launch.

## Tema dan PWA

- Tema landing, privasi, terma dan offline ada dalam `public/assets/css/site.css` sahaja: gelap (lalai, tidak ikut tetapan sistem) dengan butang tukar
  ke cerah. Pilihan disimpan dalam `localStorage` (`kedai-tema`) dan dikenakan oleh `assets/js/theme.js` sebelum halaman dilukis.
  Dashboard `/app/` kekal dengan tema terangnya; tukar token dalam `base.css` jika mahu ia mengikut.
- Manifest `/manifest.webmanifest` (scope `/`, start `/app/`), ikon PNG di `assets/icons/` (jana semula dengan `node scripts/make-icons.js`),
  dan screenshot untuk dialog pemasangan (jana dengan `scripts/landing-shots.js`).
- `sw.js`: **network-first**, kerana fail tiada hash dalam nama dan cache-first akan menghidang JS lama selepas deploy. Cache hanya dipakai bila
  rangkaian gagal (halaman yang pernah dibuka, atau `offline.html`). Hanya landing, privasi, terma, `/app/` dan `/assets/` disentuh; `/api/*`,
  `/admin/*` dan halaman kedai `/<slug>` tak pernah dicache. Naikkan `VERSION` dalam `sw.js` hanya jika struktur cache berubah.
- Pasang: Chrome/Edge/Android tunjuk butang "Pasang app" (landing dan Akaun). iPhone: Safari, Kongsi, Tambah ke Skrin Utama.
- Pages menukar `/x.html` kepada `/x`. Setiap halaman statik baharu di akar mesti dikecualikan dalam `_routes.json` dalam **kedua-dua** bentuk
  (`/x.html` dan `/x`); `tests/static.test.js` menguatkuasakannya. Tambah juga nama itu ke `EXTRA_RESERVED` dalam `rules.js`.

## Senarai semak launch (IPD seksyen 9)

Buat semua ini di dashboard, bukan dalam kod. Jangan tampal token atau secret dalam chat atau commit.

1. **Domain**: `kedai.annurpro.com` (Pages) dan `media.annurpro.com` (R2) aktif dengan HTTPS.
2. **CORS R2** untuk `kedai-media` (lihat bahagian halaman kedai awam) supaya fallback 404.html berfungsi.
3. **Pemboleh ubah Pages (Production)**: `GOOGLE_CLIENT_ID`, `SUPERADMIN_EMAILS`, `MEDIA_BASE_URL`, `SUPPORT_EMAIL`, `SESSION_DAYS`.
   Binding `DB` dan `MEDIA` ada untuk Production.
4. **Google OAuth consent screen**: isi Home page `https://kedai.annurpro.com/`, Privacy policy
   `https://kedai.annurpro.com/privasi`, Terms `https://kedai.annurpro.com/terma`, kemudian tukar ke **In production**.
   Authorized JavaScript origins mesti ada `https://kedai.annurpro.com`.
5. **Semak teks privasi dan terma** (draf, terutamanya senarai produk dilarang dan polisi bayaran balik) dan kemas kini tarikh.
6. **Kedai demo `contoh`**: log masuk dengan akaun anda sendiri dan cipta kedai dengan slug `contoh` *sebelum* launch, supaya
   orang lain tak boleh mengambil slug itu. Butang "Lihat contoh kedai" di landing muncul secara automatik.
7. **2FA** pada akaun Cloudflare, GitHub dan Google yang digunakan.
8. **Ujian live**: log masuk di phone, cipta produk dengan gambar, buka `/<slug>`, hantar order ke WhatsApp, eksport data,
   kongsi link di WhatsApp untuk semak pratonton (OG).
9. **Fasa 6 (BCL)**: bila disambung semula, letak token BCL dan kunci webhook terus dalam tetapan Pages (Encrypted), bukan dalam kod.
10. **PageSpeed Insights** untuk satu kedai sebenar (mobile) dan rekod LCP.
