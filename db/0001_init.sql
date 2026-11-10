-- Kedai AnnurPro: 0001_init.sql
-- Selamat dijalankan berulang kali (idempotent): tidak memadam data sedia ada.
-- Cara guna: Cloudflare dashboard > D1 > pilih database > Console > tampal dan Run.
-- Jika console menolak banyak statement sekali gus, jalankan satu blok pada satu masa.

-- 1. Pelan (had dan harga boleh diubah di sini tanpa ubah kod) --------------
CREATE TABLE IF NOT EXISTS plans (
  code               TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  max_products       INTEGER NOT NULL,
  max_categories     INTEGER NOT NULL,
  max_banners        INTEGER NOT NULL,
  max_storage_bytes  INTEGER NOT NULL,
  custom_template    INTEGER NOT NULL DEFAULT 0,
  hide_branding      INTEGER NOT NULL DEFAULT 0,
  price_month_sen    INTEGER NOT NULL DEFAULT 0,
  price_year_sen     INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO plans
  (code, name, max_products, max_categories, max_banners, max_storage_bytes, custom_template, hide_branding, price_month_sen, price_year_sen)
VALUES
  ('free', 'Percuma',  20,  5, 1,  10485760, 0, 0,    0,     0),
  ('pro',  'Pro',     500, 50, 5, 157286400, 1, 1, 2900, 29000);

-- 2. Pengguna dan sesi -------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  google_sub    TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

-- 3. Kedai -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shops (
  id               TEXT PRIMARY KEY,
  owner_user_id    TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  slug             TEXT NOT NULL UNIQUE COLLATE NOCASE
                   CHECK (length(slug) BETWEEN 3 AND 30
                          AND slug NOT GLOB '*[^a-z0-9-]*'
                          AND slug NOT GLOB '-*'
                          AND slug NOT GLOB '*-'),
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  description      TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  whatsapp         TEXT NOT NULL
                   CHECK (whatsapp NOT GLOB '*[^0-9]*' AND length(whatsapp) BETWEEN 9 AND 15),
  theme_color      TEXT NOT NULL DEFAULT '#0F766E',
  is_open          INTEGER NOT NULL DEFAULT 1,
  ask_name         INTEGER NOT NULL DEFAULT 1,
  ask_address      INTEGER NOT NULL DEFAULT 0,
  message_template TEXT CHECK (message_template IS NULL OR length(message_template) <= 800),
  plan_code        TEXT NOT NULL DEFAULT 'free' REFERENCES plans(code),
  plan_expires_at  TEXT,                      -- YYYY-MM-DD, kosong untuk Percuma
  plan_anchor_day  INTEGER,                   -- hari dalam bulan untuk kiraan bulan
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  suspended_reason TEXT,
  storage_bytes    INTEGER NOT NULL DEFAULT 0,
  slug_changes     INTEGER NOT NULL DEFAULT 0,
  catalog_dirty    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shop_banners (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  image_key   TEXT NOT NULL,
  bytes       INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- 4. Kategori dan produk -----------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  shop_id     TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  shop_id      TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  category_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description  TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  price_sen    INTEGER CHECK (price_sen IS NULL OR price_sen >= 0),   -- NULL = Hubungi untuk harga
  image_key    TEXT,
  thumb_key    TEXT,
  bytes        INTEGER NOT NULL DEFAULT 0,                            -- saiz gambar besar + thumbnail
  is_available INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5. Bayaran dan audit -------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  order_no      TEXT NOT NULL UNIQUE,         -- idempotency: webhook yang sama tak diproses dua kali
  provider      TEXT NOT NULL DEFAULT 'bcl',
  shop_id       TEXT REFERENCES shops(id) ON DELETE SET NULL,
  payer_email   TEXT,                         -- e-mel Google daripada medan tersuai BCL
  amount_sen    INTEGER NOT NULL,
  period        TEXT CHECK (period IN ('monthly', 'yearly')),
  quantity      INTEGER NOT NULL DEFAULT 1,
  months_added  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL CHECK (status IN ('applied', 'unmatched', 'ignored')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reserved_slugs (
  slug TEXT PRIMARY KEY COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_email  TEXT NOT NULL,
  action       TEXT NOT NULL,                 -- contoh: set_plan, suspend, unsuspend, rename_slug, delete_shop, match_payment
  shop_id      TEXT,
  meta         TEXT,                          -- JSON ringkas
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. Index (setiap index menambah satu "row written" pada setiap tulis; kekalkan sedikit)
CREATE INDEX IF NOT EXISTS idx_sessions_user       ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_banners_shop        ON shop_banners(shop_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_categories_shop     ON categories(shop_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_products_shop       ON products(shop_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_payments_shop       ON payments(shop_id);
CREATE INDEX IF NOT EXISTS idx_payments_unmatched  ON payments(payer_email) WHERE status = 'unmatched';

-- 7. Slug reserved (tak boleh digunakan sebagai nama kedai) -------------------
INSERT OR IGNORE INTO reserved_slugs (slug) VALUES
  ('admin'), ('administrator'), ('app'), ('api'), ('assets'), ('static'), ('media'), ('cdn'),
  ('login'), ('logout'), ('signin'), ('signup'), ('register'), ('daftar'), ('masuk'), ('keluar'),
  ('dashboard'), ('akaun'), ('account'), ('settings'), ('tetapan'), ('billing'), ('langganan'),
  ('harga'), ('pricing'), ('terms'), ('syarat'), ('privacy'), ('privasi'), ('help'), ('bantuan'),
  ('support'), ('sokongan'), ('contact'), ('hubungi'), ('about'), ('blog'), ('docs'), ('status'),
  ('kedai'), ('shop'), ('store'), ('www'), ('mail'), ('annurpro'), ('annur'), ('ruz'), ('ruzprompt'),
  ('demo'), ('test'), ('ujian'), ('root'), ('system'), ('null'), ('undefined'),
  ('qr'), ('q'), ('webhook'), ('webhooks'), ('robots'), ('sitemap'), ('favicon'), ('manifest');
