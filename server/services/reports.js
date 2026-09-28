import { all, get } from '../lib/db.js';
import { combinationFulfilment } from './orders.js';

/**
 * REP-01 overview metrics.
 * Terminology (REP-03): nothing here is labelled "profit" — we report agreed revenue,
 * collected money, outstanding balances and retained deposits only (see docs/DECISIONS.md).
 */
export function overview() {
  const scalar = (sql, ...params) => get(sql, ...params)?.v ?? 0;

  const pendingOrders = scalar(`SELECT COUNT(*) AS v FROM orders WHERE state = 'pending'`);
  const pendingUnits = scalar(`SELECT COALESCE(SUM(quantity),0) AS v FROM order_lines ol JOIN orders o ON o.id=ol.order_id WHERE o.state='pending'`);

  const outOrders = scalar(`SELECT COUNT(*) AS v FROM orders WHERE state IN ('confirmed','on_the_way','refused')`);
  const outUnits = scalar(`SELECT COALESCE(SUM(quantity),0) AS v FROM order_lines ol JOIN orders o ON o.id=ol.order_id WHERE o.state IN ('confirmed','on_the_way','refused')`);

  const deliveredOrders = scalar(`SELECT COUNT(*) AS v FROM orders WHERE state = 'delivered'`);
  const deliveredUnits = scalar(`SELECT COALESCE(SUM(quantity),0) AS v FROM order_lines ol JOIN orders o ON o.id=ol.order_id WHERE o.state='delivered'`);

  const availableUnits = scalar(`SELECT COALESCE(SUM(stock_qty),0) AS v FROM combinations`);

  const collected = scalar(`SELECT COALESCE(SUM(amount_minor),0) AS v FROM payment_records WHERE type IN ('deposit','balance','full')`);
  const deposits = scalar(`SELECT COALESCE(SUM(amount_minor),0) AS v FROM payment_records WHERE type = 'deposit'`);
  const retainedDeposits = scalar(`SELECT COALESCE(SUM(amount_minor),0) AS v FROM payment_records WHERE type = 'outcome_deposit_retained'`);
  const agreedActive = scalar(`SELECT COALESCE(SUM(agreed_total_minor),0) AS v FROM orders WHERE state NOT IN ('cancelled','pending')`);
  const outstanding = Math.max(0, agreedActive - collected);
  const refundRecorded = scalar(`SELECT COALESCE(SUM(amount_minor),0) AS v FROM payment_records WHERE type = 'outcome_refund'`);

  const revenueByItem = all(
    `SELECT ol.item_code,
            ol.product_name,
            SUM(ol.quantity) AS units,
            COUNT(DISTINCT ol.order_id) AS orders,
            SUM(ol.line_total_minor) AS revenue_minor
       FROM order_lines ol JOIN orders o ON o.id = ol.order_id
      WHERE o.state != 'cancelled'
      GROUP BY ol.item_code, ol.product_name
      ORDER BY revenue_minor DESC`,
  );

  const revenueByCategory = all(
    `SELECT COALESCE(cat.name, 'Uncategorised') AS category,
            SUM(ol.quantity) AS units,
            COUNT(DISTINCT ol.order_id) AS orders,
            SUM(ol.line_total_minor) AS revenue_minor
       FROM order_lines ol
       JOIN orders o ON o.id = ol.order_id
       JOIN combinations c ON c.id = ol.combination_id
       JOIN products p ON p.id = c.product_id
       LEFT JOIN categories cat ON cat.id = p.category_id
      WHERE o.state != 'cancelled'
      GROUP BY cat.name
      ORDER BY revenue_minor DESC`,
  );

  return {
    counts: {
      pending_orders: pendingOrders,
      pending_units: pendingUnits,
      on_the_way_orders: outOrders,
      on_the_way_units: outUnits,
      delivered_orders: deliveredOrders,
      delivered_units: deliveredUnits,
      available_units: availableUnits,
    },
    money: {
      revenue_agreed_minor: agreedActive,
      collected_minor: collected,
      deposits_minor: deposits,
      outstanding_minor: outstanding,
      retained_deposits_minor: retainedDeposits,
      refunds_recorded_minor: refundRecorded,
    },
    revenue_by_item: revenueByItem,
    revenue_by_category: revenueByCategory,
  };
}

/** REP-02 drill-down: exactly which products/combinations make up an inventory total. */
export function inventoryBreakdown() {
  const rows = all(
    `SELECT c.id AS combination_id, c.sku, c.size_label, c.color, c.scent, c.stock_qty,
            c.low_stock_threshold, c.low_stock_alerted, p.id AS product_id, p.name AS product_name, p.item_code
       FROM combinations c JOIN products p ON p.id = c.product_id
      ORDER BY p.name, c.size_label, c.color, c.scent`,
  );
  return rows.map((r) => ({
    ...r,
    ...combinationFulfilment(r.combination_id),
  }));
}
