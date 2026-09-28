import { HttpError } from './errors.js';

export function str(value, field, { max = 5000, required = false, min = 0 } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (required && s.length < Math.max(1, min)) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} is too long`);
  return s;
}

export function int(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, required = true } = {}) {
  const n = Number(value);
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return undefined;
  }
  if (!Number.isInteger(n)) throw new HttpError(400, `${field} must be a whole number`);
  if (n < min || n > max) throw new HttpError(400, `${field} must be between ${min} and ${max}`);
  return n;
}

export function enumOf(value, field, allowed) {
  if (!allowed.includes(value)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

export function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function email(value, field = 'email') {
  const s = str(value, field, { max: 200, required: true });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, `${field} must be a valid email address`);
  return s;
}

export function isoDateOrNull(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${field} must be a valid date`);
  return d.toISOString();
}
