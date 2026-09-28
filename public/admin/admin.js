import {
  h, clear, money, dateFmt, api, flash, download,
  stateBadge, paymentBadge, optionText, STATE_LABELS, PAYMENT_LABELS,
} from '../js/ui.js';

const root = document.getElementById('admin-app');
let me = null;
let settingsCache = { currency: 'EGP' };

/* ---------------- auth ---------------- */

async function ensureAuth() {
  try {
    me = await api('GET', '/api/admin/auth/me');
    return true;
  } catch {
    me = null;
    return false;
  }
}

function loginPage() {
  clear(root).append(h('div', { class: 'login-wrap' },
    h('form', {
      class: 'login-card',
      onsubmit: async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api('POST', '/api/admin/auth/login', {
            username: fd.get('username'), password: fd.get('password'),
          });
          route();
        } catch (err) {
          flash(e.target, err.message, 'notice notice-danger');
        }
      },
    },
      h('h1', {}, 'Eloria'),
      h('p', { class: 'muted' }, 'Admin dashboard'),
      h('label', {}, 'Username'), h('input', { name: 'username', required: true, autocomplete: 'username' }),
      h('label', {}, 'Password'), h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Sign in')),
    ),
  ));
}

/* ---------------- shell ---------------- */

function shell(active, title, ...content) {
  const items = [
    ['#/overview', 'Overview'], ['#/orders', 'Orders'], ['#/products', 'Products'],
    ['#/categories', 'Categories'], ['#/inventory', 'Inventory'], ['#/payments', 'Payments'],
    ['#/returns', 'Cancellations & Returns'], ['#/discounts', 'Discounts'], ['#/reviews', 'Reviews'],
    ['#/notifications', 'Notifications'], ['#/settings', 'Settings'],
  ];
  clear(root).append(h('div', { class: 'admin-shell' },
    h('nav', { class: 'admin-nav' },
      h('a', { href: '#/overview', class: 'brand' }, 'Eloria', h('span', {}, ' · '), 'admin'),
      items.map(([href, label]) => h('a', { href, class: active === href ? 'active' : '' }, label)),
      h('div', { class: 'sep' }),
      h('a', { href: '/' }, '← View store'),
      h('a', {
        href: '#', onclick: async (e) => {
          e.preventDefault();
          await api('POST', '/api/admin/auth/logout');
          me = null;
          route();
        },
      }, 'Sign out'),
    ),
    h('main', { class: 'admin-main' },
      h('div', { class: 'admin-top' },
        h('h1', {}, title),
        h('div', { class: 'small muted' }, `Signed in as ${me?.username || 'admin'}`),
      ),
      ...content,
    ),
  ));
}

