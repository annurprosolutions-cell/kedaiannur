-- 0005: Marketplace. Jalankan sekali dalam Cloudflare D1 Console (kedai-db) SEBELUM deploy kod yang menggunakannya.
--   category        jenis kedai (kod daripada SHOP_CATEGORIES dalam public/assets/js/rules.js); kosong = belum dipilih
--   market_opt      pilihan peniaga: NULL = ikut lalai (Pro disenaraikan, Percuma tidak), 1 = mahu, 0 = tidak mahu
--   market_hidden   superadmin sembunyikan kedai daripada Marketplace
--   market_featured "Pilihan Admin": dipaparkan paling atas
ALTER TABLE shops ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN market_opt INTEGER;
ALTER TABLE shops ADD COLUMN market_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shops ADD COLUMN market_featured INTEGER NOT NULL DEFAULT 0;
