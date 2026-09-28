import { Router } from 'express';
import { all, get, run, now, tx } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { str, int, enumOf, bool } from '../../lib/validate.js';
import { parseMoney } from '../../lib/money.js';
import { checkLowStock } from '../../lib/notifications.js';
import { sendXlsx } from '../../lib/xlsx.js';

export const catalogRouter = Router();

/* ---------------- Categories ---------------- */

catalogRouter.get('/categories', (req, res) => {
  res.json(all(
    `SELECT cat.*, COUNT(p.id) AS product_count
       FROM categories cat LEFT JOIN products p ON p.category_id = cat.id
      GROUP BY cat.id ORDER BY cat.sort_order, cat.name`));
});

catalogRouter.post('/categories', (req, res) => {
  const name = str(req.body.name, 'name', { required: true, min: 1, max: 120 });
  const sortOrder = int(req.body.sort_order, 'sort_order', { required: false }) ?? 0;
  try {
    run('INSERT INTO categories (name, sort_order, created_at) VALUES (?, ?, ?)', name, sortOrder, now());
  } catch {
    throw new HttpError(409, 'A category with this name already exists');
  }
  res.status(201).json(get('SELECT * FROM categories WHERE id = ?', get('SELECT last_insert_rowid() AS id').id));
});

catalogRouter.put('/categories/:id', (req, res) => {
  const name = str(req.body.name, 'name', { required: true, min: 1, max: 120 });
  const sortOrder = int(req.body.sort_order, 'sort_order', { required: false }) ?? 0;
  const existing = get('SELECT * FROM categories WHERE id = ?', Number(req.params.id));
  if (!existing) throw new HttpError(404, 'Category not found');
  run('UPDATE categories SET name = ?, sort_order = ? WHERE id = ?', name, sortOrder, existing.id);
  res.json(get('SELECT * FROM categories WHERE id = ?', existing.id));
});

