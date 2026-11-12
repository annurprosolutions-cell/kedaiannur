-- 0004: maklumat hubungan kedai (semua pelan): waktu operasi, pautan Google Maps, Instagram, TikTok, Facebook.
-- Jalankan sekali dalam Cloudflare D1 Console (kedai-db) SEBELUM deploy kod yang menggunakannya.
ALTER TABLE shops ADD COLUMN opening_hours TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN maps_url TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN instagram TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN tiktok TEXT NOT NULL DEFAULT '';
ALTER TABLE shops ADD COLUMN facebook TEXT NOT NULL DEFAULT '';
