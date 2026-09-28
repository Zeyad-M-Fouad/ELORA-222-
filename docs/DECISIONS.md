# Eloria — open business decisions & implementation defaults

The handoff distinguishes confirmed requirements from unresolved business decisions. This
document lists every unresolved item, the **default used in this build**, and **where to change
it** once the business decides. Nothing here changes a confirmed requirement's meaning.

---

### 1. Product name & catalog content (§3 CAT-01)
- **Open:** "Initial product and final category names require confirmation."
- **Default:** seeded demo product *Eloria Body Lotion* in category *Body Care*, with provisional
  copy, ingredients and 5 size/color/scent combinations.
- **Change:** edit in Dashboard → Products / Categories. Nothing is hardcoded.

### 2. Item-code structure (§11)
- **Open:** product-level codes, combination-level codes, or both.
- **Default:** **both** — products have a required `item_code`; each combination has a required
  unique `sku` (seeded as `ELR-BL-001-200-VAN` style). Both appear in exports and dashboards.
- **Change:** if only product-level codes are wanted, make `sku` display-optional in
  `public/js/app.js` / `public/admin/admin.js` and the export column lists.

### 3. Separate "Confirmed / Awaiting dispatch" stage (§5 open workflow detail)
- **Open:** whether the dashboard needs a stage between deposit confirmation and actual shipment.
- **Default:** **yes** — `confirmed` (awaiting dispatch) exists; deposit confirmation lands there.
  A "Mark dispatched" action moves it to `on_the_way`. The confirmation form has a
  *"dispatch immediately"* checkbox for businesses that prefer to skip the stage.
  Both states count as "on the way" in inventory (matching the INV-02 example).
- **Change:** to remove the stage, make deposit confirmation set `on_the_way` directly
  (`server/services/orders.js`, `confirmDeposit`, `dispatchNow`).

### 4. Customer identity (§2)
- **Open:** none — accounts were explicitly *not* requested.
- **Default:** no accounts. Order requests carry name (optional), email, phone, address.

### 5. Review eligibility & moderation (§9 WEB-04)
- **Open:** who may submit, moderation rules, submission access.
- **Default:** anyone may submit a review with a display name + optional email (**no account
  required**); every review starts as `pending` and is **published only after admin approval**
  (moderation-by-default is the safe choice). Published reviews and their average appear on the
  product page.
- **Change:** auto-publish by setting `status='published'` in `POST /api/public/reviews`
  (`server/routes/public.js`); eligibility rules (e.g. verified buyers by order code/email)
  would add a check against `orders`/`order_lines`.

### 6. Customer filtering scope (§3 CAT-06)
- **Open:** exact filters.
- **Default:** category, size, color, scent + free-text search. Filter values come only from
  configured combinations. No customer-facing export (per the requirement).

### 7. Discounts (§8 DIS-02)
- **Open:** which method launches, percent vs fixed, validity dates, usage limits, scope
  restrictions, stacking with sale prices.
- **Default:** **both** methods implemented:
  - `sale` — automatic, scoped (all / one product / one category).
  - `promo` — customer-entered code, same rules plus a per-code usage limit and a minimum
    subtotal.
  - percent *and* fixed amounts; validity windows (`starts_at`/`ends_at`); stacking disabled
    unless the admin ticks "Can combine with sale prices" (default off).
  - Order summary shows every applied discount by name and amount.
- **Change:** everything is admin-configurable in Dashboard → Discounts; no code changes needed.

### 8. Shipping amount added to the order total (§9 WEB-02)
- **Open:** the process for adding the agreed shipping amount to the admin's final total.
- **Default:** the website never calculates shipping. When confirming the deposit the admin
  enters the agreed total and may record a **shipping amount** that is stored on the order and
  shown separately (agreed total = product subtotal − discounts + shipping, as entered).
- **Change:** if shipping should roll into a generic "adjustment" instead, rename the field in
  `confirmDeposit` (`server/services/orders.js`) and the order detail totals panel.

