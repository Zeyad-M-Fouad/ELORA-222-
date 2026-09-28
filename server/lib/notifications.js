import { all, get, run, now, tx } from './db.js';
import { sendEmail } from './email.js';

/**
 * Notification creation + email dispatch.
 * An order/record is always persisted first; notification failure never rolls it back
 * (engineering recommendation). Failed emails can be retried from the dashboard.
 */
export function createNotification({ type, title, body = '', relatedType = '', relatedId = null, emailTo = '' }) {
  const createdAt = now();
  run(
    `INSERT INTO notifications (type, title, body, related_type, related_id, channel, status, email_to, created_at)
     VALUES (?, ?, ?, ?, ?, 'dashboard', 'sent', ?, ?)`,
    type, title, body, relatedType, relatedId, emailTo, createdAt,
  );
  const dashId = get('SELECT last_insert_rowid() AS id').id;

  if (emailTo) {
    run(
      `INSERT INTO notifications (type, title, body, related_type, related_id, channel, status, email_to, created_at)
       VALUES (?, ?, ?, ?, ?, 'email', 'pending', ?, ?)`,
      type, title, body, relatedType, relatedId, emailTo, createdAt,
    );
    const emailId = get('SELECT last_insert_rowid() AS id').id;
    // Fire-and-forget: dispatch after the surrounding transaction has a chance to commit.
    setImmediate(() => dispatchEmail(emailId));
    return { dashId, emailId };
  }
  return { dashId };
}

export async function dispatchEmail(notificationId) {
  const n = get('SELECT * FROM notifications WHERE id = ? AND channel = ?', notificationId, 'email');
  if (!n || n.status === 'sent') return n;
  const result = await sendEmail({ to: n.email_to, subject: n.title, text: n.body });
  if (result.delivered) {
    run(`UPDATE notifications SET status = 'sent', sent_at = ?, error = '' WHERE id = ?`, now(), notificationId);
  } else {
    run(`UPDATE notifications SET status = 'failed', error = ? WHERE id = ?`, result.error || 'send failed', notificationId);
  }
  return get('SELECT * FROM notifications WHERE id = ?', notificationId);
}

export async function retryNotification(notificationId) {
  const n = get('SELECT * FROM notifications WHERE id = ?', notificationId);
  if (!n) return undefined;
  if (n.channel === 'email') return dispatchEmail(notificationId);
  return n;
}

/**
 * Low-stock edge trigger (INV-04): notify when a combination ENTERS the low-stock
 * condition (qty <= threshold) and re-arm after replenishment above the threshold.
 */
export function checkLowStock(combinationId) {
  const combo = get(
    `SELECT c.*, p.name AS product_name
       FROM combinations c JOIN products p ON p.id = c.product_id
      WHERE c.id = ?`, combinationId);
  if (!combo) return;
  const threshold = combo.low_stock_threshold;
  if (threshold <= 0) return;

  if (combo.stock_qty <= threshold && !combo.low_stock_alerted) {
    const label = comboOptionsText(combo);
    const settings = all('SELECT key, value FROM settings');
    const emailTo = settings.find((s) => s.key === 'business_email')?.value || '';
    tx(() => {
      run('UPDATE combinations SET low_stock_alerted = 1 WHERE id = ?', combo.id);
      createNotification({
        type: 'low_stock',
        title: `Low stock: ${combo.product_name} (${label})`,
        body: `Only ${combo.stock_qty} unit(s) remaining for ${combo.product_name} — ${label} (SKU ${combo.sku}). Low-stock threshold: ${threshold}.`,
        relatedType: 'combination',
        relatedId: combo.id,
        emailTo,
      });
    });
  } else if (combo.stock_qty > threshold && combo.low_stock_alerted) {
    run('UPDATE combinations SET low_stock_alerted = 0 WHERE id = ?', combo.id);
  }
}

export function comboOptionsText(c) {
  return [c.size_label, c.color, c.scent].filter(Boolean).join(' / ');
}
