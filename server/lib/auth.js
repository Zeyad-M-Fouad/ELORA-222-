import crypto from 'node:crypto';
import { get, run, now } from './db.js';
import { newToken } from './ids.js';
import { config } from '../config.js';
import { HttpError } from './errors.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function createSession(userId) {
  const token = newToken();
  const created = now();
  const expires = new Date(Date.now() + config.sessionTtlDays * 86400_000).toISOString();
  run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    token, userId, created, expires);
  return token;
}

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
}

export function getUserForToken(token) {
  if (!token) return undefined;
  const row = get(
    `SELECT u.id, u.username, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`, token);
  if (!row) return undefined;
  if (row.expires_at < now()) {
    destroySession(token);
    return undefined;
  }
  return { id: row.id, username: row.username };
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function sessionToken(req) {
  return parseCookies(req).eloria_session;
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `eloria_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionTtlDays * 86400}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'eloria_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

/** Express middleware guarding all /api/admin routes. */
export function requireAdmin(req, res, next) {
  const user = getUserForToken(sessionToken(req));
  if (!user) return next(new HttpError(401, 'Admin authentication required'));
  req.adminUser = user;
  next();
}
