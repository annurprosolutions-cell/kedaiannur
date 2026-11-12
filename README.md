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
| 6 | Langganan BCL: borang (RM20/RM200, kuantiti), webhook dengan pengesahan API, kiraan bulan, bayaran tak padan diterapkan bila kedai dicipta, S-14 butang Bayar | Kod siap, ujian lulus. Perlu token BCL dan kunci webhook (lihat bawah) |
| 8c | Cropper gambar produk dan banner, landing cerah lalai dengan animasi scroll | Kod siap, ujian lulus |
| 8d | Logo kedai (semua pelan); Pro: logo jadi favicon dan ikon skrin utama kedai | Siap, live |
| P1 | Pusingan 1: jenama AnnurPro (favicon, ikon PWA, OG), maklumat hubungan kedai, senarai semak setup, panduan dan templat banner, statistik admin dengan carta, peringatan tamat melalui WhatsApp | Siap, live |
| P2 | Pusingan 2: Marketplace (jenis kedai, Pro automatik, Percuma pilih masuk, syarat kelengkapan, Pilihan Admin), sitemap.xml, JSON-LD kedai, kod QR dan poster A5 (Fasa 10) | Kod siap, ujian lulus. Perlu `db/0005_marketplace.sql` di D1 sebelum deploy |
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

- Tema landing, privasi, terma dan offline ada dalam `public/assets/css/site.css` sahaja: cerah (lalai, tidak ikut tetapan sistem) dengan butang tukar
  ke gelap. Animasi scroll (`data-reveal`, `data-stagger`) dimatikan untuk prefers-reduced-motion. Pilihan disimpan dalam `localStorage` (`kedai-tema`) dan dikenakan oleh `assets/js/theme.js` sebelum halaman dilukis.
  Dashboard `/app/` kekal dengan tema terangnya; tukar token dalam `base.css` jika mahu ia mengikut.
- Manifest `/manifest.webmanifest` (scope `/`, start `/app/`), ikon PNG di `assets/icons/` (jana semula dengan `node scripts/make-icons.js`),
  dan screenshot untuk dialog pemasangan (jana dengan `scripts/landing-shots.js`).
- `sw.js`: **network-first**, kerana fail tiada hash dalam nama dan cache-first akan menghidang JS lama selepas deploy. Cache hanya dipakai bila
  rangkaian gagal (halaman yang pernah dibuka, atau `offline.html`). Hanya landing, privasi, terma, `/app/` dan `/assets/` disentuh; `/api/*`,
  `/admin/*` dan halaman kedai `/<slug>` tak pernah dicache. Naikkan `VERSION` dalam `sw.js` hanya jika struktur cache berubah.
- Pasang: Chrome/Edge/Android tunjuk butang "Pasang app" (landing dan Akaun). iPhone: Safari, Kongsi, Tambah ke Skrin Utama.
- Pages menukar `/x.html` kepada `/x`. Setiap halaman statik baharu di akar mesti dikecualikan dalam `_routes.json` dalam **kedua-dua** bentuk
  (`/x.html` dan `/x`); `tests/static.test.js` menguatkuasakannya. Tambah juga nama itu ke `EXTRA_RESERVED` dalam `rules.js`.

## Langganan BCL (Fasa 6)

Borang: **KEDAI ANNURPRO - LANGGANAN PRO** (ID 21437), `https://annurprosolutions1.bcl.my/form/kedai-annurpro-pro`.
Item `KEDAI PRO BULANAN` RM20 dan `KEDAI PRO TAHUNAN` RM200, kuantiti dibenarkan, medan wajib "E-mel akaun Google untuk log masuk".
Borang ini dicipta **tidak aktif** dengan webhook dimatikan. Webhook hanya menerima item yang namanya mengandungi "KEDAI PRO",
jadi jangan tukar nama item tanpa mengemas kini `lib/bcl.js`.

Langkah (sekali sahaja, jangan tampal token atau kunci dalam chat):

