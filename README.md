# Kedai AnnurPro

Katalog digital untuk peniaga kecil: pelanggan pilih produk, troli dihantar sebagai mesej siap ke WhatsApp peniaga.
Stack: Cloudflare Pages (frontend statik tanpa build step) + Pages Functions (API) + D1 + R2. Login Google.

## Status fasa

| Fasa | Skop | Status |
|---|---|---|
| 0 | Repo, `_routes.json`, `_headers`, halaman Hello, skema D1 | Kod siap. Setup akaun Cloudflare/Google ikut langkah di bawah |
| 1 | Login Google, sesi D1, `/api/me`, logout, semakan Origin, kerangka `/app/` | Kod siap, ujian lulus |
| 2 | Setup kedai 3 langkah (S-08), semakan slug, WhatsApp, warna, mampat dan muat naik gambar, banner, tetapan kedai (S-13) | Kod siap, ujian lulus. Perlu R2 dan binding `MEDIA` untuk uji secara live |
| 3 hingga 8 | Ikut IPD | Belum mula |

## Struktur

```
public/            fail statik yang dihidang (build output directory)
  _routes.json     Functions hanya untuk /api/* dan /<slug>; fail statik dikecualikan
  _headers         CSP dan header keselamatan untuk fail statik
  index.html       halaman Hello (landing penuh dalam Fasa 8)
  app/             dashboard peniaga (S-07 hingga S-15)
  admin/           panel superadmin (Fasa 7)
  assets/          CSS dan modul JS
functions/api/     Pages Functions (API): auth, me, shop, shop/banners, slug-check, upload, config, ping
lib/               kod kongsi untuk Functions (tidak dihidang kepada awam)
db/0001_init.sql   skema D1 (jalankan sekali dalam Console)
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

## Nota untuk fasa seterusnya

- **Fasa 3, snapshot:** `buildSnapshot` mesti dipanggil selepas `PUT /api/shop/banners` dan `PATCH /api/shop` (ada penanda `Fasa 3:` dalam kod).
  Tukar slug mesti memindahkan `catalog/<slug_lama>.json`. Kedai `suspended` tak boleh dibina semula snapshotnya.
- **Fasa 3, objek yatim:** gambar yang dimuat naik tetapi tak pernah dipautkan (borang ditinggalkan) kekal di R2 dan tak dikira dalam
  `storage_bytes`. Ia dibuang bila kedai dipadam (awalan `shops/<id>/`). Pembersihan oportunistik ditambah bersama muat naik produk.
