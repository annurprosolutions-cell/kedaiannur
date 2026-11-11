// Pengiraan tempoh langganan (BSD peraturan 4). Dikongsi oleh panel superadmin (Fasa 7) dan webhook BCL (Fasa 6).
//  - Tambah dari tarikh tamat semasa jika masih berbayar (termasuk toleransi); jika tidak, dari hari ini.
//  - plan_anchor_day dikekalkan: 31 Jan + 1 bulan = 28/29 Feb, dan pembaharuan seterusnya kembali ke 31hb.
//  - Bulan = bulan setiap item kali kuantiti (bulanan = 1, tahunan = 12).

import { planStatus } from './plan.js';

const pad = (n) => String(n).padStart(2, '0');

function daysInMonth(year, month0) {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m - 1);
}

export function monthsFor(period, quantity = 1) {
  const per = period === 'yearly' ? 12 : period === 'monthly' ? 1 : 0;
  const q = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
  return per * q;
}

export function stillPaid(shop, env, now = new Date()) {
  return shop.plan_code !== 'free' && ['active', 'ending', 'grace'].includes(planStatus(shop, env, now).state);
}

/** Pulangkan { expiresAt: 'YYYY-MM-DD', anchorDay } selepas menambah `months` bulan. */
export function extendExpiry(shop, months, env, now = new Date()) {
  if (!Number.isInteger(months) || months < 1) throw new Error('Bilangan bulan tak sah');
  const paid = stillPaid(shop, env, now);
  const base = paid ? shop.plan_expires_at : now.toISOString().slice(0, 10);
  const [y, m, d] = base.split('-').map(Number);
  const anchor = paid && Number.isInteger(shop.plan_anchor_day) && shop.plan_anchor_day >= 1 && shop.plan_anchor_day <= 31 ? shop.plan_anchor_day : d;
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = total % 12;
  const day = Math.min(anchor, daysInMonth(ty, tm));
  return { expiresAt: `${ty}-${pad(tm + 1)}-${pad(day)}`, anchorDay: anchor };
}
