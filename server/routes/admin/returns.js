import { Router } from 'express';
import { all } from '../../lib/db.js';
import { isoDateOrNull } from '../../lib/validate.js';
import { sendXlsx } from '../../lib/xlsx.js';

export const returnsRouter = Router();

function applyFilters(query) {
  const where = [];
  const params = [];
  if (query.type && ['cancellation', 'return'].includes(query.type)) {
    where.push('cr.type = ?');
    params.push(query.type);
  }
  if (query.q) {
    where.push('(cr.record_code LIKE ? OR o.order_code LIKE ? OR o.customer_name LIKE ?)');
    const needle = `%${query.q}%`;
    params.push(needle, needle, needle);
  }
  // Date filter is labelled explicitly (creation date of the record).
  if (query.date_from) {
    where.push('cr.created_at >= ?');
    params.push(isoDateOrNull(query.date_from, 'date_from'));
  }
  if (query.date_to) {
    where.push('cr.created_at <= ?');
    params.push(new Date(new Date(query.date_to).getTime() + 86400_000 - 1).toISOString());
  }
  return { where, params };
}

function rowsWithLines(query) {
  const { where, params } = applyFilters(query);
  const rows = all(
    `SELECT cr.*, o.order_code, o.customer_name, o.state AS order_state
       FROM cancellation_returns cr JOIN orders o ON o.id = cr.order_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY cr.created_at DESC, cr.id DESC
      LIMIT 500`,
    ...params);
  const lines = rows.length
    ? all(
      `SELECT crl.*, ol.product_name, ol.size_label, ol.color, ol.scent
         FROM cancellation_return_lines crl JOIN order_lines ol ON ol.id = crl.order_line_id
        WHERE crl.record_id IN (${rows.map(() => '?').join(',')})`,
      ...rows.map((r) => r.id))
    : [];
  return rows.map((r) => ({ ...r, lines: lines.filter((l) => l.record_id === r.id) }));
}

returnsRouter.get('/', (req, res) => {
  res.json({
    items: rowsWithLines(req.query),
    date_field: { key: 'record', label: 'record creation date' },
  });
});

returnsRouter.get('/export.xlsx', async (req, res, next) => {
  try {
    const rows = rowsWithLines(req.query);
    const flat = [];
    for (const r of rows) {
      if (!r.lines.length) {
        flat.push({ ...r, product_name: '', size_label: '', color: '', scent: '', quantity: '' });
      }
      for (const l of r.lines) {
        flat.push({ ...r, ...l });
      }
    }
    await sendXlsx(res, 'eloria-cancellations-returns.xlsx', {
      sheetName: 'Cancellations & Returns',
      title: 'Eloria — Cancellations & Returns (date filter: record creation date)',
      columns: [
        { header: 'Record code', key: 'record_code', width: 12 },
        { header: 'Type', key: 'type', width: 13 },
        { header: 'Date (UTC)', key: 'created_at', width: 22 },
        { header: 'Date received', key: 'date_received', width: 22 },
        { header: 'Order code', key: 'order_code', width: 12 },
        { header: 'Customer', key: 'customer_name', width: 20 },
        { header: 'Product', key: 'product_name', width: 24 },
        { header: 'Size', key: 'size_label', width: 10 },
        { header: 'Color', key: 'color', width: 13 },
        { header: 'Scent', key: 'scent', width: 12 },
        { header: 'Quantity', key: 'quantity', width: 9 },
        { header: 'Outcome', key: 'outcome', width: 28 },
        { header: 'Deposit outcome', key: 'deposit_outcome', width: 28 },
        { header: 'Note', key: 'note', width: 36 },
      ],
      rows: flat,
    });
  } catch (err) { next(err); }
});
