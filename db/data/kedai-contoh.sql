-- Data demo (BUKAN migrasi skema): kedai "contoh" supaya pembeli boleh cuba katalog, troli dan hantar order.
-- Jalankan sekali dalam Cloudflare D1 Console (kedai-db). Selamat diulang (INSERT OR IGNORE).
--
-- SEBELUM JALANKAN: tukar 60100000000 kepada nombor WhatsApp yang anda mahu terima order percubaan
-- (format 60 tanpa +, contoh 60123456789). Jangan commit nombor sebenar ke repo awam.
--
-- Selepas itu: /admin/ > Bayaran dan penyelenggaraan > "Bina semula yang gagal sahaja", kemudian buka
-- kedai.annurpro.com/contoh. Butang "Lihat contoh kedai" di landing page muncul sendiri.
-- Pemilik ialah pengguna demo yang tak boleh log masuk (tiada akaun Google). Ubah melalui panel admin.
INSERT OR IGNORE INTO users (id, google_sub, email, name)
VALUES ('u-demo-contoh', 'demo-contoh-tiada-login', 'demo-contoh@tiada-login.invalid', 'Kedai Contoh');

INSERT OR IGNORE INTO shops (id, owner_user_id, slug, name, description, whatsapp, theme_color, ask_name, ask_address, plan_code, catalog_dirty, category, market_opt)
VALUES ('shop-demo-contoh', 'u-demo-contoh', 'contoh', 'Kedai Contoh',
        'Ini kedai contoh. Cuba tambah produk ke troli dan tekan Hantar ke WhatsApp untuk lihat bagaimana order sampai kepada peniaga.',
        '60100000000', '#0F766E', 1, 1, 'free', 1, 'kuih', 0);

INSERT OR IGNORE INTO categories (id, shop_id, name, sort_order) VALUES
  ('c-demo-1', 'shop-demo-contoh', 'Kuih tradisional', 1),
  ('c-demo-2', 'shop-demo-contoh', 'Kek dan roti', 2),
  ('c-demo-3', 'shop-demo-contoh', 'Minuman', 3);

INSERT OR IGNORE INTO products (id, shop_id, category_id, name, description, price_sen, is_available, sort_order) VALUES
  ('p-demo-01', 'shop-demo-contoh', 'c-demo-1', 'Kuih lapis', 'Kuih lapis sagu 9 lapisan, lembut dan manis. Sebekas 10 potong.', 1200, 1, 1),
  ('p-demo-02', 'shop-demo-contoh', 'c-demo-1', 'Karipap pusing', 'Inti kentang dan ayam berempah. Seplastik 6 biji.', 800, 1, 2),
  ('p-demo-03', 'shop-demo-contoh', 'c-demo-1', 'Seri muka', 'Pulut kukus bersama kastard pandan. Sebekas 8 potong.', 1500, 1, 3),
  ('p-demo-04', 'shop-demo-contoh', 'c-demo-1', 'Onde-onde', 'Inti gula melaka dan kelapa parut. Sebekas 12 biji.', 1000, 0, 4),
  ('p-demo-05', 'shop-demo-contoh', 'c-demo-2', 'Kek coklat moist', 'Kek coklat lembap bersalut ganache. Saiz 7 inci, tempahan sehari awal.', 4500, 1, 1),
  ('p-demo-06', 'shop-demo-contoh', 'c-demo-2', 'Roti gardenia buatan sendiri', 'Roti lembut, sesuai untuk sarapan. Sebungkus 1 loaf.', 700, 1, 2),
  ('p-demo-07', 'shop-demo-contoh', 'c-demo-2', 'Kek tempahan', 'Bentuk dan rasa ikut permintaan. Hubungi kami untuk harga.', NULL, 1, 3),
  ('p-demo-08', 'shop-demo-contoh', 'c-demo-3', 'Teh tarik', 'Teh tarik panas atau sejuk. Satu cawan.', 350, 1, 1),
  ('p-demo-09', 'shop-demo-contoh', 'c-demo-3', 'Air sirap selasih', 'Sirap bandung dengan selasih. Satu botol 500 ml.', 400, 1, 2);
