import { h, clear, money, dateFmt, stars, api, flash, optionText } from './ui.js';
import { getCart, addLine, setQty, clearCart, cartCount } from './store.js';

/* ---------------- shell ---------------- */

const app = document.getElementById('app');
let settings = { currency: 'EGP', business_name: 'Eloria' };

async function boot() {
  try { settings = await api('GET', '/api/public/settings'); } catch { /* defaults */ }
  renderHeader();
  window.addEventListener('hashchange', route);
  window.addEventListener('eloria-cart', renderHeader);
  route();
}

function nav() {
  const hash = location.hash || '#/';
  const base = hash.split('?')[0];
  const links = [
    ['#/', 'Home'], ['#/catalog', 'Shop'], ['#/order', 'Your request'],
    ['#/lookup', 'Order status'], ['#/shipping', 'Shipping'], ['#/returns', 'Returns'],
    ['#/faq', 'FAQ'], ['#/contact', 'Contact'],
  ];
  return h('div', { class: 'site-nav' },
    links.map(([href, label]) => h('a', { href, class: base === href || (href === '#/catalog' && base.startsWith('#/product')) ? 'active' : '' }, label)),
    h('a', { href: '#/order', class: 'cart-link' }, `Request (${cartCount()})`),
  );
}

function renderHeader() {
  const header = document.getElementById('site-header');
  clear(header);
  header.append(
    h('div', { class: 'container' },
      h('a', { href: '#/', class: 'brand' }, settings.business_name || 'Eloria', h('span', {}, ' · '), 'skincare'),
      nav(),
    ),
  );
}

function renderFooter() {
  const footer = document.getElementById('site-footer');
  clear(footer);
  footer.append(h('div', { class: 'container' },
    h('div', {},
      h('strong', {}, settings.business_name || 'Eloria'),
      h('div', { class: 'small' }, 'Order requests are confirmed personally on WhatsApp.'),
      h('div', { class: 'small' }, settings.business_address || ''),
    ),
    h('div', {},
      h('a', { href: '#/shipping' }, 'Shipping Policy'), ' · ',
      h('a', { href: '#/returns' }, 'Cancellations & Returns'), ' · ',
      h('a', { href: '#/faq' }, 'FAQ'), ' · ',
      h('a', { href: '#/contact' }, 'Contact'),
    ),
    h('div', { class: 'small' }, `© ${new Date().getFullYear()} ${settings.business_name || 'Eloria'}. Prices in ${settings.currency}.`),
  ));
}

/* ---------------- router ---------------- */