catalogRouter.delete('/categories/:id', (req, res) => {
  run('DELETE FROM categories WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

/* ---------------- Products ---------------- */

function productPayload(body) {
  return {
    item_code: str(body.item_code, 'item_code', { required: true, min: 1, max: 60 }),
    name: str(body.name, 'name', { required: true, min: 1, max: 200 }),
    description: str(body.description, 'description', { max: 20000 }),
    ingredients: str(body.ingredients, 'ingredients', { max: 20000 }),
    usage_instructions: str(body.usage_instructions, 'usage_instructions', { max: 20000 }),
    category_id: body.category_id ? int(body.category_id, 'category_id', { min: 1 }) : null,
    status: enumOf(body.status || 'active', 'status', ['active', 'hidden']),
  };
}

function fullProduct(id) {
  const p = get(
    `SELECT p.*, cat.name AS category_name FROM products p
      LEFT JOIN categories cat ON cat.id = p.category_id WHERE p.id = ?`, id);
  if (!p) return undefined;
  return {
    ...p,
    images: all('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id', id),
    combinations: all('SELECT * FROM combinations WHERE product_id = ? ORDER BY size_ml, color, scent, id', id),
  };
}

catalogRouter.get('/products', (req, res) => {
  res.json(all(
    `SELECT p.*, cat.name AS category_name,
            (SELECT COUNT(*) FROM combinations c WHERE c.product_id = p.id) AS combination_count,
            (SELECT COALESCE(SUM(stock_qty),0) FROM combinations c WHERE c.product_id = p.id) AS stock_total
       FROM products p LEFT JOIN categories cat ON cat.id = p.category_id
      ORDER BY p.name`).map((p) => p));
});

catalogRouter.get('/products/export.xlsx', async (req, res, next) => {
  try {
    const products = all(
      `SELECT p.*, cat.name AS category_name
         FROM products p LEFT JOIN categories cat ON cat.id = p.category_id
        ORDER BY p.name`);
    const combos = all(
      `SELECT c.*, p.name AS product_name, p.item_code
         FROM combinations c JOIN products p ON p.id = c.product_id
        ORDER BY p.name, c.size_ml, c.color, c.scent`);
    await sendXlsx(res, 'eloria-products.xlsx', {
      sheetName: 'Products',
      title: 'Eloria — Products & combinations',
      columns: [
        { header: 'Item code', key: 'item_code', width: 14 },
        { header: 'Product', key: 'name', width: 26 },
        { header: 'Category', key: 'category_name', width: 16 },
        { header: 'Status', key: 'status', width: 10 },
        { header: 'SKU', key: 'sku', width: 20 },
        { header: 'Size', key: 'size_label', width: 10 },
        { header: 'Color', key: 'color', width: 14 },
        { header: 'Scent', key: 'scent', width: 12 },
        { header: 'Price', key: 'price', width: 12 },
        { header: 'Stock', key: 'stock_qty', width: 9 },
        { header: 'Low-stock threshold', key: 'low_stock_threshold', width: 17 },
      ],
      rows: combos.map((c) => ({
        ...c,
        price: (c.price_minor / 100).toFixed(2),
      })),
    });
  } catch (err) { next(err); }
});

catalogRouter.get('/products/:id', (req, res) => {
  const p = fullProduct(Number(req.params.id));
  if (!p) throw new HttpError(404, 'Product not found');
  res.json(p);
});

catalogRouter.post('/products', (req, res) => {
  const payload = productPayload(req.body);
  let id;
  tx(() => {
    try {
      run(
        `INSERT INTO products (item_code, name, description, ingredients, usage_instructions, category_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        payload.item_code, payload.name, payload.description, payload.ingredients, payload.usage_instructions,
        payload.category_id, payload.status, now(), now(),
      );
    } catch {
      throw new HttpError(409, 'A product with this item code already exists');
    }
    id = get('SELECT last_insert_rowid() AS id').id;
    saveChildren(id, req.body); // atomic with the product insert (tx is re-entrant)
  });
  res.status(201).json(fullProduct(id));
});

catalogRouter.put('/products/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = get('SELECT * FROM products WHERE id = ?', id);
  if (!existing) throw new HttpError(404, 'Product not found');
  const payload = productPayload(req.body);
  tx(() => {
    try {
      run(
        `UPDATE products SET item_code = ?, name = ?, description = ?, ingredients = ?, usage_instructions = ?,
                             category_id = ?, status = ?, updated_at = ? WHERE id = ?`,
        payload.item_code, payload.name, payload.description, payload.ingredients, payload.usage_instructions,
        payload.category_id, payload.status, now(), id,
      );
    } catch {
      throw new HttpError(409, 'A product with this item code already exists');
    }
    saveChildren(id, req.body); // atomic with the product update (tx is re-entrant)
  });
  res.json(fullProduct(id));
});

/**
 * Images and combinations are replaced wholesale when provided.
 * Combinations are never auto-generated beyond what the admin configures (CAT-02).
 */
function saveChildren(productId, body) {
  if (Array.isArray(body.images)) {
    run('DELETE FROM product_images WHERE product_id = ?', productId);
    body.images.forEach((img, i) => {
      run('INSERT INTO product_images (product_id, url, alt, sort_order) VALUES (?, ?, ?, ?)',
        productId, str(img.url, 'images.url', { required: true, max: 500 }),
        str(img.alt, 'images.alt', { max: 200 }), int(img.sort_order, 'images.sort_order', { required: false }) ?? i);
    });
  }
  if (Array.isArray(body.combinations)) {
    const keepIds = [];
    body.combinations.forEach((c, index) => {
      const combo = {
        sku: str(c.sku, 'combinations.sku', { required: true, max: 60 }),
        size_label: str(c.size_label, 'combinations.size_label', { required: true, max: 60 }),
        size_ml: c.size_ml == null || c.size_ml === '' ? null : int(c.size_ml, 'combinations.size_ml', { min: 0 }),
        color: str(c.color, 'combinations.color', { max: 60 }),
        scent: str(c.scent, 'combinations.scent', { max: 60 }),
        price_minor: parseMoney(c.price),
        stock_qty: int(c.stock_qty, 'combinations.stock_qty', { min: 0, max: 10_000_000 }),
        low_stock_threshold: int(c.low_stock_threshold, 'combinations.low_stock_threshold', { min: 0, max: 10_000_000 }) ?? 5,
      };
      try {
        if (c.id) {
          const existing = get('SELECT * FROM combinations WHERE id = ? AND product_id = ?', c.id, productId);
          if (existing) {
            run(
              `UPDATE combinations SET sku = ?, size_label = ?, size_ml = ?, color = ?, scent = ?,
                                       price_minor = ?, stock_qty = ?, low_stock_threshold = ? WHERE id = ?`,
              combo.sku, combo.size_label, combo.size_ml, combo.color, combo.scent,
              combo.price_minor, combo.stock_qty, combo.low_stock_threshold, existing.id,
            );
            if (combo.stock_qty !== existing.stock_qty) {
              run(
                `INSERT INTO inventory_movements (combination_id, delta, reason, qty_after, note, created_at)
                 VALUES (?, ?, 'correction', ?, ?, ?)`,
                existing.id, combo.stock_qty - existing.stock_qty, combo.stock_qty,
                'Edited in product editor', now(),
              );
              checkLowStock(existing.id);
            }
            keepIds.push(existing.id);
            return;
          }
        }
        run(
          `INSERT INTO combinations (product_id, sku, size_label, size_ml, color, scent, price_minor, stock_qty, low_stock_threshold, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          productId, combo.sku, combo.size_label, combo.size_ml, combo.color, combo.scent,
          combo.price_minor, combo.stock_qty, combo.low_stock_threshold, now(),
        );
        const newId = get('SELECT last_insert_rowid() AS id').id;
        if (combo.stock_qty > 0) {
          run(
            `INSERT INTO inventory_movements (combination_id, delta, reason, qty_after, note, created_at)
             VALUES (?, ?, 'replenish', ?, 'Initial stock', ?)`,
            newId, combo.stock_qty, combo.stock_qty, now(),
          );
        }
        checkLowStock(newId);
        keepIds.push(newId);
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) {
          throw new HttpError(409, `Duplicate SKU or duplicate size/color/scent combination (row ${index + 1})`);
        }
        throw err;
      }
    });
    // Remove combinations the admin dropped — only when no order lines reference them.
    for (const row of all('SELECT * FROM combinations WHERE product_id = ?', productId)) {
      if (!keepIds.includes(row.id)) {
        const used = get('SELECT id FROM order_lines WHERE combination_id = ? LIMIT 1', row.id);
        if (used) throw new HttpError(409, `Combination ${row.sku} is referenced by an order and cannot be removed — set its stock to 0 instead`);
        run('DELETE FROM combinations WHERE id = ?', row.id);
      }
    }
  }
}

catalogRouter.delete('/products/:id', (req, res) => {
  const id = Number(req.params.id);
  const used = get(
    `SELECT ol.id FROM order_lines ol JOIN combinations c ON c.id = ol.combination_id WHERE c.product_id = ? LIMIT 1`,
    id);
  if (used) {
    // Keep history usable (engineering recommendation): hide instead of delete.
    run(`UPDATE products SET status = 'hidden', updated_at = ? WHERE id = ?`, now(), id);
    return res.json({ ok: true, hidden: true, message: 'Product has order history — it was hidden instead of deleted.' });
  }
  run('DELETE FROM products WHERE id = ?', id);
  res.json({ ok: true });
});
