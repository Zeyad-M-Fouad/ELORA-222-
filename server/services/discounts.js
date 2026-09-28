import { all, get } from '../lib/db.js';
import { percentOfMinor } from '../lib/money.js';

/** Discounts currently in their validity window. */
function activeDiscounts(at = new Date()) {
  const iso = at.toISOString();
  return all(
    `SELECT * FROM discounts
      WHERE active = 1
        AND (starts_at IS NULL OR starts_at <= ?)
        AND (ends_at IS NULL OR ends_at >= ?)`,
    iso, iso,
  ).filter((d) => d.usage_limit == null || d.used_count < d.usage_limit);
}

function discountMatchesScope(discount, line) {
  if (discount.scope === 'all') return true;
  if (discount.scope === 'product') return discount.scope_id === line.product_id;
  if (discount.scope === 'category') return discount.scope_id === line.category_id;
  return false;
}

function amountFor(discount, grossMinor) {
  if (discount.method === 'percent') return percentOfMinor(grossMinor, discount.value);
  return Math.min(discount.value, grossMinor);
}

/**
 * Compute per-line discounts.
 * - Automatic `sale` discounts apply first.
 * - A `promo` discount applies only where no sale applied to the line unless it is stackable.
 * - Fixed-method discounts deduct a fixed amount per matching line (capped at the line total).
 * Returns { lines: [{...line, discount_minor, line_total_minor, applied: [{id, name, code, amount}]}],
 *           items_subtotal_minor, discount_total_minor, applied_discounts }
 */
export function computeLineDiscounts(rawLines, promoCode) {
  const grossTotal = rawLines.reduce((s, l) => s + l.unit_price_minor * l.quantity, 0);
  const eligible = (d) => (d.min_subtotal_minor || 0) <= grossTotal;

  const sales = activeDiscounts().filter((d) => d.type === 'sale' && eligible(d));
  let promo = promoCode
    ? activeDiscounts().find((d) => d.type === 'promo' && d.code === String(promoCode).trim().toUpperCase())
    : undefined;
  let promoError = null;
  if (promo && !eligible(promo)) {
    promoError = {
      message: `This promo code needs a minimum order subtotal of ${(promo.min_subtotal_minor / 100).toFixed(2)}`,
      min_subtotal_minor: promo.min_subtotal_minor,
    };
    promo = undefined;
  }

  let itemsSubtotal = 0;
  let discountTotal = 0;
  const appliedTotals = new Map();

  const lines = rawLines.map((line) => {
    const gross = line.unit_price_minor * line.quantity;
    itemsSubtotal += gross;
    let remaining = gross;
    const applied = [];

    for (const sale of sales) {
      if (!discountMatchesScope(sale, line) || remaining <= 0) continue;
      const amount = Math.min(amountFor(sale, gross), remaining);
      if (amount <= 0) continue;
      remaining -= amount;
      applied.push({ id: sale.id, name: sale.name || 'Sale', code: sale.code, amount });
    }

    if (promo && discountMatchesScope(promo, line) && remaining > 0) {
      const saleApplied = applied.some((a) => sales.some((s) => s.id === a.id));
      if (!saleApplied || promo.stackable) {
        const amount = Math.min(amountFor(promo, gross), remaining);
        if (amount > 0) {
          remaining -= amount;
          applied.push({ id: promo.id, name: promo.name || 'Promo', code: promo.code, amount });
        }
      }
    }

    const discount = gross - remaining;
    discountTotal += discount;
    for (const a of applied) {
      appliedTotals.set(a.id, (appliedTotals.get(a.id) || 0) + a.amount);
    }

    return {
      ...line,
      discount_minor: discount,
      line_total_minor: remaining,
      applied,
    };
  });

  const applied_discounts = [...appliedTotals.entries()].map(([id, amount]) => {
    const d = get('SELECT * FROM discounts WHERE id = ?', id);
    return { id, name: d?.name || 'Discount', code: d?.code, type: d?.type, amount };
  });

  return { lines, items_subtotal_minor: itemsSubtotal, discount_total_minor: discountTotal, applied_discounts, promo, promoError };
}

export function getDiscount(id) {
  return get('SELECT * FROM discounts WHERE id = ?', id);
}