const routes = [
  [/^#\/$/, pageHome],
  [/^#\/catalog/, pageCatalog],
  [/^#\/product\/(\d+)/, pageProduct],
  [/^#\/order\/done\/([A-Z0-9-]+)/, pageOrderDone],
  [/^#\/order/, pageOrder],
  [/^#\/lookup/, pageLookup],
  [/^#\/faq/, () => pageContent('faq')],
  [/^#\/shipping/, () => pageContent('shipping-policy')],
  [/^#\/returns/, () => pageContent('returns-policy')],
  [/^#\/contact/, pageContact],
];

async function route() {
  const hash = location.hash || '#/';
  window.scrollTo(0, 0);
  renderHeader();
  renderFooter();
  clear(app).append(h('div', { class: 'container' }, h('div', { class: 'empty' }, h('span', { class: 'spin' }))));
  for (const [pattern, handler] of routes) {
    const match = hash.match(pattern);
    if (match) {
      try {
        await handler(...match.slice(1));
      } catch (err) {
        clear(app).append(h('div', { class: 'container' },
          h('div', { class: 'notice notice-danger' }, err.message || 'Something went wrong')));
      }
      return;
    }
  }
  location.hash = '#/';
}

function render(...nodes) {
  clear(app).append(h('div', { class: 'container' }, ...nodes));
}

/* ---------------- home ---------------- */

async function pageHome() {
  const products = await api('GET', '/api/public/products');
  render(
    h('div', { class: 'hero' },
      h('div', { class: 'hero-inner' },
        h('h1', {}, 'Soft skin, made simple'),
        h('p', {}, 'Hydrating skincare, thoughtfully made. Choose your options, send your request, and we will confirm everything with you on WhatsApp.'),
        h('a', { href: '#/catalog', class: 'btn btn-amber' }, 'Shop the collection'),
        h('a', { href: '#/faq', class: 'btn btn-secondary' }, 'How it works'),
      ),
    ),
    h('div', { class: 'trust-row' },
      h('div', { class: 'trust-item' }, '✦ Personal WhatsApp confirmation'),
      h('div', { class: 'trust-item' }, '✦ Keep your unique order code'),
      h('div', { class: 'trust-item' }, '✦ Deposit collected outside the site'),
      h('div', { class: 'trust-item' }, '✦ Shipping quoted per destination'),
    ),
    h('h2', {}, 'Our products'),
    h('div', { class: 'grid grid-3' }, products.map(productCard)),
  );
}

function productCard(p) {
  return h('a', { href: `#/product/${p.id}`, class: 'product-card', style: 'color:inherit' },
    h('img', { src: p.images[0]?.url || '/assets/lotion-200.jpg', alt: p.images[0]?.alt || p.name }),
    h('div', { class: 'body' },
      h('div', { class: 'row' },
        h('h3', {}, p.name),
        p.sold_out ? h('span', { class: 'badge badge-danger' }, 'Sold out') : null,
      ),
      p.category ? h('div', { class: 'small muted' }, p.category) : null,
      p.average_rating ? h('div', { class: 'small' }, stars(p.average_rating), ` ${p.average_rating} (${p.review_count})`) : null,
      h('div', { class: 'row', style: 'margin-top:auto' },
        h('span', { class: 'price' },
          p.price_min_minor != null
            ? (p.price_min_minor === p.price_max_minor
              ? money(p.price_min_minor, settings.currency)
              : `${money(p.price_min_minor, settings.currency)} +`)
            : '—'),
        h('span', { class: 'badge badge-amber' }, 'View options'),
      ),
    ),
  );
}

/* ---------------- catalog (CAT-06 filtering) ---------------- */

async function pageCatalog() {
  // Filters live in the hash query string (e.g. #/catalog?color=...); the route
  // pattern has no capture groups, so read them from location.hash directly.
  const params = new URLSearchParams((location.hash.split('?')[1]) || '');
  const [products, facets, categories] = await Promise.all([
    api('GET', '/api/public/products'),
    api('GET', '/api/public/facets'),
    api('GET', '/api/public/categories'),
  ]);

  const filters = {
    category: params.get('category') || '',
    size: params.get('size') || '',
    color: params.get('color') || '',
    scent: params.get('scent') || '',
    q: params.get('q') || '',
  };

  const apply = () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    location.hash = `#/catalog?${qs.toString()}`;
  };

  const selectField = (label, key, options, valueKey = 'id', labelKey = 'name') =>
    h('div', { class: 'field' },
      h('label', {}, label),
      h('select', {
        onchange: (e) => { filters[key] = e.target.value; apply(); },
      },
        h('option', { value: '' }, 'All'),
        options.map((o) => h('option', { value: o[valueKey], selected: String(o[valueKey]) === String(filters[key]) }, o[labelKey])),
      ),
    );

  let visible = products;
  if (filters.category) visible = visible.filter((p) => String(p.category_id) === filters.category);
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    visible = visible.filter((p) => p.name.toLowerCase().includes(needle) || p.item_code.toLowerCase().includes(needle));
  }
  // Option filters match products that have a configured combination with those values (CAT-02).
  if (filters.size || filters.color || filters.scent) {
    const detailCache = await Promise.all(visible.map((p) => api('GET', `/api/public/products/${p.id}`)));
    visible = visible.filter((p, i) => detailCache[i].combinations.some((c) =>
      (!filters.size || c.size === filters.size) &&
      (!filters.color || c.color === filters.color) &&
      (!filters.scent || c.scent === filters.scent)));
  }

  render(
    h('h1', {}, 'Shop'),
    h('div', { class: 'filter-bar' },
      h('div', { class: 'field', style: 'flex:2' },
        h('label', {}, 'Search'),
        h('input', {
          value: filters.q, placeholder: 'Product name or code…',
          onchange: (e) => { filters.q = e.target.value; apply(); },
        }),
      ),
      selectField('Category', 'category', categories),
      selectField('Size', 'size', facets.sizes.map((s) => ({ id: s, name: s }))),
      selectField('Color', 'color', facets.colors.map((s) => ({ id: s, name: s }))),
      selectField('Scent', 'scent', facets.scents.map((s) => ({ id: s, name: s }))),
      h('button', {
        class: 'btn btn-secondary', onclick: () => {
          location.hash = '#/catalog';
        },
      }, 'Clear filters'),
    ),
    h('p', { class: 'muted small' }, `${visible.length} product${visible.length === 1 ? '' : 's'} shown. Only configured options and valid combinations are available.`),
    visible.length
      ? h('div', { class: 'grid grid-3' }, visible.map(productCard))
      : h('div', { class: 'empty' }, 'No products match these filters.'),
  );
}

/* ---------------- product detail (CAT-02/03, AC-01..03) ---------------- */

async function pageProduct(id) {
  const p = await api('GET', `/api/public/products/${id}`);
  const currency = settings.currency;

  // Option picker state: exact configured combination selection.
  const attrs = [
    { key: 'size', label: 'Size', values: [...new Set(p.combinations.map((c) => c.size))] },
    { key: 'color', label: 'Color', values: [...new Set(p.combinations.map((c) => c.color))] },
    { key: 'scent', label: 'Scent', values: [...new Set(p.combinations.map((c) => c.scent))] },
  ].filter((a) => a.values.length > 0);

  // Start from the first available (non-sold-out) combination.
  const initial = p.combinations.find((c) => !c.sold_out) || p.combinations[0];
  const selection = {};
  for (const a of attrs) selection[a.key] = initial ? initial[a.key] : a.values[0];

  let qty = 1;
  let imageIdx = 0;
  const infoEl = h('div', {});
  const pickersEl = h('div', {});

  function currentCombo() {
    return p.combinations.find((c) => attrs.every((a) => c[a.key] === selection[a.key]));
  }

  function candidatesFor(attrKey) {
    // Offer a value only if it completes a configured combination given other selections (CAT-02).
    return [...new Set(p.combinations
      .filter((c) => attrs.every((a) => a.key === attrKey || c[a.key] === selection[a.key]))
      .map((c) => c[attrKey]))];
  }

  function snapToValid(changedKey) {
    if (currentCombo()) return;
    const match = p.combinations.find((c) => c[changedKey] === selection[changedKey]);
    if (match) for (const a of attrs) selection[a.key] = match[a.key];
  }

  function renderPickers() {
    clear(pickersEl);
    for (const attr of attrs) {
      const single = attr.values.length === 1;
      const options = candidatesFor(attr.key);
      if (single) {
        // AC-01: one configured value — show it without suggesting choices exist.
        pickersEl.append(h('div', { class: 'option-group' },
          h('label', {}, attr.label),
          h('div', { class: 'label-static' }, selection[attr.key] || attr.values[0])));
        continue;
      }
      pickersEl.append(h('div', { class: 'option-group' },
        h('label', {}, attr.label),
        h('select', {
          onchange: (e) => {
            selection[attr.key] = e.target.value;
            snapToValid(attr.key);
            renderPickers();
            renderInfo();
          },
        },
          options.map((v) => {
            const sold = p.combinations.filter((c) => attrs.every((a) => a.key === attr.key || c[a.key] === selection[a.key]) && c[attr.key] === v)
              .every((c) => c.sold_out);
            return h('option', { value: v, selected: v === selection[attr.key] }, sold ? `${v} — Sold out` : v);
          }),
        ),
      ));
    }
    const combo = currentCombo();
    if (combo) {
      pickersEl.append(h('div', { class: 'form-note' },
        combo.sku ? `SKU: ${combo.sku}` : '',
        combo.size_ml ? ` · Exact volume: ${combo.size_ml} ml` : ''));
    }
  }

  function renderInfo() {
    const combo = currentCombo();
    clear(infoEl);
    if (!combo) {
      infoEl.append(h('div', { class: 'notice notice-amber' }, 'This combination is not available.'));
      return;
    }
    const wasPrice = combo.price_minor;
    infoEl.append(
      h('div', { class: 'price', style: 'font-size:1.5rem' }, money(combo.price_minor, currency)),
      h('p', {},
        combo.sold_out
          ? h('span', { class: 'badge badge-danger' }, 'Sold out')
          : h('span', { class: 'badge badge-ok' }, `Available — ${combo.available_qty} in stock`),
        combo.low_stock && !combo.sold_out ? h('span', { class: 'badge badge-amber', style: 'margin-left:8px' }, 'Low stock') : null,
      ),
      h('div', { class: 'qty-row' },
        h('div', {},
          h('label', {}, 'Quantity'),
          h('input', {
            type: 'number', min: 1, max: 99, value: qty,
            onchange: (e) => { qty = Math.max(1, Math.min(99, Number(e.target.value) || 1)); e.target.value = qty; },
          }),
        ),
        h('button', {
          class: 'btn btn-amber', disabled: combo.sold_out,
          onclick: () => {
            addLine(combo.id, qty);
            flash(infoEl, `Added ${qty} × ${p.name} (${optionText(combo)}) to your request.`, 'notice notice-ok');
            renderHeader();
          },
        }, combo.sold_out ? 'Sold out' : 'Add to request'),
        h('a', { href: '#/order', class: 'btn btn-secondary' }, 'Review request'),
      ),
    );
    void wasPrice;
  }

  render(
    h('p', { class: 'small' }, h('a', { href: '#/catalog' }, '← Back to shop')),
    h('div', { class: 'pdp' },
      h('div', { class: 'gallery' },
        h('img', { src: p.images[imageIdx]?.url || '/assets/lotion-200.jpg', alt: p.images[imageIdx]?.alt || p.name }),
        p.images.length > 1 ? h('div', { class: 'thumbs' },
          p.images.map((img, i) => h('img', {
            src: img.url, alt: img.alt, class: i === imageIdx ? 'active' : '',
            onclick: () => { imageIdx = i; route(); },
          })),
        ) : null,
      ),
      h('div', {},
        h('h1', {}, p.name),
        p.category ? h('p', { class: 'muted small' }, p.category, ' · ', p.item_code) : h('p', { class: 'muted small' }, p.item_code),
        p.average_rating
          ? h('p', { class: 'small' }, stars(p.average_rating), ` ${p.average_rating} / 5 · ${p.review_count} review${p.review_count === 1 ? '' : 's'}`)
          : h('p', { class: 'small muted' }, 'No reviews yet'),
        h('p', {}, p.description),
        pickersEl,
        infoEl,
        h('details', { class: 'acc', open: true }, h('summary', {}, 'How to use'), h('p', {}, p.usage_instructions)),
        h('details', { class: 'acc' }, h('summary', {}, 'Ingredients'), h('p', {}, p.ingredients)),
        h('div', { class: 'notice' }, 'Shipping costs depend on your destination and are confirmed separately — no shipping fee is shown or calculated on this website.'),
      ),
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Customer reviews'),
      p.reviews.length
        ? p.reviews.map((r) => h('div', { class: 'review' },
          h('div', { class: 'small' }, stars(r.rating), ` — `, h('strong', {}, r.author_name), h('span', { class: 'muted' }, ` · ${dateFmt(r.published_at || r.created_at)}`)),
          h('p', {}, r.body),
        ))
        : h('p', { class: 'muted' }, 'No published reviews yet.'),
      reviewForm(p.id),
    ),
  );

  renderPickers();
  renderInfo();
}

function reviewForm(productId) {
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        const res = await api('POST', '/api/public/reviews', {
          product_id: productId,
          author_name: fd.get('author_name'),
          author_email: fd.get('author_email'),
          rating: Number(fd.get('rating')),
          body: fd.get('body'),
        });
        clear(form).append(h('div', { class: 'notice notice-ok' }, res.message));
      } catch (err) {
        flash(form, err.message, 'notice notice-danger');
      }
    },
  },
    h('h3', {}, 'Write a review'),
    h('div', { class: 'form-row' },
      h('div', {}, h('label', {}, 'Your name'), h('input', { name: 'author_name', required: true })),
      h('div', {}, h('label', {}, 'Email (optional, not published)'), h('input', { name: 'author_email', type: 'email' })),
      h('div', {}, h('label', {}, 'Rating'), h('select', { name: 'rating' },
        [5, 4, 3, 2, 1].map((n) => h('option', { value: n, selected: n === 5 }, `${n} star${n > 1 ? 's' : ''}`)),
      )),
    ),
    h('label', {}, 'Your review'), h('textarea', { name: 'body', required: true, maxlength: 5000 }),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Submit review')),
    h('p', { class: 'form-note' }, 'Reviews are published once approved by our team.'),
  );
  return form;
}

/* ---------------- order request builder (ORD-01/02) ---------------- */

async function pageOrder() {
  const cart = getCart();
  if (!cart.length) {
    render(h('h1', {}, 'Your order request'),
      h('div', { class: 'empty' }, 'Your request is empty. ', h('a', { href: '#/catalog' }, 'Browse products'), ' to get started.'));
    return;
  }

  // Load full product data for each cart line (server-side pricing re-checked at submit).
  const combos = new Map();
  const products = await api('GET', '/api/public/products');
  for (const p of products) {
    const detail = await api('GET', `/api/public/products/${p.id}`);
    for (const c of detail.combinations) combos.set(c.id, { ...c, product: detail });
  }

  const linesEl = h('div', {});
  const summaryEl = h('div', {});
  let promoInput = '';

  function renderLines() {
    const cartNow = getCart();
    clear(linesEl);
    if (!cartNow.length) { route(); return; }
    linesEl.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Product'), h('th', {}, 'Options'), h('th', {}, 'Unit price'),
        h('th', {}, 'Qty'), h('th', {}, 'Line total'), h('th', {}, ''),
      )),
      h('tbody', {}, cartNow.map((line) => {
        const c = combos.get(line.combination_id);
        if (!c) return null;
        return h('tr', {},
          h('td', {}, h('a', { href: `#/product/${c.product.id}` }, c.product.name), h('div', { class: 'small muted' }, c.product.item_code)),
          h('td', { class: 'small' }, optionText(c)),
          h('td', {}, money(c.price_minor, settings.currency)),
          h('td', {}, h('input', {
            type: 'number', min: 0, max: 99, value: line.qty, style: 'width:72px',
            onchange: (e) => { setQty(line.combination_id, Number(e.target.value) || 0); renderLines(); renderSummary(); renderHeader(); },
          })),
          h('td', {}, money(c.price_minor * line.qty, settings.currency)),
          h('td', {}, h('button', {
            class: 'btn btn-secondary btn-small', onclick: () => { setQty(line.combination_id, 0); renderLines(); renderSummary(); renderHeader(); },
          }, 'Remove')),
        );
      }), // end map
    )))); // end tbody, table, div, append
  }

  async function renderSummary() {
    const cartNow = getCart();
    let preview;
    try {
      preview = await api('POST', '/api/public/orders/preview', {
        items: cartNow.map((l) => ({ combination_id: l.combination_id, quantity: l.qty })),
        promo_code: promoInput || undefined,
      });
    } catch (err) {
      clear(summaryEl).append(h('div', { class: 'notice notice-danger' }, err.message));
      return;
    }
    clear(summaryEl).append(h('div', { class: 'card' },
      h('h2', {}, 'Order summary'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'Qty'), h('th', {}, 'Unit'), h('th', {}, 'Discount'), h('th', {}, 'Total'))),
        h('tbody', {}, preview.lines.map((l) => h('tr', {},
          h('td', {}, l.product_name, h('div', { class: 'small muted' }, optionText(l))),
          h('td', {}, l.quantity),
          h('td', {}, money(l.unit_price_minor, settings.currency)),
          h('td', {}, l.discount_minor ? `−${money(l.discount_minor, settings.currency)}` : '—'),
          h('td', {}, money(l.line_total_minor, settings.currency)),
        ))),
      )),
      h('dl', { class: 'kv', style: 'margin-top:14px' },
        h('dt', {}, 'Subtotal'), h('dd', {}, money(preview.items_subtotal_minor, settings.currency)),
        preview.discount_total_minor
          ? [h('dt', {}, 'Discounts'), h('dd', {}, preview.discount_breakdown.map((d) =>
            h('div', {}, `${d.name}${d.code ? ` (${d.code})` : ''}: −${money(d.amount, settings.currency)}`)))]
          : null,
        h('dt', {}, 'Product subtotal'), h('dd', { class: 'price' }, money(preview.product_subtotal_minor, settings.currency)),
        h('dt', {}, 'Shipping'), h('dd', { class: 'muted' }, 'Not calculated — confirmed separately based on your destination'),
      ),
      h('div', { class: 'form-row', style: 'margin-top:12px; align-items:flex-end' },
        h('div', {},
          h('label', {}, 'Promo code (optional)'),
          h('input', {
            value: promoInput, placeholder: 'e.g. WELCOME10',
            onchange: (e) => { promoInput = e.target.value.trim(); renderSummary(); },
          }),
        ),
        h('button', {
          class: 'btn btn-secondary', type: 'button',
          onclick: () => { promoInput = promoInput; renderSummary(); },
        }, 'Apply code'),
      ),
    ));
  }

  const customerForm = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(customerForm);
      const submitBtn = customerForm.querySelector('button[type=submit]');
      submitBtn.disabled = true;
      try {
        const res = await api('POST', '/api/public/orders', {
          customer_name: fd.get('customer_name') || '',
          customer_email: fd.get('customer_email'),
          customer_phone: fd.get('customer_phone'),
          delivery_address: fd.get('delivery_address'),
          promo_code: promoInput || undefined,
          items: getCart().map((l) => ({ combination_id: l.combination_id, quantity: l.qty })),
        });
        clearCart();
        sessionStorage.setItem('eloria_last_order', JSON.stringify(res));
        location.hash = `#/order/done/${res.order_code}`;
      } catch (err) {
        submitBtn.disabled = false;
        flash(customerForm, err.message, 'notice notice-danger');
      }
    },
  },
    h('h2', {}, 'Your details'),
    h('div', { class: 'notice' },
      'We use WhatsApp to confirm your order. Please provide a phone number with WhatsApp enabled — ',
      h('strong', {}, 'we will contact you personally to confirm availability, shipping and the deposit.'),
      ' Note: the website cannot verify whether WhatsApp is installed on your number.'),
    h('div', { class: 'form-row' },
      h('div', {}, h('label', {}, 'Name (optional)'), h('input', { name: 'customer_name' })),
      h('div', {}, h('label', {}, 'Email address'), h('input', { name: 'customer_email', type: 'email', required: true })),
    ),
    h('div', { class: 'form-row' },
      h('div', {}, h('label', {}, 'Phone number (WhatsApp)'), h('input', { name: 'customer_phone', type: 'tel', required: true, placeholder: '+20 1XX XXX XXXX' })),
      h('div', { style: 'flex:2' }, h('label', {}, 'Delivery address'), h('textarea', { name: 'delivery_address', required: true, minlength: 5 }))),
    h('p', { class: 'form-note' }, 'Submitting this form creates an order request only — nothing is charged. Payment and deposit arrangements are made with our team after confirmation.'),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn btn-amber', type: 'submit' }, 'Submit order request'),
    ),
  );

  render(
    h('h1', {}, 'Your order request'),
    linesEl,
    summaryEl,
    customerForm,
  );
  renderLines();
  renderSummary();
}

