# Video promosi TikTok 60 saat

Video 9:16 (1080 x 1920, 30 fps) untuk mempromosi kedai.annurpro.com: masalah order WhatsApp berselerak, buat kedai dalam
3 langkah, pelanggan pilih produk dan hantar, order tiba dalam WhatsApp peniaga, kemudian ajakan mula percuma.

Dibina dengan Three.js: dua model phone 3D (badan logam, kilau kaca, kamera belakang), skrin dilukis sebagai tekstur
canvas yang meniru UI Kedai AnnurPro, gelembung chat, paket order yang terbang antara dua phone, dan zarah. Semuanya
fungsi bagi masa `t`, jadi dirakam frame demi frame dan hasilnya sentiasa sama.

## Fail

| Fail | Kegunaan |
|---|---|
| `timeline.json` | Masa adegan dan semua kesan bunyi (dikongsi video dan audio) |
| `ui.js` | Skrin phone (log masuk, setup, produk, QR, kedai pelanggan, troli, WhatsApp) dan animasi sentuhan |
| `main.js` | Adegan Three.js, kamera, kapsyen, CTA |
| `render.mjs` | Rakam frame dengan Chromium (WebGL perisian) |
| `audio.py` | Jana muzik dan kesan bunyi dengan numpy (tiada sampel berhak cipta) |
| `make.sh` | Pasang MP4 akhir dengan ffmpeg |

## Cara jana semula

Perlu Node 20+, Chromium Playwright, Python 3 dengan numpy dan ffmpeg.

```bash
cd promo
npm install
node render.mjs frames /tmp/frames --workers 3     # 1800 frame, lebih kurang 6 minit
python3 audio.py /tmp/audio.wav
./make.sh /tmp/frames /tmp/audio.wav /tmp/kedai-annurpro-tiktok.mp4
```

Semak beberapa frame sahaja: `node render.mjs stills /tmp/stills 5.5,12.3,46.5`.

## Mengubah isi

- Teks kapsyen: `CAPTIONS` dalam `main.js`. Teks CTA: `drawCTA`.
- Nama kedai, produk dan harga dalam video mengikut data demo `db/data/kedai-contoh.sql` (kedai.annurpro.com/contoh).
  Jalankan SQL itu dahulu supaya pautan dan kod QR dalam video benar-benar berfungsi.
- Masa sentuhan dan kesan bunyi: `timeline.json` dan masa dalam `ui.js` (cari nombor seperti `37.0`).
