// PATCH /api/admin/payments/:id  { shopId, months? }
// Padankan bayaran "unmatched" (e-mel pembayar tiada kedai) dengan kedai yang betul dan tambah bulan Pro.

import { fail, json, readJson } from '../../../../lib/http.js';
import { audit, getShopForAdmin, paymentToApi } from '../../../../lib/admin.js';
import { extendExpiry, monthsFor } from '../../../../lib/subscription.js';
import { CATALOG_FAIL, publishSnapshot } from '../../../../lib/catalog.js';

export async function onRequestPatch({ request, env, data, params }) {
  const parsed = await readJson(request);
  if (parsed.error) return fail(400, 'badan-tidak-sah', 'Format permintaan tidak sah.');
  const db = env.DB;
  const payment = await db.prepare('SELECT * FROM payments WHERE id = ?1').bind(String(params.id)).first();
  if (!payment) return fail(404, 'bayaran-tiada', 'Bayaran tak dijumpai.');
  if (payment.status !== 'unmatched') return fail(409, 'bukan-unmatched', 'Hanya bayaran yang belum dipadankan boleh dipadankan.');

  const shop = await getShopForAdmin(db, parsed.value.shopId);
  if (!shop) return fail(404, 'kedai-tiada', 'Kedai tak dijumpai.');
  const months = parsed.value.months ?? monthsFor(payment.period, payment.quantity);
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    return fail(400, 'bulan-tak-sah', 'Bilangan bulan tak dapat ditentukan daripada bayaran ini. Nyatakan bilangan bulan.');
  }
  const next = extendExpiry(shop, months, env);
  const planCode = shop.plan_code === 'free' ? 'pro' : shop.plan_code;

  // Kemas kini kedai hanya jika bayaran benar-benar bertukar status dalam batch yang sama (elak dipadankan dua kali).
  await db.batch([
    db
      .prepare("UPDATE payments SET status = 'applied', shop_id = ?1, months_added = ?2 WHERE id = ?3 AND status = 'unmatched'")
      .bind(shop.id, months, payment.id),
    db
      .prepare(
        `UPDATE shops SET plan_code = ?1, plan_expires_at = ?2, plan_anchor_day = ?3, updated_at = datetime('now')
         WHERE id = ?4 AND EXISTS (SELECT 1 FROM payments WHERE id = ?5 AND status = 'applied' AND shop_id = ?4 AND months_added = ?6)`,
      )
      .bind(planCode, next.expiresAt, next.anchorDay, shop.id, payment.id, months),
  ]);
  await audit(db, data.user.email, 'match_payment', shop.id, { orderNo: payment.order_no, months, planExpiresAt: next.expiresAt });
  if (!(await publishSnapshot(env, shop.id))) return fail(500, CATALOG_FAIL.code, CATALOG_FAIL.message);

  const fresh = await db.prepare('SELECT p.*, s.slug AS shop_slug FROM payments p LEFT JOIN shops s ON s.id = p.shop_id WHERE p.id = ?1').bind(payment.id).first();
  return json({ ok: true, payment: paymentToApi(fresh), planExpiresAt: next.expiresAt });
}
