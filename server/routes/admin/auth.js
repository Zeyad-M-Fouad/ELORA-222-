import { Router } from 'express';
import { get, run, now } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { verifyPassword, hashPassword, createSession, destroySession, sessionToken, setSessionCookie, clearSessionCookie, requireAdmin } from '../../lib/auth.js';
import { str } from '../../lib/validate.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const username = str(req.body.username, 'username', { required: true, max: 100 });
  const password = str(req.body.password, 'password', { required: true, max: 200 });
  const user = get('SELECT * FROM users WHERE username = ?', username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, 'Invalid username or password');
  }
  const token = createSession(user.id);
  setSessionCookie(res, token);
  res.json({ username: user.username });
});

authRouter.post('/logout', (req, res) => {
  destroySession(sessionToken(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAdmin, (req, res) => {
  res.json({ username: req.adminUser.username });
});

// Change password for the single admin account.
authRouter.post('/change-password', requireAdmin, (req, res) => {
  const current = str(req.body.current_password, 'current_password', { required: true, max: 200 });
  const next = str(req.body.new_password, 'new_password', { required: true, min: 8, max: 200 });
  const user = get('SELECT * FROM users WHERE id = ?', req.adminUser.id);
  if (!verifyPassword(current, user.password_hash)) throw new HttpError(403, 'Current password is incorrect');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), user.id);
  res.json({ ok: true });
});
