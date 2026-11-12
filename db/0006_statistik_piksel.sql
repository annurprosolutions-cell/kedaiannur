-- 0006: statistik pelawat tanpa nama dan piksel iklan. Jalankan sekali dalam Cloudflare D1 Console (kedai-db)
-- SEBELUM deploy kod yang menggunakannya.
-- Statistik: kiraan harian sahaja (tiada IP, kuki atau data peribadi). day = tarikh waktu Malaysia (YYYY-MM-DD).
CREATE TABLE IF NOT EXISTS stats_daily (
  shop_id  TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  day      TEXT NOT NULL,
  views    INTEGER NOT NULL DEFAULT 0,   -- lawatan halaman kedai (sekali setiap sesi pelawat)
  qr       INTEGER NOT NULL DEFAULT 0,   -- antaranya datang melalui kod QR (?src=qr)
  items    INTEGER NOT NULL DEFAULT 0,   -- paparan butiran produk
  carts    INTEGER NOT NULL DEFAULT 0,   -- tambah ke troli
  orders   INTEGER NOT NULL DEFAULT 0,   -- tekan "Hantar ke WhatsApp"
  PRIMARY KEY (shop_id, day)
);
CREATE TABLE IF NOT EXISTS stats_product (
  shop_id    TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  day        TEXT NOT NULL,
  views      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, product_id, day)
);
-- Piksel iklan (Pro): ID sahaja, bukan kod. Skrip dijana oleh sistem.
ALTER TABLE shops ADD COLUMN meta_pixel TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN tiktok_pixel TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN google_tag TEXT NOT NULL DEFAULT '';
