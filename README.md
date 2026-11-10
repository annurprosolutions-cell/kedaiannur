# Kedai AnnurPro

Katalog digital untuk peniaga kecil: pelanggan pilih produk, troli dihantar sebagai mesej siap ke WhatsApp peniaga.
Stack: Cloudflare Pages (frontend statik tanpa build step) + Pages Functions (API) + D1 + R2. Login Google.

## Status fasa

| Fasa | Skop | Status |
|---|---|---|
| 0 | Repo, `_routes.json`, `_headers`, halaman Hello, skema D1 | Kod siap. Setup akaun Cloudflare/Google ikut langkah di bawah |
| 1 | Login Google, sesi D1, `/api/me`, logout, semakan Origin, kerangka `/app/` | Kod siap, ujian lulus |
| 2 hingga 8 | Ikut IPD | Belum mula |

## Struktur

```
public/            fail statik yang dihidang (build output directory)
  _routes.json     Functions hanya untuk /api/* dan /<slug>; fail statik dikecualikan
  _headers         CSP dan header keselamatan untuk fail statik
  index.html       halaman Hello (landing penuh dalam Fasa 8)
  app/             dashboard peniaga (S-07 hingga S-15)
  admin/           panel superadmin (Fasa 7)
  assets/          CSS dan modul JS
functions/api/     Pages Functions (API)
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
   - Runtime: Compatibility date `2025-09-01` atau lebih baharu (ujian local guna tarikh ini).
   - Functions: mod had harian biasanya "fail open" secara lalai. Pastikan ia tidak ditukar ke "fail closed".
6. **Google Cloud Console.** Cipta projek, Google Auth Platform (OAuth consent screen): External, mod Testing dahulu,
   tambah e-mel sendiri sebagai test user. Clients, Create client, jenis Web application:
   - Authorised JavaScript origins: `https://kedai.annurpro.com` (tambah juga URL `https://<projek>.pages.dev` jika mahu uji sebelum domain siap)
   - Redirect URI tidak diperlukan (aliran ID token melalui popup).
   - Salin Client ID ke `GOOGLE_CLIENT_ID` (langkah 5), kemudian Retry deployment supaya nilai baharu terpakai.
   - Tukar consent screen ke Production hanya selepas halaman privasi siap (Fasa 8).
7. **Rate limiting (pilihan, IPD keselamatan).** Security, WAF, Rate limiting rules: hadkan `/api/auth/` sekitar 20 permintaan seminit setiap IP.

## Semak selepas deploy (IPD 0.6 dan Fasa 1)

- `https://kedai.annurpro.com/` papar halaman Hello.
- `https://kedai.annurpro.com/api/ping` pulang `{"ok":true,...}`.
- `https://kedai.annurpro.com/api/me` tanpa login pulang 401 `perlu-login`.
- Buka `/app/`, log masuk dengan Google. Akaun baharu nampak skrin "Setup kedai" (Fasa 2). Log keluar kembali ke skrin login.
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
- Ralat API: `{ "ok": false, "code": "...", "message": "..." }` dalam Bahasa Malaysia.