async function route() {
  if (!await ensureAuth()) return loginPage();
  try { settingsCache = await api('GET', '/api/admin/settings'); } catch { /* defaults */ }
  const hash = (location.hash || '#/overview').split('?')[0];
  window.scrollTo(0, 0);
  const routes = [
    [/^#\/overview/, pageOverview],
    [/^#\/orders\/(\d+)/, pageOrderDetail],
    [/^#\/orders/, pageOrders],
    [/^#\/products\/new/, () => pageProductEditor(null)],
    [/^#\/products\/(\d+)/, pageProductEditor],
    [/^#\/products/, pageProducts],
    [/^#\/categories/, pageCategories],
    [/^#\/inventory/, pageInventory],
    [/^#\/payments/, pagePayments],
    [/^#\/returns/, pageReturns],
    [/^#\/discounts/, pageDiscounts],
    [/^#\/reviews/, pageReviews],
    [/^#\/notifications/, pageNotifications],
    [/^#\/settings/, pageSettings],
  ];
  for (const [pattern, handler] of routes) {
    const match = hash.match(pattern);
    if (match) {
      try {
        await handler(...match.slice(1));
      } catch (err) {
        shell('#/overview', 'Error', h('div', { class: 'notice notice-danger' }, err.message || 'Something went wrong'));
      }
      return;
    }
  }
  location.hash = '#/overview';
}

function currency() { return settingsCache.currency || 'EGP'; }

/* ---------------- overview (REP-01/02/03) ---------------- */

async function pageOverview() {
  const data = await api('GET', '/api/admin/reports/overview');
  const notifs = await api('GET', '/api/admin/notifications');
  const c = currency();
  const m = data.money;
  const n = data.counts;

  const stat = (label, value, sub, href) =>
    h('a', { class: 'stat', href, style: 'color:inherit' },
      h('div', { class: 'label' }, label),
      h('div', { class: 'value' }, value),
      sub ? h('div', { class: 'sub' }, sub) : null);

  shell('#/overview', 'Overview',
    h('p', { class: 'muted small' }, 'Counts clearly distinguish orders from units. Money figures are agreed revenue and collected payments — not profit (cost basis is not tracked).'),

    h('h2', {}, 'Orders & fulfilment'),
    h('div', { class: 'stat-grid' },
      stat('Pending orders', n.pending_orders, `${n.pending_units} units`, '#/orders?state=pending'),
      stat('In fulfilment (on the way)', n.on_the_way_orders, `${n.on_the_way_units} units — confirmed / dispatched / refused`, '#/orders?state=confirmed,on_the_way,refused'),
      stat('Delivered', n.delivered_orders, `${n.delivered_units} units delivered`, '#/orders?state=delivered'),
      stat('Available inventory', n.available_units, 'units across all combinations', '#/inventory'),
    ),

    h('h2', {}, 'Money (agreed revenue & collected payments)'),
    h('div', { class: 'stat-grid' },
      stat('Agreed order totals', money(m.revenue_agreed_minor, c), 'excludes cancelled & pending', '#/orders'),
      stat('Collected payments', money(m.collected_minor, c), 'deposits + balances recorded', '#/payments'),
      stat('Outstanding balances', money(m.outstanding_minor, c), 'agreed minus collected', '#/payments'),
      stat('Retained deposits', money(m.retained_deposits_minor, c), 'refused deliveries (kept per policy)', '#/payments?type=outcome_deposit_retained'),
    ),

    h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' },
        h('h3', {}, 'Revenue by item code'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Item code'), h('th', {}, 'Product'), h('th', {}, 'Units'), h('th', {}, 'Orders'), h('th', {}, 'Revenue (agreed)'))),
          h('tbody', {}, data.revenue_by_item.map((r) => h('tr', {},
            h('td', { class: 'mono' }, r.item_code), h('td', {}, r.product_name),
            h('td', {}, r.units), h('td', {}, r.orders), h('td', {}, money(r.revenue_minor, c)),
          ))),
        )),
        h('div', { class: 'form-actions' },
          h('button', {
            class: 'btn btn-secondary btn-small',
            onclick: () => download('/api/admin/reports/export.xlsx', 'eloria-overview.xlsx').catch((e) => alert(e.message)),
          }, 'Export Excel'),
        ),
      ),
      h('div', { class: 'card' },
        h('h3', {}, 'Revenue by category'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Category'), h('th', {}, 'Units'), h('th', {}, 'Orders'), h('th', {}, 'Revenue (agreed)'))),
          h('tbody', {}, data.revenue_by_category.map((r) => h('tr', {},
            h('td', {}, r.category), h('td', {}, r.units), h('td', {}, r.orders), h('td', {}, money(r.revenue_minor, c)),
          ))),
        )),
        h('h3', { style: 'margin-top:18px' }, 'Inventory detail (drill-down)'),
        h('p', { class: 'small muted' }, `The ${n.available_units} available units are made up of:`),
        h('div', { class: 'table-wrap', style: 'max-height:220px; overflow:auto' }, h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Combination'), h('th', {}, 'Available'), h('th', {}, 'On the way'), h('th', {}, 'Delivered'))),
          h('tbody', {}, (await api('GET', '/api/admin/reports/breakdown/available-units')).map((r) => h('tr', {},
            h('td', { class: 'small' }, `${r.product_name} — ${optionText(r)}`),
            h('td', {}, r.stock_qty), h('td', {}, r.on_the_way), h('td', {}, r.delivered),
          ))),
        )),
      ),
    ),

    h('div', { class: 'card' },
      h('h3', {}, `Alerts & notifications (${notifs.unread} unread)`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('tbody', {}, notifs.items.slice(0, 6).map((nt) => h('tr', {},
          h('td', { style: 'width:110px' }, h('span', { class: nt.type === 'low_stock' ? 'badge badge-amber' : 'badge' }, nt.type.replace(/_/g, ' '))),
          h('td', {}, nt.title, h('div', { class: 'small muted' }, nt.body.slice(0, 120))),
          h('td', { class: 'small muted', style: 'width:140px' }, dateFmt(nt.created_at)),
        ))),
      )),
      h('a', { href: '#/notifications', class: 'btn btn-secondary btn-small' }, 'View all notifications'),
    ),
  );
}

/* ---------------- orders list ---------------- */

function currentQuery() {
  return new URLSearchParams(location.hash.split('?')[1] || '');
}

async function pageOrders() {
  const q = currentQuery();
  const filters = {
    state: q.get('state') || '',
    payment_state: q.get('payment_state') || '',
    q: q.get('q') || '',
    date_field: q.get('date_field') || 'created',
    date_from: q.get('date_from') || '',
    date_to: q.get('date_to') || '',
  };
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const data = await api('GET', `/api/admin/orders?${query}`);
  const c = currency();

  const apply = () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    location.hash = `#/orders?${qs}`;
  };

  const sel = (label, key, options, valueKey, labelKey) => h('div', { class: 'field' },
    h('label', {}, label),
    h('select', { onchange: (e) => { filters[key] = e.target.value; apply(); } },
      h('option', { value: '' }, 'All'),
      options.map((o) => h('option', { value: o[valueKey], selected: String(o[valueKey]) === String(filters[key]) }, o[labelKey])),
    ),
  );

  shell('#/orders', 'Orders',
    h('div', { class: 'filter-bar' },
      h('div', { class: 'field', style: 'flex:2' },
        h('label', {}, 'Search (code, customer, email, phone)'),
        h('input', { value: filters.q, onchange: (e) => { filters.q = e.target.value; apply(); } }),
      ),
      sel('State', 'state', Object.entries(STATE_LABELS).map(([k, v]) => ({ valueKey: k, name: v })), 'valueKey', 'name'),
      sel('Payment state', 'payment_state', Object.entries(PAYMENT_LABELS).map(([k, v]) => ({ valueKey: k, name: v })), 'valueKey', 'name'),
      sel('Date filter', 'date_field', [
        { valueKey: 'created', name: 'Request date' },
        { valueKey: 'payment', name: 'Payment date' },
        { valueKey: 'delivery', name: 'Delivery date' },
      ], 'valueKey', 'name'),
      h('div', { class: 'field' }, h('label', {}, 'From'), h('input', { type: 'date', value: filters.date_from, onchange: (e) => { filters.date_from = e.target.value; apply(); } })),
      h('div', { class: 'field' }, h('label', {}, 'To'), h('input', { type: 'date', value: filters.date_to, onchange: (e) => { filters.date_to = e.target.value; apply(); } })),
      h('button', {
        class: 'btn btn-secondary',
        onclick: () => download(`/api/admin/orders/export.xlsx?${query}`, 'eloria-orders.xlsx').catch((e) => alert(e.message)),
      }, 'Export Excel'),
    ),
    h('p', { class: 'muted small' }, `Date filters use the ${data.date_field.label}. Export reflects the current filters.`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Code'), h('th', {}, 'Requested'), h('th', {}, 'State'), h('th', {}, 'Payment'),
        h('th', {}, 'Customer'), h('th', {}, 'Units'), h('th', {}, 'Agreed'), h('th', {}, 'Collected'),
      )),
      h('tbody', {}, data.items.map((o) => h('tr', {
        class: 'clickable', onclick: () => { location.hash = `#/orders/${o.id}`; },
      },
        h('td', { class: 'mono' }, o.order_code),
        h('td', { class: 'small' }, dateFmt(o.created_at)),
        h('td', {}, stateBadge(o.state)),
        h('td', {}, paymentBadge(o.payment_state)),
        h('td', {}, o.customer_name || o.customer_email, h('div', { class: 'small muted' }, o.customer_phone)),
        h('td', {}, o.units),
        h('td', {}, o.agreed_total_minor ? money(o.agreed_total_minor, c) : '—'),
        h('td', {}, o.collected_minor ? money(o.collected_minor, c) : '—'),
      ))),
    )),
  );
}

/* ---------------- order detail + workflow actions ---------------- */

async function pageOrderDetail(id) {
  const o = await api('GET', `/api/admin/orders/${id}`);
  const c = currency();

  const actionCard = h('div', { class: 'card' });
  renderActions();

  function reload() {
    api('GET', `/api/admin/orders/${id}`).then((fresh) => {
      Object.assign(o, fresh);
      route();
    }).catch((e) => alert(e.message));
  }

  function renderActions() {
    clear(actionCard);
    actionCard.append(h('h2', {}, 'Actions'));

    const insufficientBox = h('div', {});

    if (o.state === 'pending') {
      const form = h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          const fd = new FormData(form);
          try {
            await api('POST', `/api/admin/orders/${id}/confirm-deposit`, {
              agreed_total: fd.get('agreed_total'),
              deposit_amount: fd.get('deposit_amount'),
              shipping_total: fd.get('shipping_total') || 0,
              notes: fd.get('notes') || '',
              dispatch_now: fd.get('dispatch_now') === 'on',
            });
            reload();
          } catch (err) {
            if (err.details?.insufficient) {
              clear(insufficientBox).append(h('div', { class: 'notice notice-danger' },
                h('strong', {}, 'Insufficient stock — confirmation blocked.'),
                h('ul', {}, err.details.insufficient.map((i) =>
                  h('li', {}, `${i.product_name} (${i.options}): requested ${i.requested}, available ${i.available}`)))));
            } else {
              flash(actionCard, err.message, 'notice notice-danger');
            }
          }
        },
      },
        h('h3', {}, 'Confirm deposit & enter fulfilment flow'),
        h('p', { class: 'small muted' }, 'This checks stock and deducts quantities atomically. Pending requests have not reserved anything.'),
        insufficientBox,
        h('div', { class: 'form-row' },
          h('div', {}, h('label', {}, `Agreed order total (${c})`), h('input', { name: 'agreed_total', required: true, placeholder: 'e.g. 300.00' })),
          h('div', {}, h('label', {}, `Deposit received (${c})`), h('input', { name: 'deposit_amount', required: true, placeholder: 'e.g. 100.00' })),
          h('div', {}, h('label', {}, `Shipping added to total (${c}, optional)`), h('input', { name: 'shipping_total', placeholder: '0.00' })),
        ),
        h('label', {}, 'Payment notes (optional)'), h('textarea', { name: 'notes' }),
        h('label', { style: 'display:flex; gap:8px; align-items:center; font-weight:400' },
          h('input', { type: 'checkbox', name: 'dispatch_now', style: 'width:auto' }), 'Mark as dispatched immediately (skip the awaiting-dispatch stage)'),
        h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Confirm deposit')),
      );
      actionCard.append(form);
      actionCard.append(h('h3', { style: 'margin-top:20px' }, 'Cancel request'),
        quickForm(`/api/admin/orders/${id}/cancel`, 'Cancel (no payment)', {
          outcome: 'Cancelled before payment', note: '',
        }, [{ name: 'note', label: 'Note (optional)', type: 'text' }], 'btn-danger'));
    } else if (o.state === 'confirmed') {
      actionCard.append(
        h('p', {}, stateBadge(o.state), ' — deposit confirmed, awaiting dispatch.'),
        h('div', { class: 'form-actions' },
          h('button', { class: 'btn', onclick: () => post('/api/admin/orders/' + id + '/mark-dispatched') }, 'Mark dispatched'),
          h('button', { class: 'btn btn-secondary', onclick: () => post('/api/admin/orders/' + id + '/mark-delivered') }, 'Mark delivered'),
          h('button', { class: 'btn btn-danger', onclick: () => post('/api/admin/orders/' + id + '/record-refusal', { note: '' }) }, 'Record delivery refusal'),
        ),
      );
    } else if (o.state === 'on_the_way') {
      actionCard.append(
        h('p', {}, stateBadge(o.state)),
        h('div', { class: 'form-actions' },
          h('button', { class: 'btn', onclick: () => post('/api/admin/orders/' + id + '/mark-delivered') }, 'Mark delivered'),
          h('button', { class: 'btn btn-danger', onclick: () => post('/api/admin/orders/' + id + '/record-refusal', { note: '' }) }, 'Record delivery refusal'),
        ),
      );
    } else if (o.state === 'delivered') {
      actionCard.append(
        h('p', {}, stateBadge(o.state), ' — payment is NOT automatically marked fully paid.'),
        h('div', { class: 'form-actions' },
          h('button', { class: 'btn btn-danger', onclick: () => post('/api/admin/orders/' + id + '/record-refusal', { note: '' }) }, 'Record refusal (unusual after delivery)'),
        ),
      );
    } else if (o.state === 'refused') {
      actionCard.append(
        h('div', { class: 'notice notice-amber' },
          'Delivery refused. The deposit is retained and the balance is not collected. ',
          h('strong', {}, 'Stock is restored only when the item is physically received back — record the return below.')),
        returnForm(),
      );
    } else if (o.state === 'returned') {
      actionCard.append(h('div', { class: 'notice notice-ok' }, 'Return recorded. Stock restored for resalable quantities.'));
    } else if (o.state === 'cancelled') {
      actionCard.append(h('div', { class: 'notice' }, 'This order was cancelled before payment. Inventory was not affected.'));
    }

    if (!['cancelled', 'pending'].includes(o.state) && o.payment_state !== 'fully_paid') {
      actionCard.append(paymentForm());
    }

    // Notes
    const notesForm = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        await api('POST', `/api/admin/orders/${id}/notes`, { notes: new FormData(notesForm).get('notes') });
        reload();
      },
    },
      h('h3', { style: 'margin-top:20px' }, 'Order notes'),
      h('textarea', { name: 'notes' }, o.notes || ''),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-secondary', type: 'submit' }, 'Save notes')),
    );
    actionCard.append(notesForm);
  }

  function paymentForm() {
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        try {
          await api('POST', `/api/admin/orders/${id}/record-payment`, {
            type: fd.get('type'), amount: fd.get('amount'), note: fd.get('note') || '',
          });
          reload();
        } catch (err) { flash(actionCard, err.message, 'notice notice-danger'); }
      },
    },
      h('h3', { style: 'margin-top:20px' }, 'Record payment'),
      h('div', { class: 'form-row' },
        h('div', {}, h('label', {}, 'Type'),
          h('select', { name: 'type' },
            h('option', { value: 'balance' }, 'Remaining balance'),
            h('option', { value: 'full' }, 'Full payment'),
            h('option', { value: 'deposit' }, 'Additional deposit'),
          )),
        h('div', {}, h('label', {}, `Amount (${c})`), h('input', { name: 'amount', required: true })),
      ),
      h('label', {}, 'Note (optional)'), h('input', { name: 'note' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Record payment')),
    );
    return form;
  }

  function returnForm() {
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const items = o.lines.map((l) => {
          const qty = Number(fd.get(`qty_${l.id}`));
          return qty > 0 ? { order_line_id: l.id, quantity: qty, restore: fd.get(`restore_${l.id}`) === 'on' } : null;
        }).filter(Boolean);
        if (!items.length) return flash(form, 'Enter at least one returned quantity.', 'notice notice-danger');
        try {
          await api('POST', `/api/admin/orders/${id}/return`, {
            items,
            date_received: fd.get('date_received'),
            outcome: fd.get('outcome'),
            deposit_outcome: fd.get('deposit_outcome'),
            note: fd.get('note') || '',
          });
          reload();
        } catch (err) { flash(form, err.message, 'notice notice-danger'); }
      },
    },
      h('h3', {}, 'Record physical return received'),
      h('p', { class: 'small muted' }, 'Stock is restored only for quantities marked resalable. For post-delivery returns the deposit treatment is your explicit decision (see docs/DECISIONS.md).'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'Ordered'), h('th', {}, 'Returned qty'), h('th', {}, 'Restore to stock'))),
        h('tbody', {}, o.lines.map((l) => h('tr', {},
          h('td', {}, l.product_name, h('div', { class: 'small muted' }, optionText(l))),
          h('td', {}, l.quantity),
          h('td', {}, h('input', { type: 'number', name: `qty_${l.id}`, min: 0, max: l.quantity, value: l.quantity, style: 'width:84px' })),
          h('td', { style: 'text-align:center' }, h('input', { type: 'checkbox', name: `restore_${l.id}`, checked: true, style: 'width:auto' })),
        ))),
      )),
      h('div', { class: 'form-row' },
        h('div', {}, h('label', {}, 'Date received'), h('input', { type: 'date', name: 'date_received', value: new Date().toISOString().slice(0, 10) })),
        h('div', {}, h('label', {}, 'Outcome'),
          h('select', { name: 'outcome' },
            h('option', { value: 'Item received back (refused delivery)' }, 'Item received back (refused delivery)'),
            h('option', { value: 'Accepted post-delivery return' }, 'Accepted post-delivery return'),
            h('option', { value: 'Damaged / not resalable' }, 'Damaged / not resalable'),
          ),
        ),
        h('div', {}, h('label', {}, 'Deposit outcome'),
          h('select', { name: 'deposit_outcome' },
            h('option', { value: 'Deposit retained (refused delivery rule)' }, 'Deposit retained (refused delivery rule)'),
            h('option', { value: 'Refund issued' }, 'Refund issued'),
            h('option', { value: 'Refund pending — to be agreed' }, 'Refund pending — to be agreed'),
            h('option', { value: 'Exchange issued' }, 'Exchange issued'),
            h('option', { value: 'Not applicable' }, 'Not applicable'),
          ),
        ),
      ),
      h('label', {}, 'Note'), h('input', { name: 'note' }),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Record return')),
    );
    return form;
  }

  async function post(url, body) {
    try {
      await api('POST', url, body ?? {});
      reload();
    } catch (err) { alert(err.message); }
  }

  function quickForm(url, label, defaults, fields, btnCls = 'btn') {
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        try {
          await api('POST', url, { ...defaults, ...Object.fromEntries(fields.map((f) => [f.name, fd.get(f.name)])) });
          reload();
        } catch (err) { flash(form, err.message, 'notice notice-danger'); }
      },
    });
    for (const f of fields) {
      form.append(h('label', {}, f.label), h('input', { name: f.name }));
    }
    form.append(h('div', { class: 'form-actions' }, h('button', { class: `btn ${btnCls}`, type: 'submit' }, label)));
    return form;
  }

  const c2 = currency();
  shell('#/orders', `Order ${o.order_code}`,
    h('p', {}, h('a', { href: '#/orders' }, '← All orders'), ' ', stateBadge(o.state), ' ', paymentBadge(o.payment_state)),

    h('div', { class: 'state-flow' },
      ['pending', 'confirmed', 'on_the_way', 'delivered'].map((s) =>
        h('span', { class: `step ${o.state === s ? 'current' : ''}` }, STATE_LABELS[s])),
      ['refused', 'returned', 'cancelled'].includes(o.state)
        ? h('span', { class: 'step current' }, STATE_LABELS[o.state]) : null,
    ),

    h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' },
        h('h2', {}, 'Customer & delivery'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Name'), h('dd', {}, o.customer_name || '—'),
          h('dt', {}, 'Email'), h('dd', {}, o.customer_email),
          h('dt', {}, 'Phone / WhatsApp'), h('dd', {}, o.customer_phone),
          h('dt', {}, 'Delivery address'), h('dd', {}, o.delivery_address),
          h('dt', {}, 'Requested'), h('dd', {}, dateFmt(o.created_at)),
          h('dt', {}, 'Confirmed'), h('dd', {}, dateFmt(o.confirmed_at)),
          h('dt', {}, 'Delivered'), h('dd', {}, dateFmt(o.delivered_at)),
        ),
      ),
      h('div', { class: 'card' },
        h('h2', {}, 'Totals'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Items subtotal'), h('dd', {}, money(o.items_subtotal_minor, c2)),
          h('dt', {}, 'Discounts'), h('dd', {}, o.discount_total_minor ? `−${money(o.discount_total_minor, c2)}` : '—'),
          h('dt', {}, 'Shipping (added by admin)'), h('dd', {}, o.shipping_minor ? money(o.shipping_minor, c2) : '—'),
          h('dt', {}, 'Agreed order total'), h('dd', { class: 'price' }, o.agreed_total_minor ? money(o.agreed_total_minor, c2) : '—'),
          h('dt', {}, 'Collected so far'), h('dd', {}, money(o.collected_minor, c2)),
          h('dt', {}, 'Remaining balance'), h('dd', {}, o.payment_state === 'deposit_retained' ? 'Not collected (delivery refused)' : money(o.balance_minor, c2)),
        ),
      ),
    ),

    h('div', { class: 'card' },
      h('h2', {}, 'Items (snapshot at request time)'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Product'), h('th', {}, 'Options'), h('th', {}, 'Unit price'), h('th', {}, 'Qty'), h('th', {}, 'Discount'), h('th', {}, 'Line total'))),
        h('tbody', {}, o.lines.map((l) => h('tr', {},
          h('td', {}, l.product_name, h('div', { class: 'small muted mono' }, l.item_code)),
          h('td', { class: 'small' }, optionText(l)),
          h('td', {}, money(l.unit_price_minor, c2)),
          h('td', {}, l.quantity),
          h('td', {}, l.discount_minor ? `−${money(l.discount_minor, c2)}` : '—'),
          h('td', {}, money(l.line_total_minor, c2)),
        ))),
      )),
    ),

    h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' },
        h('h2', {}, 'Payment records'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Type'), h('th', {}, 'Amount'), h('th', {}, 'Note'))),
          h('tbody', {}, o.payments.map((p) => h('tr', {},
            h('td', { class: 'small' }, dateFmt(p.created_at)),
            h('td', {}, h('span', { class: p.type.startsWith('outcome') ? 'badge badge-muted' : 'badge badge-ok' }, p.type.replace(/_/g, ' '))),
            h('td', {}, p.amount_minor ? money(p.amount_minor, c2) : '—'),
            h('td', { class: 'small' }, p.note),
          ))),
        )),
      ),
      h('div', { class: 'card' },
        h('h2', {}, 'Cancellation / return records'),
        o.records.length
          ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Type'), h('th', {}, 'Outcome'), h('th', {}, 'Deposit outcome'))),
            h('tbody', {}, o.records.map((r) => h('tr', {},
              h('td', { class: 'mono' }, r.record_code),
              h('td', {}, r.type),
              h('td', { class: 'small' }, r.outcome, r.date_received ? h('div', { class: 'small muted' }, `Received: ${r.date_received}`) : null),
              h('td', { class: 'small' }, r.deposit_outcome),
            ))),
          ))
          : h('p', { class: 'muted' }, 'No cancellation or return records.'),
      ),
    ),

    actionCard,
  );
}

