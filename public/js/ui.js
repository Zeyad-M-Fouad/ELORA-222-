/** Tiny DOM + formatting helpers shared by storefront and dashboard. */

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'disabled') el.disabled = !!v;
    else if (k === 'selected') el.selected = !!v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(9)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function money(minor, currency = 'EGP') {
  if (minor == null) return '—';
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')} ${currency}`;
}

export function dateFmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export function stars(rating) {
  return '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));
}

/** fetch wrapper returning parsed JSON; throws Error with server message. */
export async function api(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.details = data && data.details;
    err.data = data;
    throw err;
  }
  return data;
}

export function flash(container, message, kind = 'notice') {
  const el = h('div', { class: kind }, message);
  container.prepend(el);
  setTimeout(() => el.remove(), 8000);
  return el;
}

/** Download for authenticated exports: fetches the file then triggers a save. */
export async function download(url, filename) {
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    let msg = 'Export failed';
    try { msg = JSON.parse(t).error || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const STATE_LABELS = {
  pending: 'Pending',
  confirmed: 'Confirmed (awaiting dispatch)',
  on_the_way: 'On the way',
  delivered: 'Delivered',
  refused: 'Refused (awaiting return)',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

export const PAYMENT_LABELS = {
  unpaid: 'Unpaid',
  deposit_received: 'Deposit received',
  fully_paid: 'Fully paid',
  deposit_retained: 'Deposit retained / balance not collected',
  no_payment_received: 'No payment received',
};

export function stateBadge(state) {
  const cls = {
    pending: 'badge-amber', confirmed: 'badge-amber', on_the_way: 'badge',
    delivered: 'badge-ok', refused: 'badge-danger', returned: 'badge-muted', cancelled: 'badge-muted',
  }[state] || 'badge';
  return h('span', { class: `badge ${cls}` }, STATE_LABELS[state] || state);
}

export function paymentBadge(pay) {
  const cls = {
    unpaid: 'badge-danger', deposit_received: 'badge-amber', fully_paid: 'badge-ok',
    deposit_retained: 'badge-danger', no_payment_received: 'badge-muted',
  }[pay] || 'badge';
  return h('span', { class: `badge ${cls}` }, PAYMENT_LABELS[pay] || pay);
}

export function optionText(line) {
  return [line.size ?? line.size_label, line.color, line.scent].filter(Boolean).join(' / ');
}
