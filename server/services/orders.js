import { all, get, run, tx, now } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { uniqueCode } from '../lib/ids.js';
import { computeLineDiscounts } from './discounts.js';
import { createNotification, checkLowStock, comboOptionsText } from '../lib/notifications.js';
import { parseMoney } from '../lib/money.js';
import { bool, str, email as validateEmail, int, isoDateOrNull, enumOf } from '../lib/validate.js';
import { getSetting } from './settings.js';

export const ORDER_STATES = ['pending', 'confirmed', 'on_the_way', 'delivered', 'refused', 'returned', 'cancelled'];
export const PAYMENT_STATES = ['unpaid', 'deposit_received', 'fully_paid', 'deposit_retained', 'no_payment_received'];

/** States whose units are "out in the fulfilment flow" (counted as on the way). */
const OUT_STATES = ['confirmed', 'on_the_way', 'refused'];

function codeExists(table, column, code) {
  return !!get(`SELECT id FROM ${table} WHERE ${column} = ?`, code);
}

function loadOrderOrThrow(orderId) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) throw new HttpError(404, 'Order not found');
  return order;
}

export function orderLines(orderId) {
  return all('SELECT * FROM order_lines WHERE order_id = ? ORDER BY id', orderId);
}

/** Public-safe order view (no address / contact / money) for the order-code lookup. */
export function publicOrderView(code) {
  const order = get('SELECT * FROM orders WHERE order_code = ?', String(code || '').trim().toUpperCase());
  if (!order) return undefined;
  return {
    order_code: order.order_code,
    state: order.state,
    payment_state: order.payment_state,
    created_at: order.created_at,
    items: orderLines(order.id).map((l) => ({
      product_name: l.product_name,
      item_code: l.item_code,
      size: l.size_label,
      color: l.color,
      scent: l.scent,
      quantity: l.quantity,
    })),
  };
}

/** Build (but do not persist) an order's lines from submitted combination ids + quantities. */
export function buildLines(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new HttpError(400, 'At least one item is required');
  }
  return rawItems.map((item) => {
    const comboId = int(item.combination_id, 'combination_id', { min: 1 });
    const quantity = int(item.quantity, 'quantity', { min: 1, max: 10000 });
    const combo = get(
      `SELECT c.*, p.id AS product_id, p.name AS product_name, p.item_code, p.status AS product_status, p.category_id
         FROM combinations c JOIN products p ON p.id = c.product_id
        WHERE c.id = ?`, comboId);
    if (!combo || combo.product_status !== 'active') {
      throw new HttpError(400, 'One of the selected products is not available');
    }
    if (combo.stock_qty <= 0) {
      throw new HttpError(400, `${combo.product_name} (${comboOptionsText(combo)}) is sold out`);
    }
    return {
      combination_id: combo.id,
      product_id: combo.product_id,
      category_id: combo.category_id,
      product_name: combo.product_name,
      item_code: combo.item_code,
      size_label: combo.size_label,
      color: combo.color,
      scent: combo.scent,
      unit_price_minor: combo.price_minor,
      quantity,
    };
  });
}

/** Server-side order summary (ORD-02) including applicable discounts. */
export function previewOrder(rawItems, promoCode) {
  const lines = buildLines(rawItems);
  const computed = computeLineDiscounts(lines, promoCode);
  const promo = computed.promo;
  if (promoCode && computed.promoError) {
    throw new HttpError(400, computed.promoError.message, { min_subtotal_minor: computed.promoError.min_subtotal_minor });
  }
  if (promoCode && (!promo || promo.type !== 'promo')) {
    throw new HttpError(400, 'This promo code is not valid');
  }
  return {
    lines: computed.lines.map((l) => ({
      combination_id: l.combination_id,
      product_name: l.product_name,
      item_code: l.item_code,
      size: l.size_label,
      color: l.color,
      scent: l.scent,
      quantity: l.quantity,
      unit_price_minor: l.unit_price_minor,
      discount_minor: l.discount_minor,
      line_total_minor: l.line_total_minor,
      applied: l.applied,
    })),
    items_subtotal_minor: computed.items_subtotal_minor,
    discount_total_minor: computed.discount_total_minor,
    discount_breakdown: computed.applied_discounts,
    product_subtotal_minor: computed.items_subtotal_minor - computed.discount_total_minor,
    promo_code: promo ? promo.code : null,
  };
}