/* ---------------- products ---------------- */

async function pageProducts() {
  const items = await api('GET', '/api/admin/products');
  shell('#/products', 'Products',
    h('div', { class: 'form-actions', style: 'margin-top:0' },
      h('a', { href: '#/products/new', class: 'btn' }, 'New product'),
      h('button', {
        class: 'btn btn-secondary',
        onclick: () => download('/api/admin/products/export.xlsx', 'eloria-products.xlsx').catch((e) => alert(e.message)),
      }, 'Export Excel'),
    ),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Item code'), h('th', {}, 'Name'), h('th', {}, 'Category'), h('th', {}, 'Combinations'), h('th', {}, 'Total stock'), h('th', {}, 'Status'), h('th', {}, ''))),
      h('tbody', {}, items.map((p) => h('tr', {},
        h('td', { class: 'mono' }, p.item_code),
        h('td', {}, h('a', { href: `#/products/${p.id}` }, p.name)),
        h('td', {}, p.category_name || '—'),
        h('td', {}, p.combination_count),
        h('td', {}, p.stock_total),
        h('td', {}, p.status === 'active' ? h('span', { class: 'badge badge-ok' }, 'Active') : h('span', { class: 'badge badge-muted' }, 'Hidden')),
        h('td', {}, h('a', { href: `#/products/${p.id}`, class: 'btn btn-secondary btn-small' }, 'Edit')),
      ))),
    )),
  );
}

