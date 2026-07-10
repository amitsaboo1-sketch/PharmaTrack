const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { q } = require('../db/connection');
const { JWT_SECRET, JWT_EXPIRY } = require('../config');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../middleware/audit');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.post('/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = await q.get('SELECT * FROM users WHERE email = ? AND active = 1', [String(email).toLowerCase().trim()]);
  const ok = user && bcrypt.compareSync(password, user.password_hash);

  await q.run(
    `INSERT INTO audit_log (at,user_id,action,entity_type,entity_id,ip) VALUES (?,?,?,?,?,?)`,
    [new Date().toISOString(), user ? user.id : null, ok ? 'login.success' : 'login.failure', 'user', email, req.ip || null]
  );
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  delete user.password_hash;
  res.json({ token, user });
}));

router.get('/me', requireAuth, (req, res) => res.json(req.user));

router.post('/change-password', requireAuth, ah(async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const user = await q.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  await q.run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 10), req.user.id]);
  await audit(req, 'user.change_password', 'user', req.user.id);
  res.json({ ok: true });
}));

module.exports = router;
