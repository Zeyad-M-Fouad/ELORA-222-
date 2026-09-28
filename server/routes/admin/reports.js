import { Router } from 'express';
import { all } from '../../lib/db.js';
import { overview, inventoryBreakdown } from '../../services/reports.js';
import { combinationFulfilment } from '../../services/orders.js';
import { sendXlsx } from '../../lib/xlsx.js';
import { formatMoney } from '../../lib/money.js';
import { getSetting } from '../../services/settings.js';

export const reportsRouter = Router();

reportsRouter.get('/overview', (req, res) => {
  res.json(overview());
});

/** REP-02: every total opens into the underlying records. */
reportsRouter.get('/breakdown/available-units', (req, res) => {
  res.json(inventoryBreakdown());
});

reportsRouter.get('/breakdown/on-the-way', (req, res) => {
  const rows = all(
    `SELECT o.id AS order_id, o.order_code, o.state, o.created_at, ol.product_name, ol.size_label,
            ol.color, ol.scent, ol.quantity
       FROM order_lines ol JOIN orders o ON o.id = ol.order_id
      WHERE o.state IN ('confirmed','on_the_way','refused')
      ORDER BY o.created_at DESC`);
  res.json(rows);
});

reportsRouter.get('/breakdown/delivered-units', (req, res) => {
  const rows = all(
    `SELECT o.id AS order_id, o.order_code, o.state, o.delivered_at, ol.product_name, ol.size_label,
            ol.color, ol.scent, ol.quantity
       FROM order_lines ol JOIN orders o ON o.id = ol.order_id
      WHERE o.state = 'delivered'
      ORDER BY o.delivered_at DESC`);
  res.json(rows);
});

reportsRouter.get('/export.xlsx', async (req, res, next) => {
  try {
    const data = overview();
    const currency = getSetting('currency', 'EGP');
    await sendXlsx(res, 'eloria-overview.xlsx', {
      sheetName: 'Overview',
      title: 'Eloria — Overview report (agreed revenue and collected money; not profit)',
      columns: [
        { header: 'Item code', key: 'item_code', width: 14 },
        { header: 'Product', key: 'product_name', width: 28 },
        { header: 'Units (excl. cancelled)', key: 'units', width: 16 },
        { header: 'Orders (excl. cancelled)', key: 'orders', width: 16 },
        { header: `Revenue (agreed, ${currency})`, key: 'revenue', width: 18 },
      ],
      rows: data.revenue_by_item.map((r) => ({ ...r, revenue: formatMoney(r.revenue_minor, '') })),
    });
  } catch (err) { next(err); }
});

reportsRouter.get('/inventory-export.xlsx', async (req, res, next) => {
  try {
    const rows = inventoryBreakdown();
    await sendXlsx(res, 'eloria-inventory-breakdown.xlsx', {
      sheetName: 'Inventory breakdown',
      title: 'Eloria — Inventory breakdown (reconciles with totals)',
      columns: [
        { header: 'Product', key: 'product_name', width: 26 },
        { header: 'Item code', key: 'item_code', width: 14 },
        { header: 'SKU', key: 'sku', width: 20 },
        { header: 'Size', key: 'size_label', width: 10 },
        { header: 'Color', key: 'color', width: 13 },
        { header: 'Scent', key: 'scent', width: 12 },
        { header: 'Available', key: 'stock_qty', width: 11 },
        { header: 'On the way', key: 'on_the_way', width: 11 },
        { header: 'Delivered', key: 'delivered', width: 11 },
      ],
      rows,
    });
  } catch (err) { next(err); }
});