1. **D1 Console** (`kedai-db`): jalankan `db/0002_harga_pro.sql` untuk harga RM20/RM200.
2. **Kunci webhook**: jana rentetan rawak panjang, contohnya dalam Console pelayar:
   `crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')`. Simpan dalam password manager.
3. **Cloudflare Pages**, projek, Settings, Variables and Secrets (Production):
   - `BCL_FORM_ID` = `21437` (Text)
   - `BCL_FORM_URL` = `https://annurprosolutions1.bcl.my/form/kedai-annurpro-pro` (Text)
   - `BCL_WEBHOOK_KEY` = kunci langkah 2 (**Secret**)
   - `BCL_API_TOKEN` = token BCL "API Read" sahaja (**Secret**)
   Kemudian Deployments, Retry deployment (pemboleh ubah baharu hanya terpakai selepas deploy).
4. **BCL**, borang Kedai, Settings:
   - Webhook URL: `https://kedai.annurpro.com/api/webhooks/bcl/<kunci langkah 2>`, acara **Payment Success**, Enable.
   - Medan tersuai: tukar teks bantuan (masih menyebut Jadual Sekolah dan DELIMa) kepada
     "Guna e-mel Google yang sama dengan log masuk Kedai AnnurPro."
5. **Ujian RM1 sebenar**: tambah item sementara `KEDAI PRO BULANAN UJIAN` RM1, aktifkan borang, bayar dengan e-mel
   Google akaun ujian dalam medan tersuai. Dalam ~1 minit, Langganan akaun itu patut menunjukkan Pro dan bayaran dalam sejarah.
   Semak log: Workers & Pages, projek, Functions, Real-time logs (`webhook BCL {...}`). Kemudian buang item RM1.
6. Aktifkan borang. Letak peringatan kalendar sebulan sebelum token API BCL tamat (kira-kira setahun).

Nota operasi:
- BCL **tak mengulang** webhook yang gagal. Jika peniaga bayar tetapi Pro tak aktif: semak Real-time logs, kemudian
  BCL, Tools, Webhook Logs, Resend. Hantar semula selamat (order_no UNIQUE, tiada masa berganda).
- E-mel salah taip dalam borang: bayaran jadi "tak padan" di panel admin (S-18); padankan dengan kedai yang betul.
- Bayar sebelum daftar: bayaran disimpan "tak padan" dan diterapkan automatik bila kedai dengan e-mel itu dicipta.
- `BCL_ACCEPT_TEST=1` hanya untuk "Send Test Webhook" BCL; padam selepas ujian.

## Logo kedai

- Tetapan, bahagian Logo: muat naik dengan cropper bulat (1:1, maksimum 512 px, 100 KB), tukar atau buang. Disimpan
  `shops/<id>/l_<uuid>.webp`; saiz dikira dalam storage pelan. Endpoint `PUT /api/shop/logo { key | null }`.
- Semua pelan: logo dipaparkan di kepala kedai, dan menjadi gambar pratonton link jika kedai tiada banner.
- Pro (ciri yang sama kelas dengan buang branding, `plans.hide_branding`): logo juga menjadi favicon dan
  apple-touch-icon halaman kedai (`snapshot.shop.fav`).
- Migrasi: jalankan `db/0003_logo.sql` dalam D1 Console **sebelum** deploy kod ini. Ujian memuatkan semua `db/NNNN_*.sql` mengikut urutan.

## Pusingan 1

- **Jenama**: simbol "A" daripada logo AnnurPro (`public/assets/brand/annurpro-mark.png`). Jana semula ikon, favicon dan
  tanda header dengan `node scripts/make-icons.js`; gambar pratonton lalai dengan `node scripts/make-og.js` (kemudian
  kecilkan dengan pengkuantuman PNG, rujuk sejarah commit); templat banner dengan `node scripts/make-templates.js`.
