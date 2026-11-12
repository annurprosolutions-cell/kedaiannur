// /api/admin/shops/:id (S-17)
//   GET    butiran kedai, pemilik, penggunaan, bayaran, audit log
//   PATCH  { action: 'set_plan', planCode, expiresAt } | { action: 'add_months', months }
//          | { action: 'suspend', reason } | { action: 'unsuspend' }
//          | { action: 'market_hide' | 'market_show' | 'market_feature' | 'market_unfeature' }

import { fail, json, readJson } from '../../../../lib/http.js';
import { audit, getShopForAdmin, paymentToApi, shopRow } from '../../../../lib/admin.js';
import { extendExpiry, isIsoDate } from '../../../../lib/subscription.js';
import { CATALOG_FAIL, publishSnapshot } from '../../../../lib/catalog.js';
import { cleanText } from '../../../../public/assets/js/rules.js';
import { buildMarketIndex, marketStatusFor } from '../../../../lib/market.js';
import { effectivePlanCode } from '../../../../lib/plan.js';

const MARKET_ACTIONS = {
  market_hide: ['market_hidden', 1],
  market_show: ['market_hidden', 0],
  market_feature: ['market_featured', 1],
  market_unfeature: ['market_featured', 0],
};

const notFound = () => fail(404, 'kedai-tiada', 'Kedai tak dijumpai.');

async function detail(env, id) {
  const s = await getShopForAdmin(env.DB, id);
  if (!s) return null;
  const [payments, log] = await Promise.all([
    env.DB.prepare('SELECT * FROM payments WHERE shop_id = ?1 ORDER BY created_at DESC LIMIT 50').bind(id).all(),
    env.DB.prepare('SELECT * FROM audit_log WHERE shop_id = ?1 ORDER BY id DESC LIMIT 50').bind(id).all(),
  ]);
  return {
    ok: true,
    shop: {
      ...shopRow(s, env),
      whatsapp: s.whatsapp,
      description: s.description,
      isOpen: s.is_open === 1,
      suspendedReason: s.suspended_reason,
      planAnchorDay: s.plan_anchor_day,
      storageBytes: s.storage_bytes,
      slugChanges: s.slug_changes,
      categories: s.categories,
      banners: s.banners,
      ownerName: s.owner_name,
      ownerLastLogin: s.owner_last_login,
      updatedAt: s.updated_at,
      category: s.category || '',
      market: await marketStatusFor(env, s, effectivePlanCode(s, env) !== 'free'),
    },
    payments: payments.results.map(paymentToApi),
    audit: log.results.map((a) => ({ id: a.id, actor: a.actor_email, action: a.action, meta: a.meta ? JSON.parse(a.meta) : null, createdAt: a.created_at })),
  };
}

export async function onRequestGet({ env, params }) {
  const body = await detail(env, params.id);
  return body ? json(body) : notFound();
}

export async function onRequestPatch({ request, env, data, params }) {
  const parsed = await readJson(request);
  if (parsed.error) return fail(400, 'badan-tidak-sah', 'Format permintaan tidak sah.');
  const body = parsed.value;
  const shop = await getShopForAdmin(env.DB, params.id);
  if (!shop) return notFound();
  const db = env.DB;
  const actor = data.user.email;
  const before = { planCode: shop.plan_code, planExpiresAt: shop.plan_expires_at, status: shop.status };

  switch (body.action) {
    case 'set_plan': {
      const plan = await db.prepare('SELECT code FROM plans WHERE code = ?1').bind(String(body.planCode || '')).first();
      if (!plan) return fail(400, 'pelan-tak-sah', 'Pelan tak wujud.');
      let expires = null;
      let anchor = null;
      if (plan.code !== 'free') {
        if (!isIsoDate(body.expiresAt)) return fail(400, 'tarikh-tak-sah', 'Tarikh tamat diperlukan (YYYY-MM-DD) untuk pelan berbayar.');
        expires = body.expiresAt;
        anchor = Number(expires.slice(8, 10));
      }
      await db
        .prepare("UPDATE shops SET plan_code = ?1, plan_expires_at = ?2, plan_anchor_day = ?3, updated_at = datetime('now') WHERE id = ?4")
        .bind(plan.code, expires, anchor, shop.id)
        .run();
      await audit(db, actor, 'set_plan', shop.id, { before, after: { planCode: plan.code, planExpiresAt: expires } });
      break;
    }
    case 'add_months': {
      const months = body.months;
      if (!Number.isInteger(months) || months < 1 || months > 120) return fail(400, 'bulan-tak-sah', 'Bilangan bulan mesti 1 hingga 120.');
      const next = extendExpiry(shop, months, env);
      const planCode = shop.plan_code === 'free' ? 'pro' : shop.plan_code;
      await db
        .prepare("UPDATE shops SET plan_code = ?1, plan_expires_at = ?2, plan_anchor_day = ?3, updated_at = datetime('now') WHERE id = ?4")
        .bind(planCode, next.expiresAt, next.anchorDay, shop.id)
        .run();
      await audit(db, actor, 'add_months', shop.id, { months, before, after: { planCode, planExpiresAt: next.expiresAt } });
      break;
    }
    case 'suspend': {
      const reason = cleanText(body.reason ?? '');
      if (reason.length < 3 || reason.length > 200) return fail(400, 'sebab-diperlukan', 'Nyatakan sebab gantung (3 hingga 200 aksara).');
      await db
        .prepare("UPDATE shops SET status = 'suspended', suspended_reason = ?1, updated_at = datetime('now') WHERE id = ?2")
        .bind(reason, shop.id)
        .run();
      await audit(db, actor, 'suspend', shop.id, { reason });
      break;
    }
    case 'unsuspend': {
      await db.prepare("UPDATE shops SET status = 'active', suspended_reason = NULL, updated_at = datetime('now') WHERE id = ?1").bind(shop.id).run();
      await audit(db, actor, 'unsuspend', shop.id, { previousReason: shop.suspended_reason });
      break;
    }
    case 'market_hide':
    case 'market_show':
    case 'market_feature':
    case 'market_unfeature': {
      const [col, val] = MARKET_ACTIONS[body.action];
      await db.prepare(`UPDATE shops SET ${col} = ?1 WHERE id = ?2`).bind(val, shop.id).run();
      await audit(db, actor, body.action, shop.id, {});
      await buildMarketIndex(env);
      return json(await detail(env, shop.id));
    }
    default:
      return fail(400, 'tindakan-tak-sah', 'Tindakan tak dikenali.');
  }

  // Pelan atau status berubah: katalog awam ikut serta (had pelan baharu, atau dipadam bila digantung).
  if (!(await publishSnapshot(env, shop.id))) return fail(500, CATALOG_FAIL.code, CATALOG_FAIL.message);
  return json(await detail(env, shop.id));
}
