# Eloria — skincare storefront & admin dashboard

Implementation of the **Eloria Developer Handoff v1.0**: a customer website where shoppers submit
**order requests** (no online payment) plus an admin dashboard where a single admin manages the
catalog, inventory, orders, manual payments, cancellations/returns, discounts and reporting.
Orders are confirmed personally over WhatsApp; deposits and balances are collected outside the
website and recorded manually.

## Quick start

```bash
npm install
npm start          # http://localhost:3000
```

| Surface | URL |
|---|---|
| Customer storefront | `http://localhost:3000/` |
| Admin dashboard | `http://localhost:3000/admin/` |

The first run creates and seeds `data/eloria.db` with a demo catalog (the provisional
"Eloria Body Lotion" with five size/color/scent combinations), sample reviews, two demo
discounts (`10% launch sale` + promo code `WELCOME10`), and the FAQ / shipping / returns /
contact pages.

**Default admin login:** `admin` / `eloria-admin` — change it in *Settings*, or before first
run via environment variables (below).

```bash
npm test           # 20 API-level acceptance tests (AC-01..AC-16 map)
npm run dev        # auto-restart on change
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port (binds `0.0.0.0`) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `eloria-admin` | Bootstrap admin account (seed only) |
| `EMAIL_TRANSPORT` | `outbox` | `outbox` writes `.eml` files to `data/outbox/`; `smtp` sends via `SMTP_URL` (nodemailer) |
| `SMTP_URL` | — | e.g. `smtps://user:pass@smtp.host:465` |
| `EMAIL_FROM` | `Eloria Orders <orders@eloria.example>` | From-address for business notifications |
| `ELORIA_DATA_DIR` | `./data` | Database + email outbox location |

## What is implemented

**Customer website** — catalog with filters (category/size/color/scent, CAT-06), product pages
with configured-combination picker only (CAT-02/03: no invented combinations, single options
displayed without fake choices, price & availability update per selection, exact volume shown),
sold-out handling (CAT-05), order request builder with server-side summary and discounts
(ORD-02 — shipping is never calculated, only explained), submission with unique order code and
the exact confirmation wording (ORD-03), safe order-status lookup by code (no contact/address/
amount exposure), reviews with moderation flow (WEB-04), FAQ / shipping policy / returns /
contact pages (WEB-01..03).

**Order workflow** — the state machine from §5 is implemented exactly:

| Event | Order state | Payment state | Inventory |
|---|---|---|---|
| Customer submits request | `pending` | `unpaid` | no change |
| Customer cancels before paying | `cancelled` | `no_payment_received` | no change + cancellation record |
| Admin confirms deposit | `confirmed` → `on_the_way` flow | `deposit_received` | stock checked atomically, then deducted |
| Customer receives item | `delivered` | unchanged | no second deduction |
| Admin records remaining payment | unchanged | `fully_paid` | no change |
| Customer refuses delivery | `refused` | `deposit_retained` | **not** restored |
| Item physically received back | `returned` | retained deposit preserved | returned quantity restored |

- Deposit confirmation is one atomic operation with a stock check (INV-03): insufficient stock
  blocks confirmation and returns the affected combination + quantities for a dashboard alert.
- Retrying any action is safe (state guards + optional `Idempotency-Key` header).
- The handoff's open question about a separate "Confirmed / Awaiting dispatch" stage is answered
  with a dedicated `confirmed` state plus an optional "dispatch immediately" checkbox.

**Admin dashboard** — overview with order-vs-unit counts, money totals (labelled per REP-03 —
never "profit"), revenue by item code & category, drill-downs that reconcile with totals (REP-02),
orders list/detail with the full action set, product & combination editor (CAT-01/02/04),
inventory with available / on-the-way / delivered / thresholds / replenishment (INV-01/02),
per-combination low-stock alerts to dashboard + email with edge-triggering and re-arm (INV-04),
manual payment records (PAY-01/02), cancellation & return records with reference codes (RET-01..04),
discounts (sale + promo codes, DIS-01/02 defaults documented in `docs/DECISIONS.md`), review
moderation, notification centre with email retry, settings, and **Excel export of every list,
reflecting the current filters** with explicitly labelled date filters (REP-04).

**Engineering safeguards** (§12) — atomic stock operations, idempotent retries, snapshotted order
lines (catalog edits never rewrite history), server-side validation and money math, integer
minor-unit money storage, admin auth (session cookie + scrypt) on every dashboard route/export,
order preserved if email delivery fails (retryable notification, order never duplicated),
hidden products keep usable order history, and the public order-code lookup exposes only state +
item summary.

## Tech stack

- **Node 22 + Express**, SQLite via the built-in `node:sqlite` (no native modules).
- **Vanilla ES-module frontends** (no build step): `public/` storefront, `public/admin/` dashboard.
- **exceljs** for `.xlsx` exports, **nodemailer** for optional SMTP (file outbox by default).
- Money: integer minor units (1/100) everywhere; currency label configurable (default `EGP`).

```
server/
  index.js            app factory + entry
  config.js           env configuration
  db/schema.sql       database schema (see handoff §11 for the mapping)
  db/seed.js          demo catalog, content pages, admin user
  lib/                db (re-entrant tx), auth, money, ids, email, notifications, xlsx, validate
  services/           orders state machine, discounts, reports, settings
  routes/public.js    customer API
  routes/admin/       dashboard API (auth-guarded)
public/               customer storefront (index.html, js/, css/, assets/)
public/admin/         admin dashboard
tests/api.test.js     acceptance tests mapped to AC-01..AC-16
docs/DECISIONS.md     open business decisions and the defaults this build uses
```

## Open business decisions

The handoff lists items that still need confirmation (product name, item-code structure, review
eligibility, discount rules, return windows/refunds, financial definitions, contact details, the
awaiting-dispatch stage, …). Each one, the default this implementation uses, and what to change
when the business decides are documented in **[docs/DECISIONS.md](docs/DECISIONS.md)**.