/**
 * Submit an order request (ORD-01/03). Creates a pending order — no inventory effect (ORD-04).
 * Idempotent via optional Idempotency-Key: retrying returns the original order.
 */
export function submitOrder(body, idempotencyKey) {
  const customerEmail = validateEmail(body.customer_email, 'customer_email');
  const customerPhone = str(body.customer_phone, 'customer_phone', { required: true, min: 6, max: 40 });
  const deliveryAddress = str(body.delivery_address, 'delivery_address', { required: true, min: 5, max: 1000 });
  const customerName = str(body.customer_name, 'customer_name', { max: 200 });
  const promoCode = body.promo_code ? str(body.promo_code, 'promo_code', { max: 60 }) : '';

  if (idempotencyKey) {
    const existing = get('SELECT * FROM orders WHERE idempotency_key = ?', idempotencyKey);
    if (existing) return { order: existing, reused: true };
  }

  const preview = previewOrder(body.items || body.lines, promoCode);

  const result = tx(() => {
    const ts = now();
    const orderCode = uniqueCode('ELR-', 6, (c) => codeExists('orders', 'order_code', c));
    run(
      `INSERT INTO orders (order_code, idempotency_key, customer_name, customer_email, customer_phone,
                           delivery_address, state, payment_state, items_subtotal_minor, discount_total_minor,
                           shipping_minor, agreed_total_minor, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 'unpaid', ?, ?, 0, ?, '', ?, ?)`,
      orderCode, idempotencyKey || null, customerName, customerEmail, customerPhone,
      deliveryAddress, preview.items_subtotal_minor, preview.discount_total_minor,
      preview.product_subtotal_minor, ts, ts,
    );
    const orderId = get('SELECT last_insert_rowid() AS id').id;

    for (const line of preview.lines) {
      run(
        `INSERT INTO order_lines (order_id, combination_id, product_name, item_code, size_label, color, scent,
                                  unit_price_minor, quantity, discount_minor, line_total_minor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        orderId, line.combination_id, line.product_name, line.item_code, line.size, line.color, line.scent,
        line.unit_price_minor, line.quantity, line.discount_minor, line.line_total_minor,
      );
    }

    if (preview.promo_code) {
      const promo = preview.discount_breakdown.find((d) => d.code === preview.promo_code);
      const discountRow = get(`SELECT * FROM discounts WHERE type = 'promo' AND code = ?`, preview.promo_code);
      if (discountRow) {
        run('UPDATE discounts SET used_count = used_count + 1 WHERE id = ?', discountRow.id);
        run('INSERT INTO discount_redemptions (discount_id, order_id, amount_minor, created_at) VALUES (?, ?, ?, ?)',
          discountRow.id, orderId, promo?.amount || 0, ts);
      }
    }

    const summaryLines = preview.lines
      .map((l) => `- ${l.product_name} [${l.size}${l.color ? ' / ' + l.color : ''}${l.scent ? ' / ' + l.scent : ''}] x${l.quantity}`)
      .join('\n');
    const businessEmail = getSetting('business_email');
    createNotification({
      type: 'order_submitted',
      title: `New order request ${orderCode}`,
      body: [
        `Order ${orderCode} was submitted.`,
        '',
        'Items:',
        summaryLines,
        '',
        `Customer: ${customerName || '(not provided)'}`,
        `Email: ${customerEmail}`,
        `Phone / WhatsApp: ${customerPhone}`,
        `Delivery address: ${deliveryAddress}`,
      ].join('\n'),
      relatedType: 'order',
      relatedId: orderId,
      emailTo: businessEmail,
    });

    return { order: loadOrderOrThrow(orderId), reused: false };
  });

  return result;
}

/**
 * Confirm deposit (INV-03): stock check + deduction + payment record as ONE atomic operation.
 * Blocks when stock is insufficient, identifying the affected combination and quantity.
 */
export function confirmDeposit(orderId, body, adminUser, idempotencyKey) {
  const agreedTotal = parseMoney(body.agreed_total);
  const depositAmount = parseMoney(body.deposit_amount);
  const shippingMinor = body.shipping_total != null ? parseMoney(body.shipping_total) : 0;
  const notes = str(body.notes, 'notes', { max: 5000 });
  const dispatchNow = bool(body.dispatch_now);

  if (agreedTotal < 0 || depositAmount < 0 || shippingMinor < 0) throw new HttpError(400, 'Amounts cannot be negative');

  const outcome = tx(() => {
    const order = loadOrderOrThrow(orderId);
    if (idempotencyKey) {
      const existing = get('SELECT * FROM payment_records WHERE idempotency_key = ?', idempotencyKey);
      if (existing) return { order: loadOrderOrThrow(orderId), reused: true };
    }
    if (order.state !== 'pending') {
      throw new HttpError(409, `Order is already ${order.state} — confirmation was not repeated`);
    }

    const lines = orderLines(orderId);
    const insufficient = [];
    for (const line of lines) {
      const combo = get('SELECT * FROM combinations WHERE id = ?', line.combination_id);
      if (!combo || combo.stock_qty < line.quantity) {
        insufficient.push({
          combination_id: line.combination_id,
          product_name: line.product_name,
          options: comboOptionsText({ ...line, size_label: line.size_label }),
          sku: combo?.sku,
          requested: line.quantity,
          available: combo ? combo.stock_qty : 0,
        });
      }
    }
    if (insufficient.length) {
      throw new HttpError(409, 'Insufficient stock — confirmation blocked', { insufficient });
    }

    const ts = now();
    for (const line of lines) {
      const combo = get('SELECT * FROM combinations WHERE id = ?', line.combination_id);
      const after = combo.stock_qty - line.quantity;
      run('UPDATE combinations SET stock_qty = ? WHERE id = ?', after, combo.id);
      run(
        `INSERT INTO inventory_movements (combination_id, delta, reason, order_id, qty_after, note, created_at)
         VALUES (?, ?, 'deposit_confirmed_deduction', ?, ?, ?, ?)`,
        combo.id, -line.quantity, orderId, after, `Order ${order.order_code}`, ts,
      );
    }

    const paymentState = depositAmount >= agreedTotal && agreedTotal > 0 ? 'fully_paid' : 'deposit_received';
    const newState = dispatchNow ? 'on_the_way' : 'confirmed';
    run(
      `UPDATE orders SET state = ?, payment_state = ?, agreed_total_minor = ?, shipping_minor = ?,
                         notes = CASE WHEN ? != '' THEN ? ELSE notes END,
                         confirmed_at = ?, dispatched_at = ?, updated_at = ?
        WHERE id = ?`,
      newState, paymentState, agreedTotal, shippingMinor,
      notes, notes, ts, dispatchNow ? ts : null, ts, orderId,
    );

    run(
      `INSERT INTO payment_records (order_id, idempotency_key, type, amount_minor, note, created_at, created_by)
       VALUES (?, ?, 'deposit', ?, ?, ?, ?)`,
      orderId, idempotencyKey || null, depositAmount,
      notes ? `Deposit confirmed. ${notes}` : 'Deposit confirmed.', ts, adminUser.username,
    );

    for (const line of lines) {
      const combo = get('SELECT id FROM combinations WHERE id = ?', line.combination_id);
      checkLowStock(combo.id);
    }

    createNotification({
      type: 'deposit_confirmed',
      title: `Deposit confirmed for ${order.order_code}`,
      body: `Order ${order.order_code} is now ${newState === 'on_the_way' ? 'on the way' : 'confirmed (awaiting dispatch)'}. Stock has been deducted.`,
      relatedType: 'order',
      relatedId: orderId,
      emailTo: getSetting('business_email'),
    });

    return { order: loadOrderOrThrow(orderId), reused: false };
  });

  return outcome;
}

function transitionGuard(order, allowed, action) {
  if (!allowed.includes(order.state)) {
    throw new HttpError(409, `Cannot ${action} an order in state "${order.state}"`);
  }
}

export function markDispatched(orderId) {
  return tx(() => {
    const order = loadOrderOrThrow(orderId);
    transitionGuard(order, ['confirmed'], 'mark as dispatched');
    run(`UPDATE orders SET state = 'on_the_way', dispatched_at = ?, updated_at = ? WHERE id = ?`,
      now(), now(), orderId);
    return loadOrderOrThrow(orderId);
  });
}

/** Delivery must NOT change stock again and must NOT mark the order fully paid (AC-09). */
export function markDelivered(orderId) {
  return tx(() => {
    const order = loadOrderOrThrow(orderId);
    transitionGuard(order, ['on_the_way', 'confirmed'], 'mark as delivered');
    run(`UPDATE orders SET state = 'delivered', delivered_at = ?, updated_at = ? WHERE id = ?`,
      now(), now(), orderId);
    return loadOrderOrThrow(orderId);
  });
}

/** Record a payment event (PAY-01): deposit, balance, or full. Reconciles to fully_paid. */
export function recordPayment(orderId, body, adminUser, idempotencyKey) {
  const type = enumOf(body.type, 'type', ['deposit', 'balance', 'full']);
  const amount = parseMoney(body.amount);
  const note = str(body.note, 'note', { max: 5000 });
  if (amount < 0) throw new HttpError(400, 'Amount cannot be negative');

  return tx(() => {
    const order = loadOrderOrThrow(orderId);
    if (idempotencyKey) {
      const existing = get('SELECT * FROM payment_records WHERE idempotency_key = ?', idempotencyKey);
      if (existing) return { order: loadOrderOrThrow(orderId), reused: true };
    }
    if (order.state === 'pending' && type !== 'deposit') {
      throw new HttpError(409, 'Confirm the deposit before recording further payments');
    }
    if (['cancelled'].includes(order.state) && order.payment_state === 'no_payment_received') {
      throw new HttpError(409, 'This order was cancelled with no payment received');
    }

    const ts = now();
    run(
      `INSERT INTO payment_records (order_id, idempotency_key, type, amount_minor, note, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      orderId, idempotencyKey || null, type, amount, note, ts, adminUser.username,
    );

    const collected = all(
      `SELECT COALESCE(SUM(amount_minor), 0) AS s FROM payment_records
        WHERE order_id = ? AND type IN ('deposit','balance','full')`, orderId)[0].s;
    const paymentState = order.agreed_total_minor > 0 && collected >= order.agreed_total_minor
      ? 'fully_paid'
      : (collected > 0 ? 'deposit_received' : order.payment_state);

    if (order.payment_state !== 'deposit_retained') {
      run('UPDATE orders SET payment_state = ?, updated_at = ? WHERE id = ?', paymentState, ts, orderId);
    }
    return { order: loadOrderOrThrow(orderId), reused: false };
  });
}

/**
 * Refused delivery (RET-03): deposit retained, balance not collected.
 * Stock is NOT restored here — only when the item is physically received back.
 */
export function recordRefusal(orderId, body, adminUser) {
  const note = str(body.note, 'note', { max: 5000 });
  return tx(() => {
    const order = loadOrderOrThrow(orderId);
    transitionGuard(order, ['on_the_way', 'confirmed', 'delivered'], 'record a refusal for');
    const ts = now();
    run(
      `UPDATE orders SET state = 'refused', payment_state = 'deposit_retained', refused_at = ?, updated_at = ?,
                         notes = CASE WHEN ? != '' THEN ? ELSE notes END
        WHERE id = ?`,
      ts, ts, note, note, orderId,
    );
    const depositRow = get(
      `SELECT COALESCE(SUM(amount_minor), 0) AS s FROM payment_records
        WHERE order_id = ? AND type IN ('deposit','balance','full')`, orderId);
    run(
      `INSERT INTO payment_records (order_id, type, amount_minor, note, created_at, created_by)
       VALUES (?, 'outcome_deposit_retained', ?, ?, ?, ?)`,
      orderId, depositRow.s,
      note ? `Delivery refused. Deposit retained / balance not collected. ${note}` : 'Delivery refused. Deposit retained / balance not collected.',
      ts, adminUser.username,
    );
    createNotification({
      type: 'delivery_refused',
      title: `Delivery refused: ${order.order_code}`,
      body: `The customer refused delivery of ${order.order_code}. The deposit is retained; stock is restored only when the item is received back.`,
      relatedType: 'order',
      relatedId: orderId,
      emailTo: getSetting('business_email'),
    });
    return loadOrderOrThrow(orderId);
  });
}

/**
 * Cancellation before payment (RET-02): record created, no payment received, stock unchanged.
 */
export function cancelOrder(orderId, body, adminUser, idempotencyKey) {
  const outcome = str(body.outcome, 'outcome', { max: 200 }) || 'Cancelled before payment';
  const note = str(body.note, 'note', { max: 5000 });

  return tx(() => {
    const order = loadOrderOrThrow(orderId);
    if (idempotencyKey) {
      const existing = get('SELECT * FROM cancellation_returns WHERE idempotency_key = ?', idempotencyKey);
      if (existing) return { order: loadOrderOrThrow(orderId), record: existing, reused: true };
    }
    transitionGuard(order, ['pending'], 'cancel');
    const ts = now();
    run(
      `UPDATE orders SET state = 'cancelled', payment_state = 'no_payment_received', cancelled_at = ?, updated_at = ? WHERE id = ?`,
      ts, ts, orderId,
    );
    run(
      `INSERT INTO payment_records (order_id, type, amount_minor, note, created_at, created_by)
       VALUES (?, 'outcome_no_payment', 0, 'Cancelled before payment — no payment received.', ?, ?)`,
      orderId, ts, adminUser.username,
    );
    const recordCode = uniqueCode('CAN-', 5, (c) => codeExists('cancellation_returns', 'record_code', c));
    run(
      `INSERT INTO cancellation_returns (record_code, idempotency_key, type, order_id, outcome, note, created_at)
       VALUES (?, ?, 'cancellation', ?, ?, ?, ?)`,
      recordCode, idempotencyKey || null, orderId, outcome, note, ts,
    );
    const recordId = get('SELECT last_insert_rowid() AS id').id;
    for (const line of orderLines(orderId)) {
      run(
        `INSERT INTO cancellation_return_lines (record_id, order_line_id, combination_id, quantity)
         VALUES (?, ?, ?, ?)`, recordId, line.id, line.combination_id, line.quantity,
      );
    }
    return { order: loadOrderOrThrow(orderId), record: get('SELECT * FROM cancellation_returns WHERE id = ?', recordId), reused: false };
  });
}

/**
 * Physical return received (RET-03/RET-04): creates a return record and restores stock for the
 * returned quantity. For post-delivery returns the deposit outcome is explicitly admin-selected
 * (the refused-delivery rule is NOT auto-applied). Set restore=false per line for non-resalable items.
 */
export function recordReturn(orderId, body, adminUser, idempotencyKey) {
  const outcome = str(body.outcome, 'outcome', { max: 200 });
  const depositOutcome = str(body.deposit_outcome, 'deposit_outcome', { max: 200 });
  const note = str(body.note, 'note', { max: 5000 });
  const dateReceived = isoDateOrNull(body.date_received, 'date_received') || now();
  const items = body.items || body.lines;
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Returned items are required');

  return tx(() => {
    const order = loadOrderOrThrow(orderId);
    if (idempotencyKey) {
      const existing = get('SELECT * FROM cancellation_returns WHERE idempotency_key = ?', idempotencyKey);
      if (existing) return { order: loadOrderOrThrow(orderId), record: existing, reused: true };
    }
    transitionGuard(order, ['refused', 'delivered', 'on_the_way', 'confirmed'], 'record a return for');

    const lines = orderLines(orderId);
    const resolved = items.map((item) => {
      const lineId = int(item.order_line_id, 'order_line_id', { min: 1 });
      const quantity = int(item.quantity, 'quantity', { min: 1, max: 10000 });
      const restore = item.restore === undefined ? true : bool(item.restore);
      const line = lines.find((l) => l.id === lineId);
      if (!line) throw new HttpError(400, `Order line ${lineId} does not belong to this order`);
      if (quantity > line.quantity) {
        throw new HttpError(400, `Returned quantity exceeds the ordered quantity for ${line.product_name}`);
      }
      return { line, quantity, restore };
    });

    const ts = now();
    const recordCode = uniqueCode('RET-', 5, (c) => codeExists('cancellation_returns', 'record_code', c));
    run(
      `INSERT INTO cancellation_returns (record_code, idempotency_key, type, order_id, outcome, deposit_outcome, note, date_received, created_at)
       VALUES (?, ?, 'return', ?, ?, ?, ?, ?, ?)`,
      recordCode, idempotencyKey || null, orderId,
      outcome || (order.state === 'refused' ? 'Refused delivery item received back' : 'Return after delivery'),
      depositOutcome, note, dateReceived, ts,
    );
    const recordId = get('SELECT last_insert_rowid() AS id').id;

    for (const { line, quantity, restore } of resolved) {
      run(
        `INSERT INTO cancellation_return_lines (record_id, order_line_id, combination_id, quantity)
         VALUES (?, ?, ?, ?)`, recordId, line.id, line.combination_id, quantity,
      );
      if (restore) {
        const combo = get('SELECT * FROM combinations WHERE id = ?', line.combination_id);
        const after = combo.stock_qty + quantity;
        run('UPDATE combinations SET stock_qty = ? WHERE id = ?', after, combo.id);
        run(
          `INSERT INTO inventory_movements (combination_id, delta, reason, order_id, record_id, qty_after, note, created_at)
           VALUES (?, ?, 'return_restored', ?, ?, ?, ?, ?)`,
          line.combination_id, quantity, orderId, recordId, after,
          `Return ${recordCode}`, ts,
        );
        checkLowStock(line.combination_id);
      }
    }

    run(`UPDATE orders SET state = 'returned', returned_at = ?, updated_at = ? WHERE id = ?`, ts, ts, orderId);

    createNotification({
      type: 'return_received',
      title: `Return received: ${recordCode} (order ${order.order_code})`,
      body: `A return was recorded for order ${order.order_code} (${recordCode}). Stock restored only for resalable returned quantities.`,
      relatedType: 'cancellation_return',
      relatedId: recordId,
      emailTo: getSetting('business_email'),
    });

    return { order: loadOrderOrThrow(orderId), record: get('SELECT * FROM cancellation_returns WHERE id = ?', recordId), reused: false };
  });
}

/** Replenish stock (INV-01) with a movement record; re-arms low-stock alerts above the threshold. */
export function replenishStock(combinationId, quantity, note, adminUser) {
  return tx(() => {
    const combo = get('SELECT * FROM combinations WHERE id = ?', combinationId);
    if (!combo) throw new HttpError(404, 'Combination not found');
    const ts = now();
    const after = combo.stock_qty + quantity;
    run('UPDATE combinations SET stock_qty = ? WHERE id = ?', after, combo.id);
    run(
      `INSERT INTO inventory_movements (combination_id, delta, reason, qty_after, note, created_at)
       VALUES (?, ?, 'replenish', ?, ?, ?)`,
      combinationId, quantity, after,
      note || `Replenished by ${adminUser.username}`, ts,
    );
    checkLowStock(combinationId);
    return get('SELECT * FROM combinations WHERE id = ?', combinationId);
  });
}

/** Aggregates for one combination: units out in the fulfilment flow and units delivered. */
export function combinationFulfilment(combinationId) {
  const row = get(
    `SELECT
       COALESCE(SUM(CASE WHEN o.state IN ('confirmed','on_the_way','refused') THEN ol.quantity ELSE 0 END), 0) AS on_the_way,
       COALESCE(SUM(CASE WHEN o.state = 'delivered' THEN ol.quantity ELSE 0 END), 0) AS delivered,
       COALESCE(SUM(CASE WHEN o.state = 'returned' THEN 0 ELSE 0 END), 0) AS returned
     FROM order_lines ol JOIN orders o ON o.id = ol.order_id
     WHERE ol.combination_id = ?`, combinationId);
  return { on_the_way: row.on_the_way, delivered: row.delivered };
}

export { OUT_STATES };
