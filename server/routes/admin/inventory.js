import { Router } from 'express';
import { all, get, run } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { int, str } from '../../lib/validate.js';
import { replenishStock, combinationFulfilment } from '../../services/orders.js';
import { checkLowStock } from '../../lib/notifications.js';
import { sendXlsx } from '../../lib/xlsx.js';

export const inventoryRouter = Router();

/** INV-01: available / on the way / delivered per combination + product totals. */
inventoryRouter.get('/', (req, res) => {
  const rows = all(
    `SELECT c.*, p.name AS product_name, p.item_code, p.status AS product_status
       FROM combinations c JOIN products p ON p.id = c.product_id
      ORDER BY p.name, c.size_ml, c.color, c.scent`);
  const enriched = rows.map((r) => ({ ...r, ...combinationFulfilment(r.id) }));
  const totals = {
    available_units: enriched.reduce((s, r) => s + r.stock_qty, 0),
    on_the_way_units: enriched.reduce((s, r) => s + r.on_the_way, 0),
    delivered_units: enriched.reduce((s, r) => s + r.delivered, 0),
  };
  res.json({ items: enriched, totals });
});

/** REP-02 drill-down: breakdown that reconciles with an inventory total. */
inventoryRouter.get('/breakdown', (req, res) => {
  const rows = all(
    `SELECT c.id AS combination_id, c.sku, c.size_label, c.color, c.scent, c.stock_qty, c.low_stock_threshold,
            c.low_stock_alerted, p.id AS product_id, p.name AS product_name, p.item_code
       FROM combinations c JOIN products p ON p.id = c.product_id
      ORDER BY p.name, c.size_ml, c.color, c.scent`);
  res.json(rows.map((r) => ({ ...r, ...combinationFulfilment(r.combination_id) })));
});

inventoryRouter.post('/:combinationId/replenish', (req, res) => {
  const combinationId = int(req.params.combinationId, 'combinationId', { min: 1 });
  const quantity = int(req.body.quantity, 'quantity', { min: 1, max: 10_000_000 });
  const note = str(req.body.note, 'note', { max: 500 });
  const combo = replenishStock(combinationId, quantity, note, req.adminUser);
  res.json({ ...combo, ...combinationFulfilment(combinationId) });
});

inventoryRouter.put('/:combinationId/threshold', (req, res) => {
  const combinationId = int(req.params.combinationId, 'combinationId', { min: 1 });
  const threshold = int(req.body.threshold, 'threshold', { min: 0, max: 10_000_000 });
  const combo = get('SELECT * FROM combinations WHERE id = ?', combinationId);
  if (!combo) throw new HttpError(404, 'Combination not found');
  run(
    `UPDATE combinations SET low_stock_threshold = ?,
            low_stock_alerted = CASE WHEN stock_qty > ? THEN 0 ELSE low_stock_alerted END
      WHERE id = ?`,
    threshold, threshold, combinationId,
  );
  checkLowStock(combinationId);
  res.json({ ...get('SELECT * FROM combinations WHERE id = ?', combinationId), ...combinationFulfilment(combinationId) });
});

inventoryRouter.get('/export.xlsx', async (req, res, next) => {
  try {
    const rows = all(
      `SELECT c.*, p.name AS product_name, p.item_code
         FROM combinations c JOIN products p ON p.id = c.product_id
        ORDER BY p.name, c.size_ml, c.color, c.scent`);
    const items = rows.map((r) => ({ ...r, ...combinationFulfilment(r.id) }));
    await sendXlsx(res, 'eloria-inventory.xlsx', {
      sheetName: 'Inventory',
      title: 'Eloria — Inventory export',
      columns: [
        { header: 'Product', key: 'product_name', width: 26 },
        { header: 'Item code', key: 'item_code', width: 14 },
        { header: 'SKU', key: 'sku', width: 20 },
        { header: 'Size', key: 'size_label', width: 10 },
        { header: 'Color', key: 'color', width: 14 },
        { header: 'Scent', key: 'scent', width: 12 },
        { header: 'Available qty', key: 'stock_qty', width: 13 },
        { header: 'On the way qty', key: 'on_the_way', width: 13 },
        { header: 'Delivered qty', key: 'delivered', width: 13 },
        { header: 'Low-stock threshold', key: 'low_stock_threshold', width: 17 },
        { header: 'Low-stock alert', key: 'alert', width: 13 },
      ],
      rows: items.map((r) => ({ ...r, alert: r.low_stock_alerted ? 'ARMED' : 'ok' })),
    });
  } catch (err) { next(err); }
});
