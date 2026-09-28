import { Router } from 'express';
import { all, get, run, now } from '../../lib/db.js';
import { str, int, enumOf } from '../../lib/validate.js';
import { getAllSettings, setSettings } from '../../services/settings.js';
import { HttpError } from '../../lib/errors.js';

export const settingsRouter = Router();
export const reviewsRouter = Router();

settingsRouter.get('/', (req, res) => {
  res.json(getAllSettings());
});

settingsRouter.put('/', (req, res) => {
  const allowed = ['business_name', 'business_email', 'business_phone', 'whatsapp_number',
    'business_address', 'business_hours', 'currency'];
  const entries = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) entries[key] = str(req.body[key], key, { max: 300 });
  }
  res.json(setSettings(entries));
});

/* ---------------- Reviews moderation (WEB-04) ---------------- */

reviewsRouter.get('/', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status && ['pending', 'published', 'rejected'].includes(req.query.status)) {
    where.push('r.status = ?');
    params.push(req.query.status);
  }
  if (req.query.product_id) {
    where.push('r.product_id = ?');
    params.push(int(req.query.product_id, 'product_id', { min: 1 }));
  }
  res.json(all(
    `SELECT r.*, p.name AS product_name FROM reviews r JOIN products p ON p.id = r.product_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY r.created_at DESC LIMIT 500`,
    ...params));
});

reviewsRouter.post('/:id/publish', (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const review = get('SELECT * FROM reviews WHERE id = ?', id);
  if (!review) throw new HttpError(404, 'Review not found');
  run(`UPDATE reviews SET status = 'published', published_at = ? WHERE id = ?`, now(), id);
  res.json(get('SELECT * FROM reviews WHERE id = ?', id));
});

reviewsRouter.post('/:id/reject', (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const review = get('SELECT * FROM reviews WHERE id = ?', id);
  if (!review) throw new HttpError(404, 'Review not found');
  run(`UPDATE reviews SET status = 'rejected' WHERE id = ?`, id);
  res.json(get('SELECT * FROM reviews WHERE id = ?', id));
});
