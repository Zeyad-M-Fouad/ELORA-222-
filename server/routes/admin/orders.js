import { Router } from 'express';
import { all, get, run, now } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { int, str, enumOf, isoDateOrNull } from '../../lib/validate.js';
import {
  confirmDeposit, markDispatched, markDelivered, recordPayment, recordRefusal,
  cancelOrder, recordReturn, orderLines, ORDER_STATES, PAYMENT_STATES,
} from '../../services/orders.js';
import { sendXlsx } from '../../lib/xlsx.js';
import { formatMoney } from '../../lib/money.js';
import { getSetting } from '../../services/settings.js';

export const ordersRouter = Router();

const DATE_FIELDS = {
  created: { column: 'o.created_at', label: 'request date' },
  payment: { column: `(SELECT MIN(p.created_at) FROM payment_records p WHERE p.order_id = o.id)`, label: 'payment date' },
  delivery: { column: 'o.delivered_at', label: 'delivery date' },
  confirmed: { column: 'o.confirmed_at', label: 'confirmation date' },
};

function applyFilters(query) {
  const where = [];
  const params = [];
  if (query.state) {
    const states = String(query.state).split(',').filter((s) => ORDER_STATES.includes(s));
    if (states.length) {
      where.push(`o.state IN (${states.map(() => '?').join(',')})`);
      params.push(...states);
    }
  }
  if (query.payment_state) {
    const states = String(query.payment_state).split(',').filter((s) => PAYMENT_STATES.includes(s));
    if (states.length) {
      where.push(`o.payment_state IN (${states.map(() => '?').join(',')})`);
      params.push(...states);
    }
  }
  if (query.q) {
    where.push('(o.order_code LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ? OR o.customer_phone LIKE ?)');
    const needle = `%${query.q}%`;
    params.push(needle, needle, needle, needle);
  }
  const dateField = DATE_FIELDS[query.date_field || 'created'] || DATE_FIELDS.created;
  if (query.date_from) {
    where.push(`${dateField.column} >= ?`);
    params.push(isoDateOrNull(query.date_from, 'date_from'));
  }
  if (query.date_to) {
    where.push(`${dateField.column} <= ?`);
    params.push(new Date(new Date(query.date_to).getTime() + 86400_000 - 1).toISOString());
  }
  return { where, params, dateField };
}

ordersRouter.get('/', (req, res) => {
  const { where, params, dateField } = applyFilters(req.query);
  const rows = all(
    `SELECT o.*,
            (SELECT COALESCE(SUM(quantity),0) FROM order_lines ol WHERE ol.order_id = o.id) AS units,
            (SELECT COALESCE(SUM(amount_minor),0) FROM payment_records p WHERE p.order_id = o.id AND p.type IN ('deposit','balance','full')) AS collected_minor
       FROM orders o
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY o.created_at DESC
      LIMIT 500`,
    ...params);
  res.json({
    items: rows,
    date_field: { key: req.query.date_field || 'created', label: dateField.label },
  });
});

ordersRouter.get('/export.xlsx', async (req, res, next) => {
  try {
    const { where, params, dateField } = applyFilters(req.query);
    const rows = all(
      `SELECT o.*, (SELECT COALESCE(SUM(quantity),0) FROM order_lines ol WHERE ol.order_id = o.id) AS units,
              (SELECT COALESCE(SUM(amount_minor),0) FROM payment_records p WHERE p.order_id = o.id AND p.type IN ('deposit','balance','full')) AS collected_minor
         FROM orders o
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY o.created_at DESC`,
      ...params);
    await sendXlsx(res, 'eloria-orders.xlsx', {
      sheetName: 'Orders',
      title: `Eloria — Orders (date filter: ${dateField.label})`,
      columns: [
        { header: 'Order code', key: 'order_code', width: 12 },
        { header: 'Request date (UTC)', key: 'created_at', width: 22 },
        { header: 'State', key: 'state', width: 12 },
        { header: 'Payment state', key: 'payment_state', width: 18 },
        { header: 'Customer', key: 'customer_name', width: 20 },
        { header: 'Email', key: 'customer_email', width: 24 },
        { header: 'Phone / WhatsApp', key: 'customer_phone', width: 18 },
        { header: 'Delivery address', key: 'delivery_address', width: 36 },
        { header: 'Units', key: 'units', width: 8 },
        { header: 'Agreed total', key: 'agreed_total', width: 14 },
        { header: 'Collected', key: 'collected', width: 14 },
        { header: 'Notes', key: 'notes', width: 30 },
      ],
      rows: rows.map((r) => ({
        ...r,
        agreed_total: formatMoney(r.agreed_total_minor, ''),
        collected: formatMoney(r.collected_minor, ''),
      })),
    });
  } catch (err) { next(err); }
});

function orderDetail(id) {
  const order = get('SELECT * FROM orders WHERE id = ?', id);
  if (!order) throw new HttpError(404, 'Order not found');
  const lines = orderLines(id);
  const payments = all('SELECT * FROM payment_records WHERE order_id = ? ORDER BY created_at, id', id);
  const records = all(
    `SELECT cr.* FROM cancellation_returns cr WHERE cr.order_id = ? ORDER BY cr.created_at, cr.id`, id);
  const recordLines = records.length
    ? all(`SELECT * FROM cancellation_return_lines WHERE record_id IN (${records.map(() => '?').join(',')})`,
        ...records.map((r) => r.id))
    : [];
  const collected = payments.filter((p) => ['deposit', 'balance', 'full'].includes(p.type))
    .reduce((s, p) => s + p.amount_minor, 0);
  return {
    ...order,
    lines,
    payments,
    records: records.map((r) => ({ ...r, lines: recordLines.filter((l) => l.record_id === r.id) })),
    collected_minor: collected,
    balance_minor: Math.max(0, order.agreed_total_minor - collected),
  };
}

