import { Router } from 'express';
import { all, get, run, now } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { str, int, enumOf, bool, isoDateOrNull } from '../../lib/validate.js';
import { parseMoney } from '../../lib/money.js';
import { sendXlsx } from '../../lib/xlsx.js';

export const discountsRouter = Router();

function payload(body) {
  const type = enumOf(body.type, 'type', ['sale', 'promo']);
  const method = enumOf(body.method, 'method', ['percent', 'fixed']);
  const scope = enumOf(body.scope || 'all', 'scope', ['all', 'product', 'category']);
  let value;
  if (method === 'percent') {
    // The API accepts a human percent (10 = 10%); storage is percent * 100.
    value = int(body.value, 'value', { min: 1, max: 100 }) * 100;
  } else {
    value = parseMoney(body.value);
    if (value <= 0) throw new HttpError(400, 'value must be greater than zero');
  }
  const code = type === 'promo'
    ? str(body.code, 'code', { required: true, min: 2, max: 60 }).toUpperCase()
    : null;
  return {
    type, code, method, value, scope,
    scope_id: scope === 'all' ? null : int(body.scope_id, 'scope_id', { min: 1 }),
    name: str(body.name, 'name', { max: 200 }),
    min_subtotal_minor: body.min_subtotal ? parseMoney(body.min_subtotal) : 0,
    starts_at: isoDateOrNull(body.starts_at, 'starts_at'),
    ends_at: isoDateOrNull(body.ends_at, 'ends_at'),
    usage_limit: body.usage_limit == null || body.usage_limit === '' ? null : int(body.usage_limit, 'usage_limit', { min: 1 }),
    stackable: bool(body.stackable),
    active: bool(body.active ?? true),
  };
}

discountsRouter.get('/', (req, res) => {
  res.json(all('SELECT * FROM discounts ORDER BY created_at DESC'));
});

discountsRouter.post('/', (req, res) => {
  const d = payload(req.body);
  try {
    run(
      `INSERT INTO discounts (type, code, name, method, value, scope, scope_id, min_subtotal_minor,
                              starts_at, ends_at, usage_limit, stackable, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      d.type, d.code, d.name, d.method, d.value, d.scope, d.scope_id, d.min_subtotal_minor,
      d.starts_at, d.ends_at, d.usage_limit, d.stackable ? 1 : 0, d.active ? 1 : 0, now(),
    );
  } catch {
    throw new HttpError(409, 'A discount with this code already exists');
  }
  res.status(201).json(get('SELECT * FROM discounts WHERE id = ?', get('SELECT last_insert_rowid() AS id').id));
});

discountsRouter.put('/:id', (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const existing = get('SELECT * FROM discounts WHERE id = ?', id);
  if (!existing) throw new HttpError(404, 'Discount not found');
  const d = payload(req.body);
  try {
    run(
      `UPDATE discounts SET type = ?, code = ?, name = ?, method = ?, value = ?, scope = ?, scope_id = ?,
                            min_subtotal_minor = ?, starts_at = ?, ends_at = ?, usage_limit = ?, stackable = ?, active = ?
        WHERE id = ?`,
      d.type, d.code, d.name, d.method, d.value, d.scope, d.scope_id, d.min_subtotal_minor,
      d.starts_at, d.ends_at, d.usage_limit, d.stackable ? 1 : 0, d.active ? 1 : 0, id,
    );
  } catch {
    throw new HttpError(409, 'A discount with this code already exists');
  }
  res.json(get('SELECT * FROM discounts WHERE id = ?', id));
});

discountsRouter.delete('/:id', (req, res) => {
  run('DELETE FROM discounts WHERE id = ?', int(req.params.id, 'id', { min: 1 }));
  res.json({ ok: true });
});

discountsRouter.get('/export.xlsx', async (req, res, next) => {
  try {
    const rows = all('SELECT * FROM discounts ORDER BY created_at DESC');
    await sendXlsx(res, 'eloria-discounts.xlsx', {
      sheetName: 'Discounts',
      title: 'Eloria — Discounts',
      columns: [
        { header: 'Type', key: 'type', width: 10 },
        { header: 'Code', key: 'code', width: 14 },
        { header: 'Name', key: 'name', width: 30 },
        { header: 'Method', key: 'method', width: 10 },
        { header: 'Value', key: 'value', width: 10 },
        { header: 'Scope', key: 'scope', width: 10 },
        { header: 'Min subtotal', key: 'min_subtotal_minor', width: 13 },
        { header: 'Starts', key: 'starts_at', width: 20 },
        { header: 'Ends', key: 'ends_at', width: 20 },
        { header: 'Used', key: 'used_count', width: 8 },
        { header: 'Usage limit', key: 'usage_limit', width: 11 },
        { header: 'Stackable', key: 'stackable', width: 10 },
        { header: 'Active', key: 'active', width: 8 },
      ],
      rows: rows.map((r) => ({
        ...r,
        value_display: r.method === 'percent' ? `${r.value / 100}%` : (r.value / 100).toFixed(2),
        min_subtotal_display: r.min_subtotal_minor ? (r.min_subtotal_minor / 100).toFixed(2) : '',
      })),
    });
  } catch (err) { next(err); }
});
