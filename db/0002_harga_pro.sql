-- 0002: harga Pro baharu RM20 sebulan, RM200 setahun (11/11/2026).
-- Jalankan sekali dalam Cloudflare D1 Console (kedai-db). Bayaran yang sudah direkod tak terjejas.
UPDATE plans SET price_month_sen = 2000, price_year_sen = 20000 WHERE code = 'pro';
SELECT code, price_month_sen, price_year_sen FROM plans;
