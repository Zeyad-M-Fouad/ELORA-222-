/** Money is stored as integer minor units (1/100). Never use floats for arithmetic. */

export function formatMoney(minor, currency = 'EGP') {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${whole.toLocaleString('en-US')}.${frac} ${currency}`;
}

export function parseMoney(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Invalid amount');
    return Math.round(input * 100);
  }
  const s = String(input ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('Invalid amount');
  return Math.round(Number(s) * 100);
}

/** percentOff: value stored as percent*100 (1000 = 10%). Rounds half-up to minor units. */
export function percentOfMinor(amountMinor, percentX100) {
  return Math.round((amountMinor * percentX100) / 10000);
}