async function pageProductEditor(id) {
  const isNew = !id;
  const [categories] = [await api('GET', '/api/admin/categories')];
  const product = isNew
    ? { name: '', item_code: '', description: '', ingredients: '', usage_instructions: '', category_id: null, status: 'active', images: [], combinations: [] }
    : await api('GET', `/api/admin/products/${id}`);

  const combos = product.combinations.map((c) => ({ ...c, price: (c.price_minor / 100).toFixed(2) }));
  const images = product.images.map((i) => ({ ...i }));

  const comboRowsEl = h('div', {});
  const imageRowsEl = h('div', {});

  function renderComboRows() {
    clear(comboRowsEl);
    comboRowsEl.append(h('div', { class: 'small muted' }, 'Configured combinations only — the website never generates options the admin has not created.'));
    combos.forEach((c, idx) => {
      comboRowsEl.append(h('div', { class: 'combo-editor-row' },
        inputCell(c, 'sku', 'SKU'),
        inputCell(c, 'size_label', 'Size'),
        inputCell(c, 'size_ml', 'ml', 'number'),
        inputCell(c, 'color', 'Color'),
        inputCell(c, 'scent', 'Scent'),
        inputCell(c, 'price', `Price (${currency()})`),
        inputCell(c, 'stock_qty', 'Stock', 'number'),
        inputCell(c, 'low_stock_threshold', 'Low-stock', 'number'),
        h('div', { class: 'small muted', style: 'padding-top:8px' }, c.id ? `#${c.id}` : 'new'),
        h('button', {
          class: 'btn btn-danger btn-small', type: 'button', style: 'margin-top:6px',
          onclick: () => { combos.splice(idx, 1); renderComboRows(); },
        }, '✕'),
      ));
    });
    comboRowsEl.append(h('button', {
      class: 'btn btn-secondary btn-small', type: 'button', style: 'margin-top:8px',
      onclick: () => {
        combos.push({
          sku: `${product.item_code || 'SKU'}-${combos.length + 1}`, size_label: '', size_ml: '',
          color: '', scent: '', price: '0.00', stock_qty: 0, low_stock_threshold: 5,
        });
        renderComboRows();
      },
    }, '+ Add combination'));
  }

  function inputCell(obj, key, placeholder, type = 'text') {
    return h('input', {
      type, value: obj[key] ?? '', placeholder,
      oninput: (e) => { obj[key] = e.target.value; },
    });
  }

  function renderImageRows() {
    clear(imageRowsEl);
    images.forEach((img, idx) => {
      imageRowsEl.append(h('div', { class: 'form-row', style: 'margin-bottom:8px' },
        h('input', { value: img.url, placeholder: 'Image URL (e.g. /assets/lotion-200.jpg)', oninput: (e) => { img.url = e.target.value; } }),
        h('input', { value: img.alt, placeholder: 'Alt text', oninput: (e) => { img.alt = e.target.value; } }),
        h('button', {
          class: 'btn btn-danger btn-small', type: 'button',
          onclick: () => { images.splice(idx, 1); renderImageRows(); },
        }, '✕'),
      ));
    });
    imageRowsEl.append(h('button', {
      class: 'btn btn-secondary btn-small', type: 'button',
      onclick: () => { images.push({ url: '/assets/', alt: '' }); renderImageRows(); },
    }, '+ Add image'));
  }

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        const payload = {
          item_code: fd.get('item_code'), name: fd.get('name'),
          description: fd.get('description'), ingredients: fd.get('ingredients'),
          usage_instructions: fd.get('usage_instructions'),
          category_id: fd.get('category_id') || null,
          status: fd.get('status'),
          images: images.filter((i) => i.url && i.url !== '/assets/'),
          combinations: combos.map((c) => ({
            id: c.id || undefined, sku: c.sku, size_label: c.size_label,
            size_ml: c.size_ml === '' ? null : c.size_ml,
            color: c.color, scent: c.scent, price: c.price,
            stock_qty: c.stock_qty, low_stock_threshold: c.low_stock_threshold,
          })),
        };
        if (isNew) {
          const created = await api('POST', '/api/admin/products', payload);
          location.hash = `#/products/${created.id}`;
        } else {
          await api('PUT', `/api/admin/products/${id}`, payload);
          route();
        }
      } catch (err) {
        flash(form, err.message, 'notice notice-danger');
      }
    },
  },
    h('p', {}, h('a', { href: '#/products' }, '← All products')),
    h('div', { class: 'card' },
      h('h2', {}, isNew ? 'New product' : `Edit ${product.name}`),
      h('div', { class: 'form-row' },
        h('div', {}, h('label', {}, 'Item code'), h('input', { name: 'item_code', required: true, value: product.item_code })),
        h('div', {}, h('label', {}, 'Name'), h('input', { name: 'name', required: true, value: product.name })),
        h('div', {}, h('label', {}, 'Category'),
          h('select', { name: 'category_id' },
            h('option', { value: '' }, '— none —'),
            categories.map((cat) => h('option', { value: cat.id, selected: String(cat.id) === String(product.category_id) }, cat.name)),
          )),
        h('div', {}, h('label', {}, 'Visibility (CAT-04)'),
          h('select', { name: 'status' },
            h('option', { value: 'active', selected: product.status === 'active' }, 'Active — visible on the website'),
            h('option', { value: 'hidden', selected: product.status === 'hidden' }, 'Hidden — removed publicly, data preserved'),
          )),
      ),
      h('label', {}, 'Description'), h('textarea', { name: 'description' }, product.description || ''),
      h('div', { class: 'form-row' },
        h('div', {}, h('label', {}, 'Ingredients'), h('textarea', { name: 'ingredients' }, product.ingredients || '')),
        h('div', {}, h('label', {}, 'Usage instructions'), h('textarea', { name: 'usage_instructions' }, product.usage_instructions || '')),
      ),
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Images'), imageRowsEl,
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Combinations (size · color · scent)'), comboRowsEl,
    ),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn', type: 'submit' }, isNew ? 'Create product' : 'Save changes'),
      h('a', { href: '#/products', class: 'btn btn-secondary' }, 'Cancel'),
    ),
  );

  shell('#/products', isNew ? 'New product' : 'Edit product', form);
  renderComboRows();
  renderImageRows();
}

