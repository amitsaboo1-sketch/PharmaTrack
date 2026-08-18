const express = require('express');
const { q } = require('../db/connection');
const { requireRole } = require('../middleware/auth');
const { audit, notify, notifyStage } = require('../middleware/audit');
const { CHAINS, nextStage, canActAtStage, stageForUser, STAGE_LABEL } = require('../services/approvals');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const now = () => new Date().toISOString();

const DA_CATEGORIES = ['Travel', 'Fuel', 'Meals', 'Accommodation', 'Local Conveyance', 'Communication', 'Miscellaneous'];

async function currencyForUser(user) {
  if (!user.country) return { code: 'USD', symbol: '$' };
  const c = await q.get('SELECT currency_code, currency_symbol FROM countries WHERE code = ?', [user.country]);
  return c ? { code: c.currency_code, symbol: c.currency_symbol } : { code: 'USD', symbol: '$' };
}

// List claims: sales -> own; HO -> all (optionally by status/user).
router.get('/', ah(async (req, res) => {
  const params = [];
  const conds = [];
  if (req.user.role === 'sales') { conds.push('d.user_id = ?'); params.push(req.user.id); }
  else if (req.user.role === 'clm') { conds.push('d.country_code = ?'); params.push(req.user.country); }
  else if (req.query.userId) { conds.push('d.user_id = ?'); params.push(req.query.userId); }
  if (req.query.status) { conds.push('d.status = ?'); params.push(req.query.status); }
  if (req.query.pending === 'mine') {
    const stage = stageForUser(req.user);
    conds.push('d.status = ?'); params.push('submitted');
    conds.push('d.approval_stage = ?'); params.push(stage || 'none');
    if (req.user.role === 'clm') { conds.push('d.country_code = ?'); params.push(req.user.country); }
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  res.json(await q.all(
    `SELECT d.*, u.name AS user_name,
       (SELECT COUNT(*) FROM da_attachments a WHERE a.da_id = d.id) AS attachment_count,
       (SELECT COALESCE(SUM(a.amount),0) FROM da_attachments a WHERE a.da_id = d.id) AS expense_total
     FROM daily_allowances d JOIN users u ON u.id = d.user_id
     ${where} ORDER BY d.da_date DESC, d.id DESC LIMIT 500`, params));
}));

router.get('/categories', (req, res) => res.json(DA_CATEGORIES));

router.get('/summary', ah(async (req, res) => {
  const uid = req.user.role === 'sales' ? req.user.id : (req.query.userId || null);
  const params = [];
  let scope = '';
  if (uid) { scope = 'WHERE d.user_id = ?'; params.push(uid); }
  const rows = await q.all(
    `SELECT d.status, COUNT(*) AS count, COALESCE(SUM(d.da_amount),0) AS da_total
     FROM daily_allowances d ${scope} GROUP BY d.status`, params);
  res.json(rows);
}));

router.get('/:id', ah(async (req, res) => {
  const d = await q.get(`SELECT d.*, u.name AS user_name FROM daily_allowances d JOIN users u ON u.id = d.user_id WHERE d.id = ?`, [req.params.id]);
  if (!d) return res.status(404).json({ error: 'Claim not found' });
  if (req.user.role === 'sales' && d.user_id !== req.user.id) return res.status(403).json({ error: 'Not your claim' });
  d.attachments = await q.all('SELECT id, category, amount, filename, mime, data_url, uploaded_at FROM da_attachments WHERE da_id = ?', [req.params.id]);
  res.json(d);
}));

// Create a DA claim (sales only), with optional attached expense proofs.
router.post('/', requireRole('sales'), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.daDate) return res.status(400).json({ error: 'daDate is required' });
  const amount = Number(b.daAmount);
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'daAmount must be a non-negative number' });
  const cur = await currencyForUser(req.user);
  const attachments = Array.isArray(b.attachments) ? b.attachments : [];
  for (const a of attachments) {
    if (a.amount != null && (!Number.isFinite(Number(a.amount)) || Number(a.amount) < 0)) {
      return res.status(400).json({ error: 'Attachment amounts must be non-negative numbers' });
    }
  }

  const id = await q.tx(async (t) => {
    const ins = await t.run(
      `INSERT INTO daily_allowances (user_id,country_code,currency_code,da_date,location,purpose,da_amount,status,approval_stage,created_at)
       VALUES (?,?,?,?,?,?,?, 'submitted', 'clm', ?)`,
      [req.user.id, req.user.country, cur.code, b.daDate, b.location || '', b.purpose || '', amount, now()]);
    const newId = ins.lastID;
    for (const a of attachments) {
      await t.run(`INSERT INTO da_attachments (da_id,category,amount,filename,mime,data_url,uploaded_at) VALUES (?,?,?,?,?,?,?)`,
        [newId, a.category || 'Miscellaneous', Number(a.amount) || 0, a.filename || 'attachment', a.mime || '', a.dataUrl || null, now()]);
    }
    return newId;
  });

  await audit(req, 'da.create', 'da', id, null, { daDate: b.daDate, amount, attachments: attachments.length });
  await notifyStage('clm', req.user.country, `${req.user.name} submitted a daily allowance claim (${b.location || b.daDate}) — awaiting your approval`, 'da', id);
  res.json({ id, currency: cur.code });
}));

