/** Cart for the order request builder — kept in localStorage. */
const KEY = 'eloria_cart_v1';

export function getCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((l) => l && l.combination_id && l.qty > 0) : [];
  } catch {
    return [];
  }
}

export function saveCart(lines) {
  localStorage.setItem(KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event('eloria-cart'));
}

export function addLine(combinationId, qty) {
  const lines = getCart();
  const found = lines.find((l) => l.combination_id === combinationId);
  if (found) found.qty += qty;
  else lines.push({ combination_id: combinationId, qty });
  saveCart(lines);
}

export function setQty(combinationId, qty) {
  let lines = getCart();
  if (qty <= 0) lines = lines.filter((l) => l.combination_id !== combinationId);
  else lines.forEach((l) => { if (l.combination_id === combinationId) l.qty = qty; });
  saveCart(lines);
}

export function clearCart() {
  saveCart([]);
}

export function cartCount() {
  return getCart().reduce((s, l) => s + l.qty, 0);
}