/* ---------------- categories ---------------- */

async function pageCategories() {
  const items = await api('GET', '/api/admin/categories');
  const listEl = h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Sort'), h('th', {}, 'Products'), h('th', {}, ''))),
    h('tbody', {}, items.map((cat) => h('tr', {},
      h('td', {}, cat.name),
      h('td', {}, cat.sort_order),
      h('td', {}, cat.product_count),
      h('td', {}, h('button', {
        class: 'btn btn-danger btn-small',
        onclick: async () => {
          if (!confirm(`Delete category "${cat.name}"?`)) return;
          await api('DELETE', `/api/admin/categories/${cat.id}`);
          route();
        },
      }, 'Delete')),
    ))),
  ));

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await api('POST', '/api/admin/categories', { name: fd.get('name'), sort_order: fd.get('sort_order') || 0 });
        route();
      } catch (err) { flash(form, err.message, 'notice notice-danger'); }
    },
  },
    h('h3', {}, 'Add category'),
    h('div', { class: 'form-row' },
      h('div', {}, h('label', {}, 'Name'), h('input', { name: 'name', required: true })),
      h('div', {}, h('label', {}, 'Sort order'), h('input', { name: 'sort_order', type: 'number', value: 0 })),
      h('div', { style: 'align-self:end' }, h('button', { class: 'btn', type: 'submit' }, 'Add')),
    ),
  );

  shell('#/categories', 'Categories', form, listEl);
}

/* ---------------- inventory ---------------- */