### 9. Contact page details & general inquiry form (§9 WEB-01)
- **Open:** exact contact information; whether a separate inquiry form is needed.
- **Default:** contact details are placeholders in Dashboard → Settings (shown on the Contact
  page); **no inquiry form** was added since the need is unconfirmed.
- **Change:** update Settings for the real details; if an inquiry form is wanted it can post to
  a new `messages` table surfaced in the dashboard.

### 10. Return windows, refunds, deposit treatment on post-delivery returns (§6 RET-04)
- **Open:** return request window; refund amount/process; deposit treatment for accepted
  post-delivery returns; damaged/non-resalable handling.
- **Default:** returns are recorded **manually with an explicit deposit outcome** chosen by the
  admin per return (`Deposit retained (refused delivery rule)` / `Refund issued` / `Refund
  pending — to be agreed` / `Exchange issued` / `Not applicable`). The refused-delivery
  "deposit retained" rule is **never applied automatically** to post-delivery returns — exactly
  as required. Stock is restored only per-line and only when the admin marks the quantity
  resalable ("Restore to stock").
- **Change:** when policies are agreed, add the chosen outcomes as presets in the return form
  and a policy paragraph in the returns-policy content page.

### 11. Financial terminology (§10 REP-03)
- **Open:** definitions for *revenue*, *collected money*, and *retained-deposit reporting*;
  cost basis is not tracked (batch purchase-cost tracking deferred).
- **Default:** the overview reports:
  - **Agreed order totals** (excludes cancelled & pending) — labelled "revenue (agreed)".
  - **Collected payments** (sum of recorded deposit/balance/full payments).
  - **Outstanding balances** (agreed − collected for non-cancelled orders).
  - **Retained deposits** (refused deliveries).
  Nothing is labelled "profit".
- **Change:** adjust the SQL in `server/services/reports.js` once definitions are agreed.

### 12. Automatic order expiry (§4 ORD-04)
- **Open:** automatic cancellation/expiration of unpaid requests.
- **Default:** **none** — pending requests stay pending until the admin explicitly cancels.

### 13. Customer confirmation email / automated WhatsApp (§4 ORD-03)
- **Open:** whether a customer confirmation email or automated WhatsApp messaging is required.
- **Default:** **not implemented** (not confirmed requirements). The business email notification
  (order code, items, customer contact details) *is* implemented, with outbox/SMTP delivery and
  dashboard retry.

### 14. Currency
- **Open:** the handoff says "pounds" without specifying.
- **Default:** currency label `EGP` (Settings → Currency label changes it everywhere). Amounts
  are stored as integer minor units (1/100).

### 15. Technology stack & hosting (§12)
- **Open:** stack, hosting, courier integration.
- **Default (this build):** Node 22 + Express + SQLite (WAL) + vanilla-JS frontends, single
  process, `data/eloria.db` file. Deployable on any Node host with a persistent volume; move
  to Postgres/MySQL by swapping `server/lib/db.js` (SQL is close to standard).

### 16. WhatsApp verification (§4 ORD-01)
- **Open:** none — a phone field cannot prove WhatsApp is installed and verification was not
  requested.
- **Default:** the form states that WhatsApp is used for confirmation and asks for a
  WhatsApp-enabled number, with the explicit note that the website cannot verify installation.

---

## Deliberate defaults worth noting (not open questions, but chosen safeguards)

- **Zero-stock combinations cannot be requested** (CAT-05) at submission time; requesting more
  units than currently in stock *is* allowed for available combinations — pending orders do not
  reserve inventory (ORD-04) and the deposit-confirmation stock check (INV-03) is the enforcement
  point, exactly as the handoff anticipates (AC-07).
- **Order-code lookup is intentionally minimal**: state, payment state and item summary only —
  never address, phone, email or amounts (§12).
- **Delivery never implies payment** (AC-09) and **payment never implies delivery** (AC-10) —
  the two state columns are independent.
- **Deleting a product with order history hides it instead** so historical orders stay usable.
- **Low-stock alerts are edge-triggered** (one alert when entering the condition, re-armed after
  replenishment above the threshold) — the handoff's recommended implementation (INV-04).
