// POST /api/admin/shops/:id/remind: rekod bahawa superadmin menghantar peringatan tamat langganan melalui WhatsApp.
// Mesej sendiri dibuka di peranti admin (wa.me); server hanya merekod dalam audit_log supaya tak diulang tanpa sedar.

import { fail, json } from '../../../../../lib/http.js';
import { audit, getShopForAdmin } from '../../../../../lib/admin.js';

export async function onRequestPost({ env, data, params }) {
  const shop = await getShopForAdmin(env.DB, params.id);
  if (!shop) return fail(404, 'kedai-tiada', 'Kedai tak dijumpai.');
  await audit(env.DB, data.user.email, 'remind', shop.id, { planExpiresAt: shop.plan_expires_at });
  return json({ ok: true });
}