async function pageInventory() {
  const data = await api('GET', '/api/admin/inventory');
  const c = currency();

  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Product'), h('th', {}, 'SKU'), h('th', {}, 'Options'), h('th', {}, 'Available'),
      h('th', {}, 'On the way'), h('th', {}, 'Delivered'), h('th', {}, 'Threshold'), h('th', {}, 'Alert'), h('th', {}, ''),
    )),
    h('tbody', {},
      data.items.map((row) => h('tr', {},
        h('td', {}, row.product_name, h('div', { class: 'small muted mono' }, row.item_code)),
        h('td', { class: 'small mono' }, row.sku),
        h('td', { class: 'small' }, optionText(row)),
        h('td', { class: 'price' }, row.stock_qty),
        h('td', {}, row.on_the_way),
        h('td', {}, row.delivered),
        h('td', {}, row.low_stock_threshold),
        h('td', {}, row.low_stock_alerted ? h('span', { class: 'badge badge-amber' }, 'LOW') : h('span', { class: 'small muted' }, 'ok')),
        h('td', {},
          h('button', {
            class: 'btn btn-secondary btn-small',
            onclick: async () => {
              const qty = Number(prompt(`Replenish "${row.sku}" — how many units?`));
              if (!qty || qty <= 0) return;
              try {
                await api('POST', `/api/admin/inventory/${row.id}/replenish`, { quantity: qty, note: '' });
                route();
              } catch (e) { alert(e.message); }
            },
          }, 'Replenish'),
          ' ',
          h('button', {
            class: 'btn btn-secondary btn-small',
            onclick: async () => {
              const t = Number(prompt(`Low-stock threshold for "${row.sku}" (current ${row.low_stock_threshold}):`, row.low_stock_threshold));
              if (Number.isNaN(t) || t < 0) return;
              await api('PUT', `/api/admin/inventory/${row.id}/threshold`, { threshold: t });
              route();
            },
          }, 'Threshold'),
        ),
      )),
      h('tr', { class: 'totals-row' },
        h('td', { colspan: 3 }, 'Totals'),
        h('td', {}, data.totals.available_units),
        h('td', {}, data.totals.on_the_way_units),
        h('td', {}, data.totals.delivered_units),
        h('td', { colspan: 3 }),
      ),
    ),
  ));

  shell('#/inventory', 'Inventory',
    h('p', { class: 'muted small' }, 'Available = physical stock ready to sell · On the way = units committed in the fulfilment flow (confirmed / dispatched / refused, awaiting return) · Delivered = units handed to customers. Pending requests never hold stock.'),
    h('div', { class: 'form-actions', style: 'margin-top:0' },
      h('button', {
        class: 'btn btn-secondary',
        onclick: () => download('/api/admin/inventory/export.xlsx', 'eloria-inventory.xlsx').catch((e) => alert(e.message)),
      }, 'Export Excel'),
    ),
    table,
  );
}

/* ---------------- payments ---------------- */

async function pagePayments() {
  const q = currentQuery();
  const filters = {
    order_code: q.get('order_code') || '', type: q.get('type') || '',
    date_from: q.get('date_from') || '', date_to: q.get('date_to') || '',
  };
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const data = await api('GET', `/api/admin/payments?${query}`);
  const c = currency();
  const apply = () => {
    location.hash = `#/payments?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v))}`;
  };

  shell('#/payments', 'Payment records',
    h('div', { class: 'filter-bar' },
      h('div', { class: 'field' }, h('label', {}, 'Order code'), h('input', { value: filters.order_code, onchange: (e) => { filters.order_code = e.target.value; apply(); } })),
      h('div', { class: 'field' }, h('label', {}, 'Type'),
        h('select', { onchange: (e) => { filters.type = e.target.value; apply(); } },
          h('option', { value: '' }, 'All'),
          ['deposit', 'balance', 'full', 'outcome_no_payment', 'outcome_deposit_retained', 'outcome_refund'].map((t) =>
            h('option', { value: t, selected: t === filters.type }, t.replace(/_/g, ' '))),
        )),
      h('div', { class: 'field' }, h('label', {}, 'From (payment date)'), h('input', { type: 'date', value: filters.date_from, onchange: (e) => { filters.date_from = e.target.value; apply(); } })),
      h('div', { class: 'field' }, h('label', {}, 'To (payment date)'), h('input', { type: 'date', value: filters.date_to, onchange: (e) => { filters.date_to = e.target.value; apply(); } })),
      h('button', {
        class: 'btn btn-secondary',
        onclick: () => download(`/api/admin/payments/export.xlsx?${query}`, 'eloria-payments.xlsx').catch((e) => alert(e.message)),
      }, 'Export Excel'),
    ),
    h('p', { class: 'muted small' }, 'Date filters use the payment date. Amounts are manually recorded — payment processing happens outside the website.'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Order'), h('th', {}, 'Customer'), h('th', {}, 'Type'), h('th', {}, 'Amount'), h('th', {}, 'Note'), h('th', {}, 'Recorded by'))),
      h('tbody', {}, data.items.map((p) => h('tr', {},
        h('td', { class: 'small' }, dateFmt(p.created_at)),
        h('td', {}, h('a', { href: `#/orders/${p.order_id}`, class: 'mono' }, p.order_code)),
        h('td', { class: 'small' }, p.customer_name || '—'),
        h('td', {}, h('span', { class: p.type.startsWith('outcome') ? 'badge badge-muted' : 'badge badge-ok' }, p.type.replace(/_/g, ' '))),
        h('td', {}, p.amount_minor ? money(p.amount_minor, c) : '—'),
        h('td', { class: 'small' }, p.note),
        h('td', { class: 'small' }, p.created_by),
      ))),
    )),
  );
}

/* ---------------- cancellations & returns ---------------- */

async function pageReturns() {
  const q = currentQuery();
  const filters = {
    type: q.get('type') || '', q: q.get('q') || '',
    date_from: q.get('date_from') || '', date_to: q.get('date_to') || '',
  };
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const data = await api('GET', `/api/admin/cancellations-returns?${query}`);
  const apply = () => {
    location.hash = `#/returns?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v))}`;
  };

  shell('#/returns', 'Cancellations & Returns',
    h('div', { class: 'filter-bar' },
      h('div', { class: 'field' }, h('label', {}, 'Type'),
        h('select', { onchange: (e) => { filters.type = e.target.value; apply(); } },
          h('option', { value: '' }, 'All'),
          h('option', { value: 'cancellation', selected: filters.type === 'cancellation' }, 'Cancellations'),
          h('option', { value: 'return', selected: filters.type === 'return' }, 'Returns'),
        )),
      h('div', { class: 'field', style: 'flex:2' }, h('label', {}, 'Search (record code, order, customer)'), h('input', { value: filters.q, onchange: (e) => { filters.q = e.target.value; apply(); } })),
      h('div', { class: 'field' }, h('label', {}, 'From (record date)'), h('input', { type: 'date', value: filters.date_from, onchange: (e) => { filters.date_from = e.target.value; apply(); } })),
      h('div', { class: 'field' }, h('label', {}, 'To (record date)'), h('input', { type: 'date', value: filters.date_to, onchange: (e) => { filters.date_to = e.target.value; apply(); } })),
      h('button', {
        class: 'btn btn-secondary',
        onclick: () => download(`/api/admin/cancellations-returns/export.xlsx?${query}`, 'eloria-cancellations-returns.xlsx').catch((e) => alert(e.message)),
      }, 'Export Excel'),
    ),
    h('p', { class: 'muted small' }, 'Date filters use the record creation date. Records are created from the order detail page.'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Type'), h('th', {}, 'Created'), h('th', {}, 'Order'), h('th', {}, 'Items'), h('th', {}, 'Outcome'), h('th', {}, 'Deposit outcome'))),
      h('tbody', {}, data.items.map((r) => h('tr', {},
        h('td', { class: 'mono' }, r.record_code),
        h('td', {}, h('span', { class: r.type === 'return' ? 'badge badge-amber' : 'badge badge-muted' }, r.type)),
        h('td', { class: 'small' }, dateFmt(r.created_at), r.date_received ? h('div', { class: 'small muted' }, `received ${r.date_received}`) : null),
        h('td', {}, h('a', { href: `#/orders/${r.order_id}`, class: 'mono' }, r.order_code)),
        h('td', { class: 'small' }, r.lines.map((l) => h('div', {}, `${l.product_name} (${optionText(l)}) × ${l.quantity}`))),
        h('td', { class: 'small' }, r.outcome),
        h('td', { class: 'small' }, r.deposit_outcome || '—'),
      ))),
    )),
  );
}

