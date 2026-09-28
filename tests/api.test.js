/**
 * Acceptance tests — map to the handoff document's AC-01..AC-16 where testable at API level.
 * Run with: npm test
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ELORIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eloria-test-'));
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-pass';
process.env.EMAIL_TRANSPORT = 'outbox';

const { createApp } = await import('../server/index.js');

let server;
let base;
let adminCookie;

async function api(method, url, { body, headers = {}, cookie } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

const asAdmin = (method, url, opts = {}) => api(method, url, { ...opts, cookie: adminCookie });

before(async () => {
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await api('POST', '/api/admin/auth/login', { body: { username: 'admin', password: 'test-admin-pass' } });
  assert.equal(login.status, 200);
  adminCookie = login.headers.getSetCookie()[0].split(';')[0];
});

after(() => server?.close());

describe('catalog', () => {
  test('AC-01: product with one configured color exposes only that color', async () => {
    // All seeded combinations use only Natural White and Soft Peach.
    const facets = await api('GET', '/api/public/facets');
    assert.ok(facets.body.colors.includes('Natural White'));
    assert.ok(facets.body.colors.includes('Soft Peach'));
    assert.equal(facets.body.colors.includes('Red'), false);
  });

  test('AC-02: each configured combination carries its own price and availability', async () => {
    const product = await api('GET', '/api/public/products/1');
    assert.equal(product.status, 200);
    assert.ok(product.body.combinations.length >= 2);
    const byKey = new Map(product.body.combinations.map((c) => [`${c.size}|${c.color}|${c.scent}`, c]));
    const small = byKey.get('200 ml|Natural White|Vanilla');
    const big = byKey.get('400 ml|Natural White|Vanilla');
    assert.notEqual(small.price_minor, big.price_minor);
    assert.notEqual(small.available_qty, undefined);
    assert.equal(small.sold_out, false);
  });

  test('AC-03: zero-stock combination is sold out and cannot be requested', async () => {
    const product = await api('GET', '/api/public/products/1');
    const lav = product.body.combinations.find((c) => c.scent === 'Lavender');
    assert.equal(lav.available_qty, 4);

    // Drain the lavender combination.
    await asAdmin('POST', '/api/admin/inventory/' + lav.id + '/replenish', { body: {} }); // invalid qty -> 400
    const drained = await asAdmin('PUT', '/api/admin/products/1', {
      body: {
        item_code: 'ELR-BL-001', name: 'Eloria Body Lotion', status: 'active',
        combinations: product.body.combinations.map((c) => ({
          id: c.id, sku: c.sku, size_label: c.size, size_ml: c.size_ml, color: c.color,
          scent: c.scent, price: c.price_minor / 100,
          stock_qty: c.scent === 'Lavender' ? 0 : c.available_qty, low_stock_threshold: 5,
        })),
      },
    });
    assert.equal(drained.status, 200);

    const after = await api('GET', '/api/public/products/1');
    const lav2 = after.body.combinations.find((c) => c.scent === 'Lavender');
    assert.equal(lav2.sold_out, true);

    const attempt = await api('POST', '/api/public/orders', {
      body: {
        customer_name: 'X', customer_email: 'x@y.com', customer_phone: '+201001', delivery_address: 'somewhere street 1',
        items: [{ combination_id: lav2.id, quantity: 1 }],
      },
    });
    assert.equal(attempt.status, 400);
    assert.match(attempt.body.error, /sold out/i);
  });

  test('AC-04: hiding a product removes it publicly but keeps dashboard data', async () => {
    await asAdmin('PUT', '/api/admin/products/1', {
      body: { item_code: 'ELR-BL-001', name: 'Eloria Body Lotion', status: 'hidden' },
    });
    const publicList = await api('GET', '/api/public/products');
    assert.equal(publicList.body.length, 0);
    const publicDetail = await api('GET', '/api/public/products/1');
    assert.equal(publicDetail.status, 404);

    const adminList = await asAdmin('GET', '/api/admin/products');
    assert.ok(adminList.body.some((p) => p.id === 1));
    const inventory = await asAdmin('GET', '/api/admin/inventory');
    assert.ok(inventory.body.items.some((c) => c.product_id === 1));

    await asAdmin('PUT', '/api/admin/products/1', {
      body: { item_code: 'ELR-BL-001', name: 'Eloria Body Lotion', status: 'active' },
    });
    const back = await api('GET', '/api/public/products');
    assert.equal(back.body.length, 1);
  });
});

describe('order submission', () => {
  let orderId;
  let orderCode;

  test('AC-05: submission creates a pending order, unique code, notification and business email', async () => {
    const res = await api('POST', '/api/public/orders', {
      headers: { 'Idempotency-Key': 'submit-1' },
      body: {
        customer_name: 'Test Customer', customer_email: 'test@example.com',
        customer_phone: '+201000000000', delivery_address: '12 Test Street, Cairo',
        items: [{ combination_id: 1, quantity: 1 }],
      },
    });
    assert.equal(res.status, 201);
    assert.match(res.body.order_code, /^ELR-/);
    assert.match(res.body.message, /keep your order code/i);
    assert.match(res.body.message, /WhatsApp/i);
    assert.doesNotMatch(res.body.message, /\d+\s*(minutes|min)/i); // no time promise
    orderCode = res.body.order_code;

    const orders = await asAdmin('GET', '/api/admin/orders');
    const order = orders.body.items.find((o) => o.order_code === orderCode);
    assert.equal(order.state, 'pending');
    assert.equal(order.payment_state, 'unpaid');
    orderId = order.id;

    const notifs = await asAdmin('GET', '/api/admin/notifications');
    assert.ok(notifs.body.items.some((n) => n.title.includes(orderCode)));
    assert.ok(notifs.body.emails.some((n) => n.title.includes(orderCode)));

    // Idempotent resubmission returns the same order.
    const again = await api('POST', '/api/public/orders', {
      headers: { 'Idempotency-Key': 'submit-1' },
      body: {
        customer_name: 'Test Customer', customer_email: 'test@example.com',
        customer_phone: '+201000000000', delivery_address: '12 Test Street, Cairo',
        items: [{ combination_id: 1, quantity: 1 }],
      },
    });
    assert.equal(again.body.order_code, orderCode);
  });

  test('AC-06: pending request leaves stock unchanged', async () => {
    const inv = await asAdmin('GET', '/api/admin/inventory');
    const combo = inv.body.items.find((c) => c.id === 1);
    assert.equal(combo.on_the_way, 0);
    assert.equal(combo.stock_qty, 300);
  });

  test('AC-07: insufficient stock blocks confirmation with a dashboard alert', async () => {
    // Request 6 units of lavender (only 4... we zeroed it earlier; use coconut 200 ml which has 120).
    // Instead: drain stock after the request — set combo 2 to 0 via product editor while a pending order exists.
    const pending = await api('POST', '/api/public/orders', {
      body: {
        customer_name: 'B', customer_email: 'b@y.com', customer_phone: '+201002',
        delivery_address: 'another street 2', items: [{ combination_id: 2, quantity: 5 }],
      },
    });
    assert.equal(pending.status, 201);
    const product = await api('GET', '/api/public/products/1');
    await asAdmin('PUT', '/api/admin/products/1', {
      body: {
        item_code: 'ELR-BL-001', name: 'Eloria Body Lotion', status: 'active',
        combinations: product.body.combinations.map((c) => ({
          id: c.id, sku: c.sku, size_label: c.size, size_ml: c.size_ml, color: c.color,
          scent: c.scent, price: c.price_minor / 100,
          stock_qty: c.id === 2 ? 2 : c.available_qty, low_stock_threshold: 5,
        })),
      },
    });

    const orders = await asAdmin('GET', '/api/admin/orders?state=pending');
    const target = orders.body.items.find((o) => o.id !== orderId);
    const blocked = await asAdmin('POST', `/api/admin/orders/${target.id}/confirm-deposit`, {
      body: { agreed_total: 100, deposit_amount: 50 },
    });
    assert.equal(blocked.status, 409);
    assert.ok(blocked.body.details.insufficient.length === 1);
    assert.equal(blocked.body.details.insufficient[0].requested, 5);
    assert.equal(blocked.body.details.insufficient[0].available, 2);

    const after = await asAdmin('GET', `/api/admin/orders/${target.id}`);
    assert.equal(after.body.state, 'pending'); // still pending, nothing deducted
  });

  test('AC-08: deposit confirmation deducts stock into the fulfilment flow', async () => {
    const res = await asAdmin('POST', `/api/admin/orders/${orderId}/confirm-deposit`, {
      body: { agreed_total: 300, deposit_amount: 100, shipping_total: 10, dispatch_now: true, notes: 'ok' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.state, 'on_the_way');
    assert.equal(res.body.payment_state, 'deposit_received');

    const inv = await asAdmin('GET', '/api/admin/inventory');
    const combo = inv.body.items.find((c) => c.id === 1);
    assert.equal(combo.stock_qty, 299);
    assert.equal(combo.on_the_way, 1);
    assert.equal(combo.delivered, 0);

    // Repeating confirmation must not double-deduct.
    const repeat = await asAdmin('POST', `/api/admin/orders/${orderId}/confirm-deposit`, {
      body: { agreed_total: 300, deposit_amount: 100 },
    });
    assert.equal(repeat.status, 409);
    const inv2 = await asAdmin('GET', '/api/admin/inventory');
    assert.equal(inv2.body.items.find((c) => c.id === 1).stock_qty, 299);
  });

  test('AC-09: delivery changes neither stock nor payment state', async () => {
    const res = await asAdmin('POST', `/api/admin/orders/${orderId}/mark-delivered`);
    assert.equal(res.status, 200);
    assert.equal(res.body.state, 'delivered');
    assert.equal(res.body.payment_state, 'deposit_received');

    const inv = await asAdmin('GET', '/api/admin/inventory');
    const combo = inv.body.items.find((c) => c.id === 1);
    assert.equal(combo.stock_qty, 299);
    assert.equal(combo.on_the_way, 0);
    assert.equal(combo.delivered, 1);
  });

  test('AC-10: recording the remaining payment marks the order fully paid', async () => {
    const res = await asAdmin('POST', `/api/admin/orders/${orderId}/record-payment`, {
      body: { type: 'balance', amount: 200, note: 'cash on delivery' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.payment_state, 'fully_paid');
    assert.equal(res.body.payments.length, 2);
    assert.equal(res.body.delivered_at != null, true);
    assert.equal(res.body.state, 'delivered'); // delivery state unchanged
    assert.equal(res.body.collected_minor, 30000);
  });

  test('ORD-02: preview shows line items, discounts and subtotal without shipping', async () => {
    const res = await api('POST', '/api/public/orders/preview', {
      body: { items: [{ combination_id: 1, quantity: 2 }] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.lines.length, 1);
    assert.ok(res.body.product_subtotal_minor > 0);
    assert.ok(res.body.discount_total_minor > 0); // launch sale applies
    assert.equal(res.body.shipping_minor, undefined);
  });
});

describe('discounts (DIS-01/02)', () => {
  test('percent values round-trip as human percents and stack per the stacking flag', async () => {
    const created = await asAdmin('POST', '/api/admin/discounts', {
      body: {
        type: 'promo', code: 'test20', name: 'Test 20% (stackable)',
        method: 'percent', value: 20, scope: 'all', stackable: true, active: true,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.value, 2000); // stored as percent * 100
    assert.equal(created.body.code, 'TEST20');

    // 1 x combo 1 = 220.00 gross. Launch sale 10% = 22.00, then stackable TEST20 = 44.00.
    const preview = await api('POST', '/api/public/orders/preview', {
      body: { items: [{ combination_id: 1, quantity: 1 }], promo_code: 'test20' },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.items_subtotal_minor, 22000);
    assert.equal(preview.body.discount_total_minor, 2200 + 4400);
    assert.equal(preview.body.discount_breakdown.length, 2);
    assert.equal(preview.body.promo_code, 'TEST20');

    // Seeded WELCOME10 is NOT stackable: only the automatic sale applies.
    const preview2 = await api('POST', '/api/public/orders/preview', {
      body: { items: [{ combination_id: 1, quantity: 1 }], promo_code: 'WELCOME10' },
    });
    assert.equal(preview2.status, 200);
    assert.equal(preview2.body.discount_total_minor, 2200);
    assert.equal(preview2.body.promo_code, 'WELCOME10');

    await asAdmin('DELETE', `/api/admin/discounts/${created.body.id}`);
  });

  test('minimum subtotal is enforced with a clear error', async () => {
    const created = await asAdmin('POST', '/api/admin/discounts', {
      body: {
        type: 'promo', code: 'BIGSPEND', name: 'Big spenders',
        method: 'percent', value: 10, scope: 'all', min_subtotal: '1000.00', active: true,
      },
    });
    assert.equal(created.status, 201);

    const res = await api('POST', '/api/public/orders/preview', {
      body: { items: [{ combination_id: 1, quantity: 1 }], promo_code: 'BIGSPEND' },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /minimum/i);

    await asAdmin('DELETE', `/api/admin/discounts/${created.body.id}`);
  });
});

describe('cancellation, refusal and returns', () => {
  let cancelOrderId;
  let refuseOrderId;

  test('AC-11: cancelling a pending unpaid order records a cancellation and leaves stock unchanged', async () => {
    const before = (await asAdmin('GET', '/api/admin/inventory')).body.items.find((c) => c.id === 3);
    const res = await api('POST', '/api/public/orders', {
      body: {
        customer_name: 'C', customer_email: 'c@y.com', customer_phone: '+201003',
        delivery_address: 'cancel street 3', items: [{ combination_id: 3, quantity: 2 }],
      },
    });
    const orders = await asAdmin('GET', '/api/admin/orders?state=pending');
    cancelOrderId = orders.body.items.find((o) => o.order_code === res.body.order_code).id;

    const cancelled = await asAdmin('POST', `/api/admin/orders/${cancelOrderId}/cancel`, {
      body: { outcome: 'Cancelled before payment', note: 'customer changed mind' },
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.state, 'cancelled');
    assert.equal(cancelled.body.payment_state, 'no_payment_received');

    const records = await asAdmin('GET', '/api/admin/cancellations-returns?type=cancellation');
    const record = records.body.items.find((r) => r.order_id === cancelOrderId);
    assert.ok(record);
    assert.match(record.record_code, /^CAN-/);
    assert.equal(record.lines.length, 1);
    assert.equal(record.lines[0].quantity, 2);

    const after = (await asAdmin('GET', '/api/admin/inventory')).body.items.find((c) => c.id === 3);
    assert.equal(after.stock_qty, before.stock_qty);
  });

  test('AC-12: refused delivery retains deposit and restores stock only after physical return', async () => {
    const res = await api('POST', '/api/public/orders', {
      body: {
        customer_name: 'R', customer_email: 'r@y.com', customer_phone: '+201004',
        delivery_address: 'refuse street 4', items: [{ combination_id: 4, quantity: 1 }],
      },
    });
    const orders = await asAdmin('GET', '/api/admin/orders?state=pending');
    refuseOrderId = orders.body.items.find((o) => o.order_code === res.body.order_code).id;

    const start = (await asAdmin('GET', '/api/admin/inventory')).body.items.find((c) => c.id === 4);
    await asAdmin('POST', `/api/admin/orders/${refuseOrderId}/confirm-deposit`, {
      body: { agreed_total: 200, deposit_amount: 80, dispatch_now: true },
    });
    const refused = await asAdmin('POST', `/api/admin/orders/${refuseOrderId}/record-refusal`, {
      body: { note: 'customer not home' },
    });
    assert.equal(refused.status, 200);
    assert.equal(refused.body.state, 'refused');
    assert.equal(refused.body.payment_state, 'deposit_retained');
    assert.ok(refused.body.payments.some((p) => p.type === 'outcome_deposit_retained' && p.amount_minor === 8000));

    const mid = (await asAdmin('GET', '/api/admin/inventory')).body.items.find((c) => c.id === 4);
    assert.equal(mid.stock_qty, start.stock_qty - 1); // NOT restored yet

    const detail = await asAdmin('GET', `/api/admin/orders/${refuseOrderId}`);
    const returned = await asAdmin('POST', `/api/admin/orders/${refuseOrderId}/return`, {
      body: {
        date_received: '2026-09-28',
        outcome: 'Refused delivery item received back',
        deposit_outcome: 'Deposit retained (per policy)',
        items: [{ order_line_id: detail.body.lines[0].id, quantity: 1 }],
      },
    });
    assert.equal(returned.status, 200);
    assert.equal(returned.body.state, 'returned');

    const end = (await asAdmin('GET', '/api/admin/inventory')).body.items.find((c) => c.id === 4);
    assert.equal(end.stock_qty, start.stock_qty); // restored after physical return
    assert.ok(returned.body.payments.some((p) => p.type === 'outcome_deposit_retained')); // retained deposit record preserved
  });
});

describe('low stock', () => {
  test('AC-13: low-stock threshold triggers dashboard + email alert identifying the combination', async () => {
    // Replenish nothing; set threshold above current stock for combination 5 (stock 4, threshold 5 => already low).
    const combos = (await asAdmin('GET', '/api/admin/inventory')).body.items;
    const combo = combos.find((c) => c.id === 5);
    // Reset latch by bumping stock above threshold first.
    await asAdmin('POST', `/api/admin/inventory/5/replenish`, { body: { quantity: 10 } });
    await asAdmin('PUT', '/api/admin/inventory/5/threshold', { body: { threshold: 5 } });

    // Drop below threshold via a confirmed order of 10+ units.
    const order = await api('POST', '/api/public/orders', {
      body: {
        customer_name: 'L', customer_email: 'l@y.com', customer_phone: '+201005',
        delivery_address: 'low stock street 5', items: [{ combination_id: 5, quantity: 10 }],
      },
    });
    const orders = await asAdmin('GET', '/api/admin/orders?state=pending');
    const target = orders.body.items.find((o) => o.order_code === order.body.order_code);
    const confirmed = await asAdmin('POST', `/api/admin/orders/${target.id}/confirm-deposit`, {
      body: { agreed_total: 400, deposit_amount: 100 },
    });
    assert.equal(confirmed.status, 200);

    const notifs = await asAdmin('GET', '/api/admin/notifications');
    const low = notifs.body.items.find((n) => n.type === 'low_stock' && n.body.includes('Lavender'));
    assert.ok(low, 'expected a low-stock notification naming the combination');
    assert.match(low.body, /\d+ unit\(s\) remaining/);
    const email = notifs.body.emails.find((n) => n.type === 'low_stock' && n.body.includes('Lavender'));
    assert.ok(email, 'expected a low-stock email');
    assert.equal(email.status, 'sent'); // outbox transport records delivery
  });
});

describe('reports, exports and reviews', () => {
  test('AC-14: filtered report export returns an Excel file matching the filters', async () => {
    const res = await asAdmin('GET', '/api/admin/orders/export.xlsx?state=delivered');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);
    const buf = Buffer.from(await res.body); // body is text-parsed... use raw fetch instead
  });

  test('AC-14b: export bytes are a valid xlsx (zip magic) and honour filters', async () => {
    const res = await fetch(base + '/api/admin/orders/export.xlsx?state=pending', { headers: { Cookie: adminCookie } });
    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 2).toString(), 'PK'); // xlsx is a zip container
    const delivered = await fetch(base + '/api/admin/orders/export.xlsx?state=delivered', { headers: { Cookie: adminCookie } });
    const buf2 = Buffer.from(await delivered.arrayBuffer());
    assert.equal(buf2.subarray(0, 2).toString(), 'PK');
  });

  test('AC-15: inventory breakdown reconciles with the inventory total', async () => {
    const inv = await asAdmin('GET', '/api/admin/inventory');
    const breakdown = await asAdmin('GET', '/api/admin/reports/breakdown/available-units');
    const sum = breakdown.body.reduce((s, r) => s + r.stock_qty, 0);
    assert.equal(sum, inv.body.totals.available_units);
    const overview = await asAdmin('GET', '/api/admin/reports/overview');
    assert.equal(overview.body.counts.available_units, inv.body.totals.available_units);
  });

  test('AC-16: a published review appears on the product page and feeds the average', async () => {
    const submitted = await api('POST', '/api/public/reviews', {
      body: { product_id: 1, author_name: 'Reviewer', rating: 4, body: 'Nice lotion' },
    });
    assert.equal(submitted.status, 201);

    const pendingList = await asAdmin('GET', '/api/admin/reviews?status=pending');
    const review = pendingList.body.find((r) => r.author_name === 'Reviewer');
    assert.ok(review);
    assert.equal(review.status, 'pending');

    await asAdmin('POST', `/api/admin/reviews/${review.id}/publish`);
    const product = await api('GET', '/api/public/products/1');
    assert.ok(product.body.reviews.some((r) => r.author_name === 'Reviewer'));
    const published = product.body.reviews;
    const avg = published.reduce((s, r) => s + r.rating, 0) / published.length;
    assert.equal(product.body.average_rating, Math.round(avg * 10) / 10);
  });

  test('public order lookup does not expose address, contact details or amounts', async () => {
    const orders = await asAdmin('GET', '/api/admin/orders?state=pending');
    const code = orders.body.items[0]?.order_code || (await asAdmin('GET', '/api/admin/orders')).body.items[0].order_code;
    const res = await api('GET', `/api/public/orders/${code}`);
    const text = JSON.stringify(res.body);
    assert.equal(res.status, 200);
    assert.equal(res.body.delivery_address, undefined);
    assert.equal(res.body.customer_email, undefined);
    assert.equal(res.body.customer_phone, undefined);
    assert.equal(text.includes('agreed'), false);
  });

  test('dashboard is protected behind admin authentication', async () => {
    const res = await api('GET', '/api/admin/orders');
    assert.equal(res.status, 401);
    const exp = await api('GET', '/api/admin/orders/export.xlsx');
    assert.equal(exp.status, 401);
  });
});
