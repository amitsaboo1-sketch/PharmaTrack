const express = require('express');
const { q } = require('../db/connection');
const { requireRole, requireAdmin } = require('../middleware/auth');
const { audit } = require('../middleware/audit');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Notifications ----------
router.get('/notifications', ah(async (req, res) => {
  res.json(await q.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', [req.user.id]));
}));
router.post('/notifications/read', ah(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (ids && ids.length) {
    await q.run(`UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
      [req.user.id, ...ids.map(Number)]);
  } else {
    await q.run('UPDATE notifications SET read = 1 WHERE user_id = ?', [req.user.id]);
  }
  res.json({ ok: true });
}));

// ---------- Audit log (HO: Finance/Admin see it; PM too in MVP) ----------
router.get('/audit', requireRole('ho'), ah(async (req, res) => {
  const params = [];
  const conds = [];
  if (req.query.entityType) { conds.push('entity_type = ?'); params.push(req.query.entityType); }
  if (req.query.entityId) { conds.push('entity_id = ?'); params.push(req.query.entityId); }
  if (req.query.user) { conds.push('user_id = ?'); params.push(req.query.user); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  res.json(await q.all(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT 300`, params));
}));

// ---------- Config ----------
router.get('/config', requireRole('ho'), ah(async (req, res) => {
  const rows = await q.all('SELECT * FROM config');
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}));
router.put('/config', requireAdmin, ah(async (req, res) => {
  const allowed = ['roi_window_months', 'gross_margin_pct', 'overrun_threshold_pct', 'gift_cap_per_hcp'];
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!allowed.includes(k)) continue;
    const before = await q.get('SELECT value FROM config WHERE key = ?', [k]);
    await q.run('INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, String(v)]);
    await audit(req, 'config.update', 'config', k, before, { value: String(v) });
  }
  res.json({ ok: true });
}));

module.exports = router;