/* ---------------- discounts ---------------- */

async function pageDiscounts() {
  const items = await api('GET', '/api/admin/discounts');
  const categories = await api('GET', '/api/admin/categories');
  const products = await api('GET', '/api/admin/products');

  const editing = h('div', {});
  const c = currency();

  function discountForm(d) {
    const isNew = !d.id;
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        try {
          const payload = {
            type: fd.get('type'), code: fd.get('code') || undefined, name: fd.get('name'),
            method: fd.get('method'), value: fd.get('value'), scope: fd.get('scope'),
            scope_id: fd.get('scope_id') || undefined,
            min_subtotal: fd.get('min_subtotal') || undefined,
            starts_at: fd.get('starts_at') || undefined, ends_at: fd.get('ends_at') || undefined,
            usage_limit: fd.get('usage_limit') || undefined,
            stackable: fd.get('stackable') === 'on', active: fd.get('active') === 'on',
          };
          if (isNew) await api('POST', '/api/admin/discounts', payload);
          else await api('PUT', `/api/admin/discounts/${d.id}`, payload);
          route();
        } catch (err) { flash(form, err.message, 'notice notice-danger'); }
      },
    },
      h('h3', {}, isNew ? 'New discount' : `Edit ${d.name || d.code}`),
      h('div', { class: 'form-row' },
        h('div', {}, h('label', {}, 'Type'),
          h('select', { name: 'type' },
            h('option', { value: 'sale', selected: d.type === 'sale' }, 'Sale (automatic)'),
            h('option', { value: 'promo', selected: d.type === 'promo' }, 'Promo code'),
          )),
        h('div', {}, h('label', {}, 'Code (promo only)'), h('input', { name: 'code', value: d.code || '', placeholder: 'e.g. WELCOME10' })),
        h('div', {}, h('label', {}, 'Name'), h('input', { name: 'name', value: d.name || '' })),
      ),
      h('div', { class: 'form-row' },
        h('div', {}, h('label', {}, 'Method'),
          h('select', { name: 'method' },
            h('option', { value: 'percent', selected: d.method === 'percent' }, 'Percentage'),
            h('option', { value: 'fixed', selected: d.method === 'fixed' }, `Fixed amount per line (${c})`),
          )),
        h('div', {}, h('label', {}, 'Value (percent: 10 = 10%; fixed: amount)'), h('input', { name: 'value', required: true, value: d.value != null ? (d.method === 'fixed' ? (d.value / 100).toFixed(2) : (d.value / 100)) : '' })),
        h('div', {}, h('label', {}, 'Scope'),
          h('select', { name: 'scope' },
            h('option', { value: 'all', selected: d.scope === 'all' }, 'All products'),
            h('option', { value: 'product', selected: d.scope === 'product' }, 'One product'),
            h('option', { value: 'category', selected: d.scope === 'category' }, 'One category'),
          )),
        h('div', {}, h('label', {}, 'Scope target'),
          h('select', { name: 'scope_id' },
            h('option', { value: '' }, '—'),
            products.map((p) => h('option', { value: p.id, selected: d.scope === 'product' && d.scope_id === p.id }, p.name)),
            categories.map((cat) => h('option', { value: cat.id, selected: d.scope === 'category' && d.scope_id === cat.id }, `Cat: ${cat.name}`)),
          )),
      ),
      h('div', { class: 'form-row' },
        h('div', {}, h('label', {}, `Min subtotal (${c}, optional)`), h('input', { name: 'min_subtotal', value: d.min_subtotal_minor ? (d.min_subtotal_minor / 100).toFixed(2) : '' })),
        h('div', {}, h('label', {}, 'Starts'), h('input', { type: 'date', name: 'starts_at', value: d.starts_at ? d.starts_at.slice(0, 10) : '' })),
        h('div', {}, h('label', {}, 'Ends'), h('input', { type: 'date', name: 'ends_at', value: d.ends_at ? d.ends_at.slice(0, 10) : '' })),
        h('div', {}, h('label', {}, 'Usage limit (blank = unlimited)'), h('input', { type: 'number', name: 'usage_limit', value: d.usage_limit ?? '' })),
      ),
      h('label', { style: 'display:flex; gap:8px; align-items:center; font-weight:400' },
        h('input', { type: 'checkbox', name: 'stackable', checked: !!d.stackable, style: 'width:auto' }), 'Can combine with sale prices'),
      h('label', { style: 'display:flex; gap:8px; align-items:center; font-weight:400' },
        h('input', { type: 'checkbox', name: 'active', checked: d.active !== 0 && d.active !== false, style: 'width:auto' }), 'Active'),
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn', type: 'submit' }, isNew ? 'Create discount' : 'Save'),
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => clear(editing) }, 'Close'),
      ),
    );
    return form;
  }

  shell('#/discounts', 'Discounts',
    h('div', { class: 'form-actions', style: 'margin-top:0' },
      h('button', {
        class: 'btn',
        onclick: () => { clear(editing).append(discountForm({ type: 'promo', method: 'percent', scope: 'all', active: 1 })); },
      }, 'New discount'),
      h('button', {
        class: 'btn btn-secondary',
        onclick: () => download('/api/admin/discounts/export.xlsx', 'eloria-discounts.xlsx').catch((e) => alert(e.message)),
      }, 'Export Excel'),
    ),
    editing,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Type'), h('th', {}, 'Code'), h('th', {}, 'Name'), h('th', {}, 'Value'), h('th', {}, 'Scope'),
        h('th', {}, 'Validity'), h('th', {}, 'Used'), h('th', {}, 'Stackable'), h('th', {}, 'Active'), h('th', {}, ''),
      )),
      h('tbody', {}, items.map((d) => h('tr', {},
        h('td', {}, d.type === 'sale' ? h('span', { class: 'badge badge-amber' }, 'sale') : h('span', { class: 'badge' }, 'promo')),
        h('td', { class: 'mono' }, d.code || '—'),
        h('td', {}, d.name),
        h('td', {}, d.method === 'percent' ? `${d.value / 100}%` : money(d.value, c)),
        h('td', { class: 'small' }, d.scope, d.scope_id ? ` #${d.scope_id}` : ''),
        h('td', { class: 'small' }, [d.starts_at ? d.starts_at.slice(0, 10) : '…', d.ends_at ? d.ends_at.slice(0, 10) : '…'].join(' → ')),
        h('td', {}, d.usage_limit ? `${d.used_count}/${d.usage_limit}` : d.used_count),
        h('td', {}, d.stackable ? 'yes' : 'no'),
        h('td', {}, d.active ? h('span', { class: 'badge badge-ok' }, 'active') : h('span', { class: 'badge badge-muted' }, 'off')),
        h('td', {},
          h('button', { class: 'btn btn-secondary btn-small', onclick: () => clear(editing).append(discountForm(d)) }, 'Edit'),
          ' ',
          h('button', {
            class: 'btn btn-danger btn-small',
            onclick: async () => {
              if (!confirm('Delete this discount?')) return;
              await api('DELETE', `/api/admin/discounts/${d.id}`);
              route();
            },
          }, 'Delete'),
        ),
      ))),
    )),
  );
}