ordersRouter.get('/:id', (req, res) => {
  res.json(orderDetail(int(req.params.id, 'id', { min: 1 })));
});

ordersRouter.post('/:id/confirm-deposit', (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const idempotencyKey = req.headers['idempotency-key'] || null;
  const result = confirmDeposit(id, req.body, req.adminUser, idempotencyKey);
  res.json(orderDetail(id));
});

ordersRouter.post('/:id/mark-dispatched', (req, res) => {
  markDispatched(int(req.params.id, 'id', { min: 1 }));
  res.json(orderDetail(int(req.params.id, 'id', { min: 1 })));
});

ordersRouter.post('/:id/mark-delivered', (req, res) => {
  markDelivered(int(req.params.id, 'id', { min: 1 }));
  res.json(orderDetail(int(req.params.id, 'id', { min: 1 })));
});

ordersRouter.post('/:id/record-payment', (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const idempotencyKey = req.headers['idempotency-key'] || null;
  recordPayment(id, req.body, req.adminUser, idempotencyKey);
  res.json(orderDetail(id));
});

ordersRouter.post('/:id/record-refusal', (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  recordRefusal(id, req.body, req.adminUser);
  res.json(orderDetail(id));
});

ordersRouter.post('/:id/cancel', (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const idempotencyKey = req.headers['idempotency-key'] || null;
  cancelOrder(id, req.body, req.adminUser, idempotencyKey);
  res.json(orderDetail(id));
});

ordersRouter.post('/:id/return', (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const idempotencyKey = req.headers['idempotency-key'] || null;
  recordReturn(id, req.body, req.adminUser, idempotencyKey);
  res.json(orderDetail(id));
});

ordersRouter.post('/:id/notes', (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const notes = str(req.body.notes, 'notes', { max: 5000 });
  const order = get('SELECT * FROM orders WHERE id = ?', id);
  if (!order) throw new HttpError(404, 'Order not found');
  run('UPDATE orders SET notes = ?, updated_at = ? WHERE id = ?', notes, now(), id);
  res.json(orderDetail(id));
});

/* ---------------- Payment records (all orders) ---------------- */

export const paymentsRouter = Router();

paymentsRouter.get('/', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.order_code) {
    where.push('o.order_code = ?');
    params.push(String(req.query.order_code).trim().toUpperCase());
  }
  if (req.query.type) {
    where.push('p.type = ?');
    params.push(String(req.query.type));
  }
  if (req.query.date_from) {
    where.push('p.created_at >= ?');
    params.push(isoDateOrNull(req.query.date_from, 'date_from'));
  }
  if (req.query.date_to) {
    where.push('p.created_at <= ?');
    params.push(new Date(new Date(req.query.date_to).getTime() + 86400_000 - 1).toISOString());
  }
  const rows = all(
    `SELECT p.*, o.order_code, o.state AS order_state, o.payment_state, o.customer_name
       FROM payment_records p JOIN orders o ON o.id = p.order_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 1000`,
    ...params);
  res.json({ items: rows, date_field: { key: 'payment', label: 'payment date' } });
});

paymentsRouter.get('/export.xlsx', async (req, res, next) => {
  try {
    const where = [];
    const params = [];
    if (req.query.order_code) {
      where.push('o.order_code = ?');
      params.push(String(req.query.order_code).trim().toUpperCase());
    }
    if (req.query.type) {
      where.push('p.type = ?');
      params.push(String(req.query.type));
    }
    if (req.query.date_from) {
      where.push('p.created_at >= ?');
      params.push(isoDateOrNull(req.query.date_from, 'date_from'));
    }
    if (req.query.date_to) {
      where.push('p.created_at <= ?');
      params.push(new Date(new Date(req.query.date_to).getTime() + 86400_000 - 1).toISOString());
    }
    const rows = all(
      `SELECT p.*, o.order_code, o.customer_name, o.state AS order_state, o.payment_state
         FROM payment_records p JOIN orders o ON o.id = p.order_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY p.created_at DESC, p.id DESC`,
      ...params);
    await sendXlsx(res, 'eloria-payments.xlsx', {
      sheetName: 'Payments',
      title: 'Eloria — Payment records (date filter: payment date)',
      columns: [
        { header: 'Date (UTC)', key: 'created_at', width: 22 },
        { header: 'Order code', key: 'order_code', width: 12 },
        { header: 'Customer', key: 'customer_name', width: 20 },
        { header: 'Type', key: 'type', width: 26 },
        { header: 'Amount', key: 'amount', width: 14 },
        { header: 'Order payment state', key: 'payment_state', width: 20 },
        { header: 'Recorded by', key: 'created_by', width: 12 },
        { header: 'Note', key: 'note', width: 40 },
      ],
      rows: rows.map((r) => ({ ...r, amount: formatMoney(r.amount_minor, '') })),
    });
  } catch (err) { next(err); }
});