- **Maklumat hubungan kedai** (semua pelan, migrasi `db/0004_maklumat_kedai.sql`): waktu operasi, pautan Google Maps (hanya
  domain Google Maps diterima), Instagram, TikTok, Facebook (disimpan sebagai nama akaun; pautan dibina oleh sistem).
  Dipaparkan di bawah nama kedai (`snapshot.shop.info`).
- **Senarai semak "Lengkapkan kedai"** di dashboard: logo, banner, 3 produk, penerangan, maklumat hubungan, kongsi link
  (langkah kongsi ditanda dalam peranti, `localStorage`). Hilang bila semua siap.
- **Panduan saiz**: banner 1600 x 800 (templat `/assets/templates/templat-banner-1600x800.png` dengan zon selamat dan
  kawasan logo), logo 512 x 512, produk segi empat.
- **Statistik admin** (`/admin/#/statistik`, `GET /api/admin/stats`): jubin, carta bar 30 hari (kedai baharu, hasil;
  waktu Malaysia) dengan tooltip dan jadual, dan senarai Pro hampir tamat atau dalam toleransi dengan butang **Ingatkan**
  yang membuka WhatsApp dengan mesej siap (`POST /api/admin/shops/:id/remind` merekod dalam audit log). Carta: `assets/js/chart.js`
  (SVG tanpa library; warna disahkan dengan validator dataviz).

## Pusingan 2: Marketplace, SEO, kod QR

- **Marketplace** `/marketplace` (statik + `GET /api/market`, awam). Indeks `market/index.json` dalam R2, dibina daripada D1:
  bila tiada, bila luput (5 minit, dibina di latar), bila peniaga mengubah medan yang dipaparkan, bila admin bertindak,
  dan bila status kedai berubah selepas tulisan kandungan (`syncMarketForShop` dalam `publishSnapshot`).
  Kelayakan (`lib/market.js`): Pro automatik kecuali pilih keluar; Percuma perlu pilih masuk; semua perlu jenis kedai,
  logo atau banner, sekurang-kurangnya 3 produk ada stok, tidak digantung dan tidak disembunyikan admin.
  Susunan: Pilihan Admin, Pro, skor kelengkapan, kemas kini terkini. Jenis kedai: `SHOP_CATEGORIES` dalam `rules.js`.
- **Tetapan**: kad Marketplace (jenis kedai, suis senaraikan, status dan senarai perkara belum lengkap).
- **Admin**: butiran kedai, bahagian Marketplace: Sembunyikan / Papar semula, Pilihan Admin. Direkod dalam audit log.
- **SEO**: `/sitemap.xml` (Function; halaman awam dan kedai yang tersenarai), `robots.txt` menunjuk ke sitemap, dan
  JSON-LD schema.org `Store` pada setiap halaman kedai (nama, URL, penerangan, gambar, peta, media sosial).
- **Kod QR** (`#/qr`, `assets/js/qr.js`): dijana dalam browser dengan `assets/vendor/qrcode-generator-2.0.4.js`
  (MIT, Kazuhiko Arase), muat turun PNG, poster A5 dengan logo kedai (logo perlu CORS pada domain media; jika tiada,
  poster dijana tanpa logo) dan butang cetak.

## Gambar: cropper

Selepas memilih gambar produk atau banner, peniaga memotong dalam bingkai mengikut paparan kedai (produk 1:1, banner 2:1):
seret untuk alih, cubit atau slider untuk zum, Batal untuk kekal gambar lama. Pemampatan berlaku selepas potongan, jadi
saiz fail lebih kecil. Kod: `public/assets/js/cropper.js`, `image.js` (`readImage`, `compressBitmap`).

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
9. **Fasa 6 (BCL)**: ikut langkah "Langganan BCL" di atas, termasuk ujian RM1 sebenar, sebelum borang diaktifkan.
10. **PageSpeed Insights** untuk satu kedai sebenar (mobile) dan rekod LCP.
