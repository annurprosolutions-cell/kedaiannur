-- 0007: artikel diurus oleh superadmin (menggantikan fail statik public/artikel/*.html). Jalankan sekali dalam
-- Cloudflare D1 Console (kedai-db) SEBELUM deploy kod yang menggunakannya.
-- body = Markdown ringkas (rujuk public/assets/js/artikel.js). Gambar disimpan dalam R2 di bawah articles/.
CREATE TABLE IF NOT EXISTS articles (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  seo_title     TEXT NOT NULL DEFAULT '',       -- tajuk untuk <title> dan Google; kosong = guna title
  description   TEXT NOT NULL DEFAULT '',       -- meta description, juga ringkasan dalam senarai
  body          TEXT NOT NULL DEFAULT '',
  cover_key     TEXT,                           -- gambar utama (og:image), articles/<uuid>.webp
  cover_alt     TEXT NOT NULL DEFAULT '',
  focus_keyword TEXT NOT NULL DEFAULT '',       -- untuk semakan SEO dalam editor sahaja
  author        TEXT NOT NULL DEFAULT 'Kedai AnnurPro',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  noindex       INTEGER NOT NULL DEFAULT 0,     -- 1 = minta Google jangan indeks
  featured      INTEGER NOT NULL DEFAULT 0,     -- 1 = didahulukan di sale page
  published_at  TEXT,                           -- diisi kali pertama diterbitkan (UTC)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles (status, published_at);
-- Lima artikel asal (dahulu fail statik), supaya boleh disunting dari panel admin.
INSERT OR IGNORE INTO articles (id, slug, title, description, body, focus_keyword, status, published_at, created_at, updated_at) VALUES ('art-asal-1', 'katalog-online-order-whatsapp', 'Cara buat katalog online yang order terus ke WhatsApp', 'Langkah demi langkah membina katalog online untuk peniaga kecil, supaya pelanggan pilih produk sendiri dan order sampai ke WhatsApp dalam satu mesej tersusun.', 'Ramai peniaga kecil menerima order melalui WhatsApp: pelanggan tanya harga, minta gambar, kemudian taip order satu persatu. Cara ini berfungsi, tapi memakan masa dan mudah tersilap kuantiti. Katalog online menyelesaikan bahagian yang berulang: pelanggan nampak semua produk dan harga, pilih sendiri, dan menghantar order yang sudah tersusun.

## 1. Tentukan apa yang pelanggan perlu tahu

Sebelum menambah produk, senaraikan maklumat yang selalu ditanya: harga, saiz atau berat, pilihan perisa atau warna, dan cara ambil atau hantar. Masukkan maklumat ini dalam penerangan produk supaya pelanggan tak perlu bertanya semula.

## 2. Susun produk mengikut kategori

Kategori membantu pelanggan mencari dengan cepat, terutama bila produk melebihi 10 item. Contoh untuk kedai kuih: Kuih tradisional, Kek, Minuman. Elakkan terlalu banyak kategori kecil; tiga hingga enam biasanya cukup.

## 3. Gunakan gambar yang jelas

Gambar ialah perkara pertama yang pelanggan lihat. Guna cahaya semula jadi, latar yang kemas, dan potong gambar supaya produk berada di tengah. Rujuk [tips ambil gambar produk guna phone](/artikel/tips-gambar-produk-guna-phone).

## 4. Pastikan order sampai dalam format yang mudah dibaca

Mesej order yang baik mengandungi nama item, kuantiti, harga setiap baris, jumlah, dan nota pelanggan. Dengan format tetap, anda boleh semak order sekali imbas dan terus sahkan dengan pelanggan.

## 5. Kongsi satu link di semua tempat

Letak link katalog di bio Instagram dan TikTok, status WhatsApp, kumpulan pelanggan, dan pada poster kod QR di kaunter. Satu link yang sama memudahkan pelanggan kembali dan memudahkan anda mengemas kini harga di satu tempat sahaja.

## 6. Kemas kini bila stok habis

Tanda produk yang habis supaya pelanggan tak membuat order yang tak dapat dipenuhi. Ini menjimatkan masa membalas mesej dan menjaga kepercayaan pelanggan.

## Ringkasan

Katalog online tak menggantikan perbualan dengan pelanggan; ia memendekkan bahagian yang berulang. Pelanggan memilih sendiri, dan anda menerima order yang lengkap untuk disahkan.', 'katalog online', 'published', '2026-11-12 00:00:00', '2026-11-12 00:00:00', '2026-11-12 00:00:00');
INSERT OR IGNORE INTO articles (id, slug, title, description, body, focus_keyword, status, published_at, created_at, updated_at) VALUES ('art-asal-2', 'saiz-gambar-produk-banner-logo', 'Saiz gambar produk, banner dan logo untuk kedai online', 'Panduan saiz dan nisbah gambar produk, banner dan logo supaya kedai online nampak kemas di phone dan komputer.', 'Gambar yang tak sepadan saiz akan dipotong secara automatik, kadang-kadang memotong bahagian penting seperti tulisan atau produk itu sendiri. Panduan ini menggunakan saiz yang dipakai oleh Kedai AnnurPro, tetapi prinsipnya sama untuk kebanyakan platform.

## Gambar produk: segi empat sama

Saiz yang disyorkan ialah sekurang-kurangnya 1000 x 1000 piksel, nisbah 1:1. Letak produk di tengah dengan sedikit ruang kosong di sekeliling. Gambar memanjang (potret) atau melebar (landskap) masih boleh digunakan; potong bahagian yang paling penting semasa memuat naik.

## Banner: 1600 x 800 piksel (2:1)

Banner dipaparkan di bahagian atas kedai. Letak tajuk dan teks penting di tengah, jauh dari tepi. Di phone, bahagian bawah kiri banner mungkin dilindungi logo kedai, jadi elakkan teks di situ. Peniaga Kedai AnnurPro boleh memuat turun templat banner dengan zon selamat di halaman Tetapan.

## Logo: 512 x 512 piksel

Logo dipaparkan dalam bentuk bulat, jadi pastikan simbol atau huruf utama berada di tengah. Logo dengan banyak teks kecil sukar dibaca pada saiz kecil; versi ringkas (simbol atau huruf awal) biasanya lebih jelas.

## Saiz fail

Gambar dari kamera phone boleh mencecah beberapa MB. Kedai AnnurPro memampatkan gambar secara automatik di phone anda sebelum dimuat naik, supaya kedai laju dibuka walaupun dengan data mobile.

## Senarai semak ringkas

- Produk: 1:1, sekurang-kurangnya 1000 x 1000 piksel.
- Banner: 2:1, 1600 x 800 piksel, teks di tengah.
- Logo: 1:1, 512 x 512 piksel, simbol di tengah.', 'saiz gambar produk', 'published', '2026-11-12 01:00:00', '2026-11-12 01:00:00', '2026-11-12 01:00:00');
INSERT OR IGNORE INTO articles (id, slug, title, description, body, focus_keyword, status, published_at, created_at, updated_at) VALUES ('art-asal-3', 'tips-gambar-produk-guna-phone', '7 tips ambil gambar produk guna phone', 'Tujuh tips praktikal mengambil gambar produk yang menarik menggunakan phone sahaja, tanpa peralatan mahal.', 'Anda tak perlukan kamera mahal untuk gambar produk yang baik. Phone moden sudah memadai jika beberapa perkara asas dijaga.

## 1. Guna cahaya tingkap

Letak produk berhampiran tingkap pada waktu siang, tetapi elakkan cahaya matahari terus yang menghasilkan bayang keras. Cahaya mendung atau langsir nipis memberi hasil yang lembut.

## 2. Matikan flash

Flash phone menghasilkan pantulan dan warna yang tak semula jadi, terutama pada bungkusan plastik atau kaca.

## 3. Latar yang kemas

Kertas putih, kain polos atau papan kayu sudah cukup. Latar yang sibuk mengalihkan perhatian daripada produk.

## 4. Isi bingkai dengan produk

Dekatkan phone kepada produk dan bukannya zum digital, yang mengurangkan kualiti. Biarkan sedikit ruang di sekeliling supaya gambar boleh dipotong menjadi segi empat.

## 5. Lap kanta kamera

Kanta phone selalu berminyak kerana dipegang. Lap dengan kain lembut sebelum mengambil gambar; ini sering menjadi beza antara gambar kabur dan jelas.

## 6. Ambil dari beberapa sudut

Ambil dari atas, dari sisi, dan dekat untuk menunjukkan tekstur. Pilih yang paling jelas sebagai gambar utama.

## 7. Konsisten untuk semua produk

Gunakan latar dan sudut yang sama untuk semua produk. Katalog nampak lebih kemas dan profesional bila gambar-gambarnya seragam.

Untuk saiz yang sesuai, rujuk [panduan saiz gambar produk, banner dan logo](/artikel/saiz-gambar-produk-banner-logo).', 'gambar produk', 'published', '2026-11-12 02:00:00', '2026-11-12 02:00:00', '2026-11-12 02:00:00');
INSERT OR IGNORE INTO articles (id, slug, title, description, body, focus_keyword, status, published_at, created_at, updated_at) VALUES ('art-asal-4', 'kod-qr-untuk-gerai-dan-kaunter', 'Guna kod QR di gerai dan kaunter untuk dapat order WhatsApp', 'Cara menggunakan kod QR di gerai, kaunter dan bungkusan supaya pelanggan boleh membuka katalog dan membuat order semula melalui WhatsApp.', 'Pelanggan yang singgah di gerai atau kedai fizikal selalunya tak menyimpan nombor telefon anda. Kod QR yang membawa ke katalog online memberi mereka cara mudah untuk melihat produk lain dan membuat order semula kemudian.

## Di mana hendak letak kod QR

- Kaunter bayaran dan meja gerai, pada paras mata.
- Pada bungkusan atau pelekat produk, supaya pelanggan boleh order semula di rumah.
- Pada risalah, kad nama, dan papan tanda.

## Tulis arahan yang jelas

Kod QR sahaja tidak memadai. Letak ayat ringkas seperti "Imbas untuk tengok semua produk dan order melalui WhatsApp". Pelanggan lebih cenderung mengimbas bila tahu apa yang akan berlaku.

## Saiz dan cetakan

Cetak kod QR sekurang-kurangnya 3 cm lebar untuk pelekat, dan lebih besar untuk poster yang diimbas dari jauh. Uji imbas dengan beberapa phone sebelum mencetak banyak.

## Ukur hasilnya

Kedai AnnurPro menanda lawatan yang datang daripada kod QR, jadi anda boleh melihat berapa ramai pelanggan datang dari gerai berbanding dari media sosial di halaman Statistik.

Peniaga Kedai AnnurPro boleh menjana kod QR dan poster A5 siap cetak terus dari dashboard.', 'kod QR', 'published', '2026-11-12 03:00:00', '2026-11-12 03:00:00', '2026-11-12 03:00:00');
INSERT OR IGNORE INTO articles (id, slug, title, description, body, focus_keyword, status, published_at, created_at, updated_at) VALUES ('art-asal-5', 'meta-pixel-tiktok-pixel-untuk-peniaga', 'Meta Pixel dan TikTok Pixel: apa dan bila peniaga kecil perlukannya', 'Penerangan ringkas tentang Meta Pixel, TikTok Pixel dan Google Analytics untuk peniaga kecil yang membuat iklan, dan bila ia berbaloi dipasang.', 'Jika anda membuat iklan di Facebook, Instagram atau TikTok, anda mungkin pernah diminta memasang "pixel". Artikel ini menerangkan apa fungsinya dan bila ia berbaloi.

## Apa itu pixel

Pixel ialah kod kecil daripada platform iklan yang dipasang di laman anda. Ia memberitahu platform tersebut apa yang dilakukan pelawat selepas mengklik iklan, contohnya melihat produk, menambah ke troli, atau mula membuat order. Meta Pixel digunakan untuk iklan Facebook dan Instagram; TikTok Pixel untuk iklan TikTok; Google Analytics atau Google Ads untuk carian dan iklan Google.

## Kenapa ia berguna

- Anda boleh nampak iklan mana yang benar-benar membawa order, bukan sekadar klik.
- Platform iklan boleh mencari lebih ramai orang yang serupa dengan pelanggan yang membuat order.
- Anda boleh menunjukkan iklan semula kepada orang yang sudah melihat produk anda.

## Bila anda belum perlukannya

Jika anda belum membuat iklan berbayar, pixel tidak memberi banyak manfaat. Statistik kedai yang ringkas (lawatan dan order) sudah cukup untuk mula.

## Privasi

Pixel dikendalikan oleh syarikat pengiklanan dan boleh menetapkan kuki di pelayar pelawat. Maklumkan kepada pelanggan bahawa kedai anda menggunakan piksel pengiklanan, dan patuhi Akta Perlindungan Data Peribadi 2010 serta dasar pengiklanan platform.

## Di Kedai AnnurPro

Peniaga pelan Pro hanya perlu mengisi ID piksel di halaman Tetapan. Sistem memasang kod dengan cara yang selamat, menghantar acara Lihat produk, Tambah troli dan Mula checkout dalam Ringgit, dan memaparkan notis piksel di bawah halaman kedai secara automatik.', 'Meta Pixel', 'published', '2026-11-12 04:00:00', '2026-11-12 04:00:00', '2026-11-12 04:00:00');
