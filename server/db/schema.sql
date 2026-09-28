-- Eloria schema. Money is stored as integer minor units (1/100 of the currency unit).
-- Times are ISO-8601 UTC strings.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code           TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  ingredients         TEXT NOT NULL DEFAULT '',
  usage_instructions  TEXT NOT NULL DEFAULT '',
  category_id         INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden')),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  alt        TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- A combination = size + color + scent, with its own price and stock (CAT-02).
CREATE TABLE IF NOT EXISTS combinations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id          INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku                 TEXT NOT NULL UNIQUE,
  size_label          TEXT NOT NULL,
  size_ml             INTEGER,
  color               TEXT NOT NULL DEFAULT '',
  scent               TEXT NOT NULL DEFAULT '',
  price_minor         INTEGER NOT NULL CHECK (price_minor >= 0),
  stock_qty           INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  low_stock_alerted   INTEGER NOT NULL DEFAULT 0, -- edge-trigger latch, re-armed on replenish
  created_at          TEXT NOT NULL,
  UNIQUE (product_id, size_label, color, scent)
);

-- Order delivery/fulfillment states:
--   pending      : request submitted, nothing reserved (ORD-04)
--   confirmed    : deposit confirmed, in the "on the way" fulfilment flow (open Q: awaiting-dispatch stage)
--   on_the_way   : dispatched to the customer
--   delivered    : customer received the item
--   refused      : delivery refused, awaiting physical return (stock NOT restored)
--   returned     : item physically received back (stock restored per returned quantity)
--   cancelled    : cancelled before payment
CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code        TEXT NOT NULL UNIQUE,
  idempotency_key   TEXT UNIQUE,
  customer_name     TEXT NOT NULL DEFAULT '',
  customer_email    TEXT NOT NULL,
  customer_phone    TEXT NOT NULL,
  delivery_address  TEXT NOT NULL,
  state             TEXT NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending','confirmed','on_the_way','delivered','refused','returned','cancelled')),
  payment_state     TEXT NOT NULL DEFAULT 'unpaid'
                    CHECK (payment_state IN ('unpaid','deposit_received','fully_paid','deposit_retained','no_payment_received')),
  items_subtotal_minor   INTEGER NOT NULL DEFAULT 0,
  discount_total_minor  INTEGER NOT NULL DEFAULT 0,
  shipping_minor        INTEGER NOT NULL DEFAULT 0,
  agreed_total_minor    INTEGER NOT NULL DEFAULT 0, -- set/confirmed by admin (PAY-01); may include shipping (WEB-02)
  notes             TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  confirmed_at      TEXT,
  dispatched_at     TEXT,
  delivered_at      TEXT,
  refused_at        TEXT,
  returned_at       TEXT,
  cancelled_at      TEXT
);

-- Snapshots preserve name/options/prices at request time (engineering recommendation).
CREATE TABLE IF NOT EXISTS order_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  combination_id  INTEGER NOT NULL REFERENCES combinations(id),
  product_name    TEXT NOT NULL,
  item_code       TEXT NOT NULL,
  size_label      TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '',
  scent           TEXT NOT NULL DEFAULT '',
  unit_price_minor INTEGER NOT NULL,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  discount_minor  INTEGER NOT NULL DEFAULT 0, -- total discount applied to this line
  line_total_minor INTEGER NOT NULL
);

-- Manual payment records (PAY-01). One row per event; order totals denormalised on the order.
-- type: deposit | balance | outcome_no_payment | outcome_deposit_retained | outcome_refund | note
CREATE TABLE IF NOT EXISTS payment_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  idempotency_key TEXT UNIQUE,
  type            TEXT NOT NULL,
  amount_minor    INTEGER NOT NULL DEFAULT 0,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL DEFAULT 'admin'
);

-- Cancellation / return records (RET-01..RET-04).
-- type: cancellation | return
-- deposit_outcome on returns is admin-selected; the refused-delivery rule is NOT auto-applied to
-- post-delivery returns (RET-04 open decisions).
CREATE TABLE IF NOT EXISTS cancellation_returns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  record_code     TEXT NOT NULL UNIQUE,
  idempotency_key TEXT UNIQUE,
  type            TEXT NOT NULL CHECK (type IN ('cancellation','return')),
  order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  outcome         TEXT NOT NULL DEFAULT '',
  deposit_outcome TEXT NOT NULL DEFAULT '',
  note            TEXT NOT NULL DEFAULT '',
  date_received   TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cancellation_return_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id      INTEGER NOT NULL REFERENCES cancellation_returns(id) ON DELETE CASCADE,
  order_line_id  INTEGER NOT NULL REFERENCES order_lines(id),
  combination_id INTEGER NOT NULL REFERENCES combinations(id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0)
);

-- Inventory movement ledger (INV-01/INV-02). stock_qty on combinations is the current
-- available quantity; movements are the audit trail.
-- reason: replenish | deposit_confirmed_deduction | return_restored | correction
CREATE TABLE IF NOT EXISTS inventory_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  combination_id INTEGER NOT NULL REFERENCES combinations(id) ON DELETE CASCADE,
  delta          INTEGER NOT NULL,
  reason         TEXT NOT NULL,
  order_id       INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  record_id      INTEGER REFERENCES cancellation_returns(id) ON DELETE SET NULL,
  qty_after      INTEGER NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  author_name  TEXT NOT NULL,
  author_email TEXT NOT NULL DEFAULT '',
  rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
  created_at   TEXT NOT NULL,
  published_at TEXT
);

-- type: sale (automatic) | promo (code entered by customer)
-- method: percent (value = percent * 100, e.g. 1000 = 10%) | fixed (value = minor units per line)
-- scope: all | product | category
CREATE TABLE IF NOT EXISTS discounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  type              TEXT NOT NULL CHECK (type IN ('sale','promo')),
  code              TEXT UNIQUE,
  name              TEXT NOT NULL DEFAULT '',
  method            TEXT NOT NULL CHECK (method IN ('percent','fixed')),
  value             INTEGER NOT NULL CHECK (value > 0),
  scope             TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all','product','category')),
  scope_id          INTEGER,
  min_subtotal_minor INTEGER NOT NULL DEFAULT 0,
  starts_at         TEXT,
  ends_at           TEXT,
  usage_limit       INTEGER,
  used_count        INTEGER NOT NULL DEFAULT 0,
  stackable         INTEGER NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discount_redemptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  discount_id INTEGER NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- channel: dashboard | email. status: pending | sent | failed | read (dashboard items)
CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  related_type TEXT NOT NULL DEFAULT '',
  related_id   INTEGER,
  channel      TEXT NOT NULL DEFAULT 'dashboard',
  status       TEXT NOT NULL DEFAULT 'pending',
  email_to     TEXT NOT NULL DEFAULT '',
  error        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  sent_at      TEXT,
  read_at      TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Simple CMS pages: shipping-policy, faq, contact-extra (WEB-01..WEB-03)
CREATE TABLE IF NOT EXISTS content_pages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_state ON orders(state);
CREATE INDEX IF NOT EXISTS idx_orders_payment_state ON orders(payment_state);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_combinations_product ON combinations(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_movements_combination ON inventory_movements(combination_id);
