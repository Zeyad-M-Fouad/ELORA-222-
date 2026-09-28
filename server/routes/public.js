import { Router } from 'express';
import { all, get, run, now } from '../lib/db.js';
import { HttpError, assert } from '../lib/errors.js';
import { str, int, email as validateEmail, enumOf } from '../lib/validate.js';
import { previewOrder, submitOrder, publicOrderView } from '../services/orders.js';
import { publicSettings } from '../services/settings.js';

export const publicRouter = Router();

function comboRow(c) {
  return {
    id: c.id,
    sku: c.sku,
    size: c.size_label,
    size_ml: c.size_ml,
    color: c.color,
    scent: c.scent,
    price_minor: c.price_minor,
    available_qty: c.stock_qty,
    sold_out: c.stock_qty <= 0,
    low_stock: c.stock_qty > 0 && c.low_stock_threshold > 0 && c.stock_qty <= c.low_stock_threshold,
  };
}

function productCard(p) {
  const combos = all('SELECT * FROM combinations WHERE product_id = ? ORDER BY size_ml, color, scent', p.id);
  const images = all('SELECT url, alt FROM product_images WHERE product_id = ? ORDER BY sort_order', p.id);
  const prices = combos.map((c) => c.price_minor);
  const published = get(
    `SELECT COUNT(*) AS n, COALESCE(AVG(rating),0) AS avg FROM reviews WHERE product_id = ? AND status = 'published'`,
    p.id);
  return {
    id: p.id,
    item_code: p.item_code,
    name: p.name,
    category: p.category_name || null,
    category_id: p.category_id,
    images,
    price_min_minor: prices.length ? Math.min(...prices) : null,
    price_max_minor: prices.length ? Math.max(...prices) : null,
    sold_out: combos.length === 0 || combos.every((c) => c.stock_qty <= 0),
    review_count: published.n,
    average_rating: published.avg ? Math.round(published.avg * 10) / 10 : null,
  };
}

function loadProductDetail(id) {
  const p = get(
    `SELECT p.*, cat.name AS category_name
       FROM products p LEFT JOIN categories cat ON cat.id = p.category_id
      WHERE p.id = ? AND p.status = 'active'`, id);
  if (!p) return undefined;
  const combos = all('SELECT * FROM combinations WHERE product_id = ? ORDER BY size_ml, color, scent', p.id);
  const images = all('SELECT url, alt FROM product_images WHERE product_id = ? ORDER BY sort_order', p.id);
  const reviews = all(
    `SELECT id, author_name, rating, body, created_at, published_at
       FROM reviews WHERE product_id = ? AND status = 'published' ORDER BY published_at DESC`, p.id);
  const agg = get(
    `SELECT COUNT(*) AS n, COALESCE(AVG(rating),0) AS avg FROM reviews WHERE product_id = ? AND status = 'published'`,
    p.id);
  return {
    ...productCard(p),
    description: p.description,
    ingredients: p.ingredients,
    usage_instructions: p.usage_instructions,
    combinations: combos.map(comboRow),
    reviews,
    average_rating: agg.avg ? Math.round(agg.avg * 10) / 10 : null,
    review_count: agg.n,
  };
}

publicRouter.get('/settings', (req, res) => {
  res.json(publicSettings());
});

publicRouter.get('/categories', (req, res) => {
  res.json(all(
    `SELECT cat.id, cat.name, COUNT(p.id) AS product_count
       FROM categories cat
       LEFT JOIN products p ON p.category_id = cat.id AND p.status = 'active'
      GROUP BY cat.id ORDER BY cat.sort_order, cat.name`));
});

publicRouter.get('/facets', (req, res) => {
  // Only values that appear in configured combinations (CAT-02/CAT-06).
  const combos = all(
    `SELECT c.size_label, c.color, c.scent
       FROM combinations c JOIN products p ON p.id = c.product_id
      WHERE p.status = 'active'`);
  const uniq = (vals) => [...new Set(vals.filter(Boolean))].sort();
  res.json({
    sizes: uniq(combos.map((c) => c.size_label)),
    colors: uniq(combos.map((c) => c.color)),
    scents: uniq(combos.map((c) => c.scent)),
  });
});