function pageOrderDone(code) {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('eloria_last_order') || 'null'); } catch { /* ignore */ }
  render(
    h('div', { class: 'card narrow', style: 'margin:30px auto' },
      h('h1', {}, 'Order submitted ✓'),
    h('div', { class: 'notice notice-ok' }, saved?.message || 'Your order has been submitted. Please keep your order code and use it when contacting us about your order. Someone will contact you soon on WhatsApp.'),
      h('p', { class: 'muted small' }, 'Your order code'),
      h('div', { class: 'code-display' }, code),
      h('p', {}, 'Write this code down or take a screenshot — you will need it when contacting us about your order.'),
      h('div', { class: 'form-actions' },
        h('a', { href: `#/lookup?code=${code}`, class: 'btn btn-secondary' }, 'View order status'),
        h('a', { href: '#/catalog', class: 'btn' }, 'Continue shopping'),
      ),
    ),
  );
}

/* ---------------- order status lookup (safe view) ---------------- */

async function pageLookup() {
  const params = new URLSearchParams((location.hash.split('?')[1]) || '');
  const resultEl = h('div', {});
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const code = new FormData(form).get('code').trim().toUpperCase();
      location.hash = `#/lookup?code=${encodeURIComponent(code)}`;
      show(code);
    },
  },
    h('h1', {}, 'Order status'),
    h('p', { class: 'muted' }, 'Enter your order code to see the current status of your request. For privacy, no contact details or payment amounts are shown here.'),
    h('div', { class: 'form-row', style: 'align-items:flex-end' },
      h('div', {}, h('label', {}, 'Order code'), h('input', { name: 'code', required: true, placeholder: 'ELR-XXXXXX', value: params.get('code') || '' })),
      h('button', { class: 'btn', type: 'submit' }, 'Look up'),
    ),
    resultEl,
  );

  async function show(code) {
    clear(resultEl);
    try {
      const order = await api('GET', `/api/public/orders/${code}`);
      resultEl.append(h('div', { class: 'card' },
        h('h2', {}, `Order ${order.order_code}`),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Submitted'), h('dd', {}, dateFmt(order.created_at)),
          h('dt', {}, 'Status'), h('dd', {}, order.state.replace(/_/g, ' ')),
          h('dt', {}, 'Payment'), h('dd', {}, order.payment_state.replace(/_/g, ' ')),
        ),
        h('h3', {}, 'Items'),
        h('ul', {}, order.items.map((i) =>
          h('li', {}, `${i.product_name} — ${optionText(i)} × ${i.quantity}`))),
        h('p', { class: 'form-note' }, 'Questions? Contact us on WhatsApp with your order code.'),
      ));
    } catch {
      resultEl.append(h('div', { class: 'notice notice-danger' }, 'No order was found for that code. Please check the code and try again.'));
    }
  }

  render(form);
  const code = params.get('code');
  if (code) show(code);
}

