-- 0003: logo kedai (semua pelan). Pro: logo juga menjadi favicon dan ikon skrin utama halaman kedai.
-- Jalankan sekali dalam Cloudflare D1 Console (kedai-db) SEBELUM deploy kod yang menggunakan logo.
ALTER TABLE shops ADD COLUMN logo_key TEXT;
ALTER TABLE shops ADD COLUMN logo_bytes INTEGER NOT NULL DEFAULT 0;