publicRouter.get('/products', (req, res) => {
  const { category, size, color, scent, q } = req.query;
  let products = all(
    `SELECT p.*, cat.name AS category_name
       FROM products p LEFT JOIN categories cat ON cat.id = p.category_id
      WHERE p.status = 'active' ORDER BY p.name`);
  if (category) products = products.filter((p) => String(p.category_id) === String(category));
  if (q) {
    const needle = String(q).toLowerCase();
    products = products.filter((p) =>
      p.name.toLowerCase().includes(needle) || p.item_code.toLowerCase().includes(needle));
  }

  let cards = products.map(productCard);
  // Option filters require a configured combination that matches ALL selected facets.
  if (size || color || scent) {
    cards = cards
      .map((card) => ({ card, combos: all('SELECT * FROM combinations WHERE product_id = ?', card.id) }))
      .filter(({ combos }) => combos.some((c) =>
        (!size || c.size_label === size) && (!color || c.color === color) && (!scent || c.scent === scent)))
      .map(({ card }) => card);
  }
  res.json(cards);
});

publicRouter.get('/products/:id', (req, res) => {
  const detail = loadProductDetail(Number(req.params.id));
  if (!detail) throw new HttpError(404, 'Product not found');
  res.json(detail);
});

publicRouter.post('/orders/preview', (req, res) => {
  res.json(previewOrder(req.body.items || req.body.lines, req.body.promo_code));
});

publicRouter.post('/orders', (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'] || null;
  const { order, reused } = submitOrder(req.body, idempotencyKey);
  res.status(reused ? 200 : 201).json({
    order_code: order.order_code,
    created_at: order.created_at,
    message: 'Your order has been submitted. Please keep your order code and use it when contacting us about your order. Someone will contact you soon on WhatsApp.',
  });
});

// Safe lookup: never exposes address, contact details, or payment amounts.
publicRouter.get('/orders/:code', (req, res) => {
  const view = publicOrderView(req.params.code);
  if (!view) throw new HttpError(404, 'Order not found');
  res.json(view);
});

publicRouter.get('/content/:slug', (req, res) => {
  const page = get('SELECT slug, title, body, updated_at FROM content_pages WHERE slug = ?', req.params.slug);
  if (!page) throw new HttpError(404, 'Page not found');
  res.json(page);
});

publicRouter.post('/reviews', (req, res) => {
  const productId = int(req.body.product_id, 'product_id', { min: 1 });
  const authorName = str(req.body.author_name, 'author_name', { required: true, min: 2, max: 100 });
  const authorEmail = req.body.author_email ? validateEmail(req.body.author_email, 'author_email') : '';
  const rating = int(req.body.rating, 'rating', { min: 1, max: 5 });
  const body = str(req.body.body, 'body', { max: 5000 });

  const product = get(`SELECT id FROM products WHERE id = ? AND status = 'active'`, productId);
  assert(product, 404, 'Product not found');

  run(
    `INSERT INTO reviews (product_id, author_name, author_email, rating, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    productId, authorName, authorEmail, rating, body, now(),
  );
  res.status(201).json({
    ok: true,
    message: 'Thank you! Your review has been submitted and will appear once it is approved.',
  });
});

// Minimal markdown rendering for content pages (headings, bold, lists, paragraphs).
export function renderMarkdownLite(text) {
  const escape = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = String(text || '').split('\n');
  const out = [];
  let inList = false;
  for (const raw of lines) {
    const line = escape(raw.trim());
    if (line.startsWith('## ')) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h2>${line.slice(3)}</h2>`);
    } else if (line.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (line === '') {
      if (inList) { out.push('</ul>'); inList = false; }
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');

  function inline(s) {
    return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }
}

publicRouter.get('/content/:slug/html', (req, res) => {
  const page = get('SELECT * FROM content_pages WHERE slug = ?', req.params.slug);
  if (!page) throw new HttpError(404, 'Page not found');
  res.json({ slug: page.slug, title: page.title, html: renderMarkdownLite(page.body) });
});
