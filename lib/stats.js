// Statistik pelawat tanpa nama (Pusingan 3). Kiraan harian sahaja: tiada IP, kuki, ID pelawat atau data peribadi.
// Pelayar menghantar satu kumpulan acara setiap lawatan (POST /api/track/:slug) dan server menambah kiraan.
// Had: Percuma nampak 7 hari, Pro 90 hari; data disimpan RETAIN_DAYS hari.

export const FREE_DAYS = 7;
export const PRO_DAYS = 90;
export const RETAIN_DAYS = 120;
// Had setiap permintaan supaya satu pelawat tak boleh menaikkan angka dengan banyak sekali gus.
const MAX = { items: 30, carts: 30, orders: 5, productIds: 30 };
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|headless|lighthouse|pagespeed/i;

/** Tarikh hari ini waktu Malaysia (UTC+8), atau n hari sebelumnya. */
export function mytDay(offsetDays = 0, now = Date.now()) {
  return new Date(now + 8 * 3600e3 - offsetDays * 86400e3).toISOString().slice(0, 10);
}

const int = (v, max) => {
  const n = Number.isInteger(v) ? v : 0;
  return Math.max(0, Math.min(max, n));
};

/** Sahkan dan hadkan badan acara. Pulangkan null jika tiada apa untuk dikira. */
export function cleanEvents(body) {
  if (!body || typeof body !== 'object') return null;
  const ev = {
    view: body.view === true ? 1 : 0,
    qr: body.view === true && body.src === 'qr' ? 1 : 0,
    items: int(body.items, MAX.items),
    carts: int(body.carts, MAX.carts),
    orders: int(body.orders, MAX.orders),
    products: [...new Set(Array.isArray(body.products) ? body.products.filter((p) => typeof p === 'string' && /^[\w-]{1,64}$/.test(p)) : [])].slice(0, MAX.productIds),
  };
  return ev.view || ev.items || ev.carts || ev.orders || ev.products.length ? ev : null;
}

export function isBot(userAgent) {
  return !userAgent || BOT.test(userAgent);
}

/** Tambah kiraan dalam satu batch. productIds disemak terhadap kedai sendiri supaya tiada ID palsu disimpan. */
export async function recordEvents(db, shopId, ev, now = Date.now()) {
  const day = mytDay(0, now);
  const statements = [
    db
      .prepare(
        `INSERT INTO stats_daily (shop_id, day, views, qr, items, carts, orders) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (shop_id, day) DO UPDATE SET views = views + ?3, qr = qr + ?4, items = items + ?5, carts = carts + ?6, orders = orders + ?7`,
      )
      .bind(shopId, day, ev.view, ev.qr, ev.items, ev.carts, ev.orders),
  ];
  for (const pid of ev.products) {
    statements.push(
      db
        .prepare(
          `INSERT INTO stats_product (shop_id, product_id, day, views)
           SELECT ?1, ?2, ?3, 1 WHERE EXISTS (SELECT 1 FROM products WHERE id = ?2 AND shop_id = ?1)
           ON CONFLICT (shop_id, product_id, day) DO UPDATE SET views = views + 1`,
        )
        .bind(shopId, pid, day),
    );
  }
  await db.batch(statements);
}

/** Siri harian dan ringkasan untuk dashboard peniaga. */
export async function shopStats(db, shopId, days, { withProducts }) {
  const since = mytDay(days - 1);
  const [rows, top] = await Promise.all([
    db.prepare('SELECT day, views, qr, items, carts, orders FROM stats_daily WHERE shop_id = ?1 AND day >= ?2').bind(shopId, since).all(),
    withProducts
      ? db
          .prepare(
            `SELECT sp.product_id AS id, p.name, sum(sp.views) AS views FROM stats_product sp
             JOIN products p ON p.id = sp.product_id AND p.shop_id = sp.shop_id
             WHERE sp.shop_id = ?1 AND sp.day >= ?2 GROUP BY sp.product_id ORDER BY views DESC, p.name LIMIT 10`,
          )
          .bind(shopId, since)
          .all()
      : Promise.resolve({ results: [] }),
  ]);
  const byDay = Object.fromEntries(rows.results.map((r) => [r.day, r]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = mytDay(i);
    const r = byDay[d] || {};
    series.push({ date: d, views: r.views || 0, qr: r.qr || 0, items: r.items || 0, carts: r.carts || 0, orders: r.orders || 0 });
  }
  const sum = (k) => series.reduce((a, x) => a + x[k], 0);
  const totals = { views: sum('views'), qr: sum('qr'), items: sum('items'), carts: sum('carts'), orders: sum('orders') };
  totals.orderRatePct = totals.views ? Math.round((totals.orders / totals.views) * 1000) / 10 : 0;
  return { days, series, totals, topProducts: top.results };
}

/** Buang data lama (dipanggil sesekali di latar). */
export async function pruneStats(db) {
  const cutoff = mytDay(RETAIN_DAYS);
  await db.batch([
    db.prepare('DELETE FROM stats_daily WHERE day < ?1').bind(cutoff),
    db.prepare('DELETE FROM stats_product WHERE day < ?1').bind(cutoff),
  ]);
}