/* ---------------- reviews ---------------- */

async function pageReviews() {
  const items = await api('GET', '/api/admin/reviews');
  shell('#/reviews', 'Reviews',
    h('p', { class: 'muted small' }, 'Reviews submitted on the website wait here for moderation. Only published reviews appear on product pages and feed the average rating.'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Product'), h('th', {}, 'Author'), h('th', {}, 'Rating'), h('th', {}, 'Review'), h('th', {}, 'Status'), h('th', {}, ''))),
      h('tbody', {}, items.map((r) => h('tr', {},
        h('td', { class: 'small' }, r.product_name),
        h('td', { class: 'small' }, r.author_name),
        h('td', {}, '★'.repeat(r.rating)),
        h('td', { class: 'small' }, r.body),
        h('td', {}, h('span', { class: r.status === 'published' ? 'badge badge-ok' : r.status === 'pending' ? 'badge badge-amber' : 'badge badge-muted' }, r.status)),
        h('td', {},
          r.status !== 'published' ? h('button', {
            class: 'btn btn-small', onclick: async () => { await api('POST', `/api/admin/reviews/${r.id}/publish`); route(); },
          }, 'Publish') : null,
          ' ',
          r.status !== 'rejected' ? h('button', {
            class: 'btn btn-danger btn-small', onclick: async () => { await api('POST', `/api/admin/reviews/${r.id}/reject`); route(); },
          }, 'Reject') : null,
        ),
      ))),
    )),
  );
}

/* ---------------- notifications ---------------- */

async function pageNotifications() {
  const data = await api('GET', '/api/admin/notifications');
  shell('#/notifications', 'Notifications',
    h('div', { class: 'form-actions', style: 'margin-top:0' },
      h('button', {
        class: 'btn btn-secondary btn-small',
        onclick: async () => { await api('POST', '/api/admin/notifications/read-all'); route(); },
      }, 'Mark all read'),
    ),
    h('h2', {}, 'Dashboard notifications'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Title'), h('th', {}, 'Detail'), h('th', {}, 'When'), h('th', {}, 'Status'), h('th', {}, ''))),
      h('tbody', {}, data.items.map((n) => h('tr', { style: n.read_at ? 'opacity:0.65' : '' },
        h('td', {}, h('span', { class: n.type === 'low_stock' ? 'badge badge-amber' : 'badge' }, n.type.replace(/_/g, ' '))),
        h('td', {}, n.title),
        h('td', { class: 'small' }, n.body),
        h('td', { class: 'small' }, dateFmt(n.created_at)),
        h('td', {}, n.read_at ? 'read' : h('span', { class: 'badge badge-ok' }, 'new')),
        h('td', {}, n.read_at ? null : h('button', {
          class: 'btn btn-secondary btn-small',
          onclick: async () => { await api('POST', `/api/admin/notifications/${n.id}/read`); route(); },
        }, 'Mark read')),
      ))),
    )),
    h('h2', {}, 'Email log (business notifications)'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'To'), h('th', {}, 'Subject'), h('th', {}, 'When'), h('th', {}, 'Status'), h('th', {}, ''))),
      h('tbody', {}, data.emails.map((n) => h('tr', {},
        h('td', { class: 'small' }, n.email_to),
        h('td', { class: 'small' }, n.title),
        h('td', { class: 'small' }, dateFmt(n.created_at)),
        h('td', {}, n.status === 'sent'
          ? h('span', { class: 'badge badge-ok' }, 'sent')
          : n.status === 'failed'
            ? h('span', { class: 'badge badge-danger' }, `failed: ${n.error.slice(0, 40)}`)
            : h('span', { class: 'badge badge-amber' }, n.status)),
        h('td', {}, h('button', {
          class: 'btn btn-secondary btn-small',
          onclick: async () => {
            await api('POST', `/api/admin/notifications/${n.id}/retry`);
            route();
          },
        }, 'Retry')),
      ))),
    )),
  );
}

/* ---------------- settings ---------------- */

async function pageSettings() {
  const s = await api('GET', '/api/admin/settings');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        settingsCache = await api('PUT', '/api/admin/settings', Object.fromEntries(new FormData(form).entries()));
        flash(form, 'Settings saved.', 'notice notice-ok');
      } catch (err) { flash(form, err.message, 'notice notice-danger'); }
    },
  },
    h('div', { class: 'card' },
      h('h2', {}, 'Business information'),
      h('p', { class: 'small muted' }, 'Shown on the public contact page and used as the recipient of order/stock email notifications.'),
      h('div', { class: 'form-row' },
        h('div', {}, h('label', {}, 'Business name'), h('input', { name: 'business_name', value: s.business_name || '' })),
        h('div', {}, h('label', {}, 'Currency label'), h('input', { name: 'currency', value: s.currency || 'EGP' })),
      ),
      h('div', { class: 'form-row' },
        h('div', {}, h('label', {}, 'Email (receives order notifications)'), h('input', { name: 'business_email', value: s.business_email || '' })),
        h('div', {}, h('label', {}, 'Phone'), h('input', { name: 'business_phone', value: s.business_phone || '' })),
        h('div', {}, h('label', {}, 'WhatsApp number'), h('input', { name: 'whatsapp_number', value: s.whatsapp_number || '' })),
      ),
      h('div', { class: 'form-row' },
        h('div', {}, h('label', {}, 'Address'), h('input', { name: 'business_address', value: s.business_address || '' })),
        h('div', {}, h('label', {}, 'Hours'), h('input', { name: 'business_hours', value: s.business_hours || '' })),
      ),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Save settings')),
    ),
  );

  const pwForm = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(pwForm);
      try {
        await api('POST', '/api/admin/auth/change-password', {
          current_password: fd.get('current_password'),
          new_password: fd.get('new_password'),
        });
        clear(pwForm).append(h('div', { class: 'notice notice-ok' }, 'Password changed.'));
      } catch (err) { flash(pwForm, err.message, 'notice notice-danger'); }
    },
  },
    h('div', { class: 'card' },
      h('h2', {}, 'Change admin password'),
      h('div', { class: 'form-row' },
        h('div', {}, h('label', {}, 'Current password'), h('input', { name: 'current_password', type: 'password', required: true })),
        h('div', {}, h('label', {}, 'New password (min 8 characters)'), h('input', { name: 'new_password', type: 'password', required: true, minlength: 8 })),
      ),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Change password')),
    ),
  );

  shell('#/settings', 'Settings', form, pwForm);
}

window.addEventListener('hashchange', route);
route();
