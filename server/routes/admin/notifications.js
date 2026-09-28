import { Router } from 'express';
import { all, get, run, now } from '../../lib/db.js';
import { int } from '../../lib/validate.js';
import { retryNotification } from '../../lib/notifications.js';

export const notificationsRouter = Router();

notificationsRouter.get('/', (req, res) => {
  const unread = get(`SELECT COUNT(*) AS n FROM notifications WHERE channel = 'dashboard' AND read_at IS NULL`).n;
  const items = all(
    `SELECT * FROM notifications WHERE channel = 'dashboard'
      ORDER BY created_at DESC LIMIT 200`);
  const emails = all(
    `SELECT * FROM notifications WHERE channel = 'email'
      ORDER BY created_at DESC LIMIT 200`);
  res.json({ items, emails, unread });
});

notificationsRouter.post('/:id/read', (req, res) => {
  run('UPDATE notifications SET read_at = ? WHERE id = ? AND channel = ?', now(), int(req.params.id, 'id', { min: 1 }), 'dashboard');
  res.json({ ok: true });
});

notificationsRouter.post('/read-all', (req, res) => {
  run(`UPDATE notifications SET read_at = ? WHERE channel = 'dashboard' AND read_at IS NULL`, now());
  res.json({ ok: true });
});

notificationsRouter.post('/:id/retry', async (req, res) => {
  const updated = await retryNotification(int(req.params.id, 'id', { min: 1 }));
  res.json(updated);
});