// ---------- Sequential decision: CLM (country) -> CM -> Admin ----------
router.post('/:id/decision', ah(async (req, res) => {
  const d = await q.get('SELECT * FROM daily_allowances WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: 'Claim not found' });
  if (d.status !== 'submitted') return res.status(409).json({ error: 'Only submitted claims can be decided' });
  const stage = d.approval_stage || 'clm';
  if (!canActAtStage(req.user, stage, d.country_code)) {
    return res.status(403).json({ error: `This claim is awaiting ${STAGE_LABEL[stage] || stage} approval` });
  }
  const { decision, remarks } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved|rejected' });
  if (decision === 'rejected' && !remarks) return res.status(400).json({ error: 'Remarks are required to reject' });

  if (decision === 'approved') {
    const next = nextStage(CHAINS.da, stage);
    if (next) {
      await q.run(`UPDATE daily_allowances SET approval_stage=?, decided_by=?, decided_at=? WHERE id=?`, [next, req.user.id, now(), d.id]);
      await audit(req, `da.approve_${stage}`, 'da', d.id, { stage }, { stage: next });
      await notifyStage(next, d.country_code, `A daily allowance claim cleared ${STAGE_LABEL[stage]} — awaiting your approval`, 'da', d.id);
      return res.json({ ok: true, stage: next });
    }
    await q.run(`UPDATE daily_allowances SET status='approved', approval_stage=NULL, decided_by=?, decided_at=? WHERE id=?`, [req.user.id, now(), d.id]);
    await audit(req, 'da.approved', 'da', d.id, { stage }, { status: 'approved' });
    await notify(d.user_id, 'da_approved', `Your daily allowance claim (${d.location || d.da_date}) was fully approved`, 'da', d.id);
    return res.json({ ok: true, stage: 'approved' });
  }

  await q.run(`UPDATE daily_allowances SET status='rejected', approval_stage=NULL, decided_by=?, decided_at=?, remarks=? WHERE id=?`,
    [req.user.id, now(), remarks || '', d.id]);
  await audit(req, 'da.rejected', 'da', d.id, { stage }, { status: 'rejected', remarks });
  await notify(d.user_id, 'da_rejected', `Your daily allowance claim (${d.location || d.da_date}) was rejected by ${STAGE_LABEL[stage]}${remarks ? ': ' + remarks : ''}`, 'da', d.id);
  res.json({ ok: true, stage: 'rejected' });
}));

// Owner may delete an as-yet-undecided claim.
router.delete('/:id', requireRole('sales'), ah(async (req, res) => {
  const d = await q.get('SELECT * FROM daily_allowances WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: 'Claim not found' });
  if (d.user_id !== req.user.id) return res.status(403).json({ error: 'Not your claim' });
  if (d.status === 'approved') return res.status(409).json({ error: 'Approved claims cannot be deleted' });
  await q.tx(async (t) => {
    await t.run('DELETE FROM da_attachments WHERE da_id = ?', [d.id]);
    await t.run('DELETE FROM daily_allowances WHERE id = ?', [d.id]);
  });
  await audit(req, 'da.delete', 'da', d.id, d, null);
  res.json({ ok: true });
}));

module.exports = router;