/* ---------------- content pages ---------------- */

async function pageContent(slug) {
  const page = await api('GET', `/api/public/content/${slug}/html`);
  const div = h('div', { class: 'card narrow', style: 'margin:20px auto' });
  div.append(h('h1', {}, page.title));
  div.append(h('div', { html: page.html }));
  render(div);
}

async function pageContact() {
  const page = await api('GET', `/api/public/content/contact/html`).catch(() => ({ title: 'Contact Us', html: '' }));
  render(h('div', { class: 'card narrow', style: 'margin:20px auto' },
    h('h1', {}, page.title || 'Contact Us'),
    h('div', { html: page.html }),
    h('dl', { class: 'kv' },
      h('dt', {}, 'WhatsApp'), h('dd', {}, settings.whatsapp_number || '—'),
      h('dt', {}, 'Phone'), h('dd', {}, settings.business_phone || '—'),
      h('dt', {}, 'Email'), h('dd', {}, settings.business_email || '—'),
      h('dt', {}, 'Address'), h('dd', {}, settings.business_address || '—'),
      h('dt', {}, 'Hours'), h('dd', {}, settings.business_hours || '—'),
    ),
    h('p', { class: 'form-note' }, 'When contacting us about an existing order, please include your order code.'),
  ));
}

boot();
