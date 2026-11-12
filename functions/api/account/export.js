// GET /api/account/export: muat turun semua data peniaga dalam JSON (F-15, PDPA).
// Dijana semasa request; tak disimpan dalam bucket (TRD seksyen 6).

import { fail } from '../../../lib/http.js';
import { getBanners, getShopByOwner } from '../../../lib/shop.js';
import { listCategories, listProducts } from '../../../lib/products.js';

export async function onRequestGet({ env, data }) {
  const db = env.DB;
  const user = await db.prepare('SELECT email, name, created_at, last_login_at FROM users WHERE id = ?1').bind(data.user.id).first();
  if (!user) return fail(404, 'tiada', 'Akaun tak dijumpai.');
  const shop = await getShopByOwner(db, data.user.id);
  const media = String(env.MEDIA_BASE_URL || '').replace(/\/+$/, '');
  const url = (k) => (k && media ? `${media}/${k}` : null);

  let body = { format: 'kedai-annurpro-eksport', versi: 1, dieksport: new Date().toISOString(), akaun: user, kedai: null };
  if (shop) {
    const [banners, categories, products, payments] = await Promise.all([
      getBanners(db, shop.id),
      listCategories(db, shop.id),
      listProducts(db, shop.id),
      db.prepare('SELECT order_no, amount_sen, period, quantity, months_added, status, created_at FROM payments WHERE shop_id = ?1 ORDER BY created_at').bind(shop.id).all(),
    ]);
    body.kedai = {
      slug: shop.slug,
      nama: shop.name,
      penerangan: shop.description,
      whatsapp: shop.whatsapp,
      warna_tema: shop.theme_color,
      buka: shop.is_open === 1,
      minta_nama: shop.ask_name === 1,
      minta_alamat: shop.ask_address === 1,
      templat_mesej: shop.message_template,
      pelan: shop.plan_code,
      pelan_tamat: shop.plan_expires_at,
      status: shop.status,
      dicipta: shop.created_at,
      logo: url(shop.logo_key),
      waktu_operasi: shop.opening_hours || '',
      google_maps: shop.maps_url || '',
      instagram: shop.instagram || '',
      tiktok: shop.tiktok || '',
      facebook: shop.facebook || '',
      banner: banners.map((b) => ({ kunci: b.image_key, url: url(b.image_key), saiz: b.bytes })),
      kategori: categories.map((c) => ({ id: c.id, nama: c.name, susunan: c.sort_order })),
      produk: products.map((p) => ({
        id: p.id,
        kategori_id: p.category_id,
        nama: p.name,
        penerangan: p.description,
        harga_sen: p.price_sen,
        tersedia: p.is_available === 1,
        susunan: p.sort_order,
        gambar: url(p.image_key),
        thumbnail: url(p.thumb_key),
      })),
      bayaran: payments.results,
    };
  }
  const date = new Date().toISOString().slice(0, 10);
  const name = `kedai-${shop ? shop.slug : 'akaun'}-${date}.json`;
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
