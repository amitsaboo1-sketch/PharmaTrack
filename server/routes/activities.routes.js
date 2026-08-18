const express = require('express');
const { q } = require('../db/connection');
const { requireRole } = require('../middleware/auth');
const { audit, notify, notifyHO, notifyStage } = require('../middleware/audit');
const { CHAINS, nextStage, canActAtStage, stageForUser, STAGE_LABEL } = require('../services/approvals');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const now = () => new Date().toISOString();

const EXPENSE_CATEGORIES = ['Food', 'Hall', 'Speaker', 'Travel', 'Stay', 'Printing', 'Promotional Material', 'Gift', 'Miscellaneous'];

async function newActivityId() {
  const r = await q.get('SELECT COUNT(*) AS c FROM activities');
  return `ACT${String(Number(r.c) + 1).padStart(3, '0')}`;
}

async function scopedActivity(req, id) {
  const act = await q.get('SELECT * FROM activities WHERE id = ?', [id]);
  if (!act) return { error: [404, 'Activity not found'] };
  if (req.user.role === 'sales' && act.proposed_by !== req.user.id) return { error: [403, 'Not your activity'] };
  return { act };
}

async function fullActivity(id) {
  const act = await q.get(
    `SELECT a.*, t.name AS type_name, b.name AS brand_name, p.name AS product_name, u.name AS proposer_name
     FROM activities a
     LEFT JOIN activity_types t ON t.id = a.type_id
     LEFT JOIN brands b ON b.id = a.brand_id
     LEFT JOIN products p ON p.id = a.product_id
     LEFT JOIN users u ON u.id = a.proposed_by
     WHERE a.id = ?`, [id]);
  if (!act) return null;
  act.participants = await q.all(
    `SELECT p.*, COALESCE(h.name, c.name) AS name, h.speciality, h.class, h.verified AS hcp_verified, c.verified AS chem_verified
     FROM activity_participants p
     LEFT JOIN hcps h ON h.id = p.account_id AND p.account_type = 'hcp'
     LEFT JOIN chemists c ON c.id = p.account_id AND p.account_type = 'chemist'
     WHERE p.activity_id = ?`, [id]);
  act.expenses = await q.all('SELECT * FROM expense_lines WHERE activity_id = ?', [id]);
  act.attachments = await q.all('SELECT * FROM attachments WHERE activity_id = ?', [id]);
  return act;
}

// ---------- list & detail ----------
router.get('/', ah(async (req, res) => {
  const params = [];
  const conds = [];
  if (req.user.role === 'sales') { conds.push('a.proposed_by = ?'); params.push(req.user.id); }
  else if (req.user.role === 'clm') { conds.push('a.country = ?'); params.push(req.user.country); }
  // cm / ho see all countries
  if (req.query.status) { conds.push('a.status = ?'); params.push(req.query.status); }
  if (req.query.type) { conds.push('a.type_id = ?'); params.push(req.query.type); }
  if (req.query.brand) { conds.push('a.brand_id = ?'); params.push(req.query.brand); }
  if (req.query.repId && (req.user.role === 'ho' || req.user.role === 'cm')) { conds.push('a.proposed_by = ?'); params.push(req.query.repId); }
  // Approvals queue: activities currently awaiting THIS user's stage.
  if (req.query.pending === 'mine') {
    const stage = stageForUser(req.user);
    conds.push('a.status = ?'); params.push('submitted');
    conds.push('a.approval_stage = ?'); params.push(stage || 'none');
    if (req.user.role === 'clm') { conds.push('a.country = ?'); params.push(req.user.country); }
  }
  if (req.query.from) { conds.push('COALESCE(a.actual_date, a.planned_date) >= ?'); params.push(req.query.from); }
  if (req.query.to) { conds.push('COALESCE(a.actual_date, a.planned_date) <= ?'); params.push(req.query.to); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  res.json(await q.all(
    `SELECT a.*, t.name AS type_name, b.name AS brand_name, u.name AS proposer_name,
       (SELECT COUNT(*) FROM activity_participants p WHERE p.activity_id = a.id AND p.account_type='hcp' AND p.proposed=1) AS proposed_hcps,
       (SELECT COUNT(*) FROM activity_participants p WHERE p.activity_id = a.id AND p.account_type='hcp' AND p.attended=1) AS attended_hcps
     FROM activities a
     LEFT JOIN activity_types t ON t.id = a.type_id
     LEFT JOIN brands b ON b.id = a.brand_id
     LEFT JOIN users u ON u.id = a.proposed_by
     ${where} ORDER BY COALESCE(a.actual_date, a.planned_date) DESC LIMIT 500`, params));
}));

router.get('/:id', ah(async (req, res) => {
  const { act, error } = await scopedActivity(req, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  res.json(await fullActivity(act.id));
}));

// ---------- create / edit / submit (sales) ----------
async function upsertParticipants(h, activityId, targets) {
  await h.run(`DELETE FROM activity_participants WHERE activity_id = ? AND attended = 0`, [activityId]);
  for (const t of targets || []) {
    await h.run(
      `INSERT INTO activity_participants (activity_id,account_id,account_type,proposed,invited)
       VALUES (?,?,?,1,1)
       ON CONFLICT(activity_id,account_id,account_type) DO UPDATE SET proposed=1`,
      [activityId, t.accountId, t.accountType]
    );
  }
}

router.post('/', requireRole('sales'), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.typeId) return res.status(400).json({ error: 'title and typeId are required' });
  const id = await newActivityId();
  const status = b.submit ? 'submitted' : 'draft';
  const stage = status === 'submitted' ? 'clm' : null;
  await q.run(
    `INSERT INTO activities (id,title,objective,remarks,type_id,brand_id,product_id,proposed_by,territory,country,
        planned_date,venue,estimated_cost,expected_hcp_count,expected_sales,status,approval_stage,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, b.title, b.objective || '', b.remarks || '', b.typeId, b.brandId || null, b.productId || null,
     req.user.id, req.user.territory, req.user.country, b.plannedDate || null, b.venue || '',
     Number(b.estimatedCost) || 0, Number(b.expectedHcpCount) || 0, Number(b.expectedSales) || 0, status, stage, now(), now()]
  );
  await upsertParticipants(q, id, b.targets);
  await audit(req, 'activity.create', 'activity', id, null, { ...b, status });
  if (status === 'submitted') await notifyStage('clm', req.user.country, `${req.user.name} submitted "${b.title}" — awaiting your approval`, 'activity', id);
  res.json({ id, status });
}));

router.put('/:id', requireRole('sales'), ah(async (req, res) => {
  const { act, error } = await scopedActivity(req, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  if (!['draft', 'returned'].includes(act.status)) return res.status(409).json({ error: `Cannot edit a ${act.status} activity` });
  const b = req.body || {};
  await q.run(
    `UPDATE activities SET title=?, objective=?, remarks=?, type_id=?, brand_id=?, product_id=?,
        planned_date=?, venue=?, estimated_cost=?, expected_hcp_count=?, expected_sales=?, updated_at=? WHERE id=?`,
    [b.title ?? act.title, b.objective ?? act.objective, b.remarks ?? act.remarks,
     b.typeId ?? act.type_id, b.brandId ?? act.brand_id, b.productId ?? act.product_id,
     b.plannedDate ?? act.planned_date, b.venue ?? act.venue,
     b.estimatedCost ?? act.estimated_cost, b.expectedHcpCount ?? act.expected_hcp_count,
     b.expectedSales ?? act.expected_sales, now(), act.id]
  );
  if (b.targets) await upsertParticipants(q, act.id, b.targets);
  await audit(req, 'activity.update', 'activity', act.id, act, b);
  res.json({ ok: true });
}));

router.post('/:id/submit', requireRole('sales'), ah(async (req, res) => {
  const { act, error } = await scopedActivity(req, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  if (!['draft', 'returned'].includes(act.status)) return res.status(409).json({ error: `Cannot submit a ${act.status} activity` });
  await q.run(`UPDATE activities SET status='submitted', approval_stage='clm', country=?, updated_at=? WHERE id=?`, [req.user.country, now(), act.id]);
  await audit(req, 'activity.submit', 'activity', act.id, { status: act.status }, { status: 'submitted' });
  await notifyStage('clm', req.user.country, `${req.user.name} submitted "${act.title}" — awaiting your approval`, 'activity', act.id);
  res.json({ ok: true });
}));

// ---------- Sequential decision: CLM (country) -> CM -> Marketing ----------
router.post('/:id/decision', ah(async (req, res) => {
  const act = await q.get('SELECT * FROM activities WHERE id = ?', [req.params.id]);
  if (!act) return res.status(404).json({ error: 'Activity not found' });
  if (act.status !== 'submitted') return res.status(409).json({ error: 'Only submitted activities can be decided' });
  const stage = act.approval_stage || 'clm';
  if (!canActAtStage(req.user, stage, act.country)) {
    return res.status(403).json({ error: `This proposal is awaiting ${STAGE_LABEL[stage] || stage} approval` });
  }
  const { decision, remarks } = req.body || {};
  if (!['approved', 'rejected', 'returned'].includes(decision)) return res.status(400).json({ error: 'decision must be approved|rejected|returned' });
  if (['rejected', 'returned'].includes(decision) && !remarks) return res.status(400).json({ error: 'Remarks are mandatory when rejecting or returning' });

  if (decision === 'approved') {
    const next = nextStage(CHAINS.activity, stage);
    if (next) {
      await q.run(`UPDATE activities SET approval_stage=?, decided_by=?, decided_at=?, decision_remarks=?, updated_at=? WHERE id=?`,
        [next, req.user.id, now(), remarks || '', now(), act.id]);
      await audit(req, `activity.approve_${stage}`, 'activity', act.id, { stage }, { stage: next });
      await notifyStage(next, act.country, `"${act.title}" cleared ${STAGE_LABEL[stage]} — awaiting your approval`, 'activity', act.id);
      await notify(act.proposed_by, 'approval', `"${act.title}" cleared ${STAGE_LABEL[stage]} — now with ${STAGE_LABEL[next]}`, 'activity', act.id);
      return res.json({ ok: true, stage: next });
    }
    await q.run(`UPDATE activities SET status='approved', approval_stage=NULL, decided_by=?, decided_at=?, decision_remarks=?, updated_at=? WHERE id=?`,
      [req.user.id, now(), remarks || '', now(), act.id]);
    await audit(req, 'activity.approved', 'activity', act.id, { stage }, { status: 'approved' });
    await notify(act.proposed_by, 'approved', `Your proposal "${act.title}" was fully approved — you can now execute it`, 'activity', act.id);
    return res.json({ ok: true, stage: 'approved' });
  }

  // return / reject -> back to the SER
  await q.run(`UPDATE activities SET status=?, approval_stage=NULL, decided_by=?, decided_at=?, decision_remarks=?, updated_at=? WHERE id=?`,
    [decision, req.user.id, now(), remarks || '', now(), act.id]);
  await audit(req, `activity.${decision}`, 'activity', act.id, { stage }, { status: decision, remarks });
  await notify(act.proposed_by, decision, `Your proposal "${act.title}" was ${decision} by ${STAGE_LABEL[stage]}${remarks ? ': ' + remarks : ''}`, 'activity', act.id);
  res.json({ ok: true, stage: decision });
}));

// ---------- execution (sales owner) ----------
router.post('/:id/execute', requireRole('sales'), ah(async (req, res) => {
  const { act, error } = await scopedActivity(req, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  if (act.status !== 'approved') return res.status(409).json({ error: `Only approved activities can be executed (current: ${act.status})` });

  const b = req.body || {};
  const actualCost = Number(b.actualCost);
  if (!b.actualDate || !Number.isFinite(actualCost) || actualCost < 0) {
    return res.status(400).json({ error: 'actualDate and non-negative actualCost are required' });
  }
  // On execution, a feedback report, attendance, expense bills and photos/documents are all mandatory.
  if (!b.completionRemarks || !String(b.completionRemarks).trim()) {
    return res.status(400).json({ error: 'A feedback report is required' });
  }
  const expenses = Array.isArray(b.expenses) ? b.expenses : [];
  if (!expenses.length) return res.status(400).json({ error: 'At least one expense (bill) line is required' });
  for (const e of expenses) {
    if (!EXPENSE_CATEGORIES.includes(e.category)) return res.status(400).json({ error: `Invalid expense category "${e.category}"` });
    if (!Number.isFinite(Number(e.amount)) || Number(e.amount) < 0) return res.status(400).json({ error: 'Expense amounts must be non-negative numbers' });
  }
  const sum = expenses.reduce((s, e) => s + Number(e.amount), 0);
  if (Math.abs(sum - actualCost) > 0.01) {
    return res.status(400).json({ error: `Expense breakup (${sum}) must equal actual cost (${actualCost})` });
  }
  const attendees = Array.isArray(b.attendees) ? b.attendees : [];
  if (!attendees.some((a) => a.attended)) return res.status(400).json({ error: 'At least one actual attendee must be recorded' });
  const attachments = Array.isArray(b.attachments) ? b.attachments : [];
  if (!attachments.length) return res.status(400).json({ error: 'At least one event photo or document must be attached' });

  await q.tx(async (t) => {
    await t.run(`UPDATE activities SET status='executed', actual_date=?, actual_venue=?, actual_cost=?, completion_remarks=?, updated_at=? WHERE id=?`,
      [b.actualDate, b.actualVenue || act.venue, actualCost, b.completionRemarks || '', now(), act.id]);
    for (const a of attendees) {
      await t.run(
        `INSERT INTO activity_participants (activity_id,account_id,account_type,proposed,invited,attended,remarks)
         VALUES (?,?,?,0,1,?,?)
         ON CONFLICT(activity_id,account_id,account_type)
         DO UPDATE SET attended=excluded.attended, invited=1, remarks=excluded.remarks`,
        [act.id, a.accountId, a.accountType, a.attended ? 1 : 0, a.remarks || '']);
    }
    await t.run('DELETE FROM expense_lines WHERE activity_id = ?', [act.id]);
    for (const e of expenses) {
      await t.run('INSERT INTO expense_lines (activity_id,category,amount,vendor,invoice_no) VALUES (?,?,?,?,?)',
        [act.id, e.category, Number(e.amount), e.vendor || '', e.invoiceNo || '']);
    }
    for (const f of b.attachments || []) {
      await t.run('INSERT INTO attachments (activity_id,kind,filename,mime,data_url,uploaded_by,uploaded_at) VALUES (?,?,?,?,?,?,?)',
        [act.id, f.kind || 'other', f.filename || 'attachment', f.mime || null, f.dataUrl || null, req.user.id, now()]);
    }
  });

  await audit(req, 'activity.execute', 'activity', act.id, { status: 'approved' },
    { status: 'executed', actualCost, attendees: attendees.filter((a) => a.attended).length });
  await notifyHO('executed', `${req.user.name} executed "${act.title}" (cost ${actualCost})`, 'activity', act.id);
  res.json({ ok: true });
}));

// ---------- append photos / documents (owner, append-only) ----------
router.post('/:id/attachments', requireRole('sales'), ah(async (req, res) => {
  const { act, error } = await scopedActivity(req, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  if (!['approved', 'executed', 'closed'].includes(act.status)) {
    return res.status(409).json({ error: 'Attachments can be added once the activity is approved' });
  }
  const files = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  if (!files.length) return res.status(400).json({ error: 'No attachments provided' });
  for (const f of files) {
    await q.run('INSERT INTO attachments (activity_id,kind,filename,mime,data_url,uploaded_by,uploaded_at) VALUES (?,?,?,?,?,?,?)',
      [act.id, f.kind || 'photo', f.filename || 'attachment', f.mime || null, f.dataUrl || null, req.user.id, now()]);
  }
  await audit(req, 'activity.add_attachments', 'activity', act.id, null, { count: files.length });
  res.json({ ok: true, count: files.length });
}));

// ---------- reopen (HO, audited) ----------
router.post('/:id/reopen', requireRole('ho'), ah(async (req, res) => {
  const act = await q.get('SELECT * FROM activities WHERE id = ?', [req.params.id]);
  if (!act) return res.status(404).json({ error: 'Activity not found' });
  if (act.status !== 'executed') return res.status(409).json({ error: 'Only executed activities can be reopened' });
  await q.run(`UPDATE activities SET status='approved', updated_at=? WHERE id=?`, [now(), act.id]);
  await audit(req, 'activity.reopen', 'activity', act.id, { status: 'executed' }, { status: 'approved', reason: req.body?.reason });
  await notify(act.proposed_by, 'reopened', `"${act.title}" was reopened by ${req.user.name} for corrections`, 'activity', act.id);
  res.json({ ok: true });
}));

// ---------- comments / feedback (operations <-> sales owner) ----------
// Visible to HO (operations, marketing, finance) and the activity's sales owner.
router.get('/:id/comments', ah(async (req, res) => {
  const { act, error } = await scopedActivity(req, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  res.json(await q.all(
    `SELECT id, author_id, author_name, author_role, body, created_at
     FROM activity_comments WHERE activity_id = ? ORDER BY id`, [act.id]));
}));

router.post('/:id/comments', ah(async (req, res) => {
  const { act, error } = await scopedActivity(req, req.params.id);
  if (error) return res.status(error[0]).json({ error: error[1] });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Comment text is required' });
  await q.run(
    `INSERT INTO activity_comments (activity_id,author_id,author_name,author_role,body,created_at) VALUES (?,?,?,?,?,?)`,
    [act.id, req.user.id, req.user.name, req.user.sub_role || req.user.role, body, now()]);
  await audit(req, 'activity.comment', 'activity', act.id, null, { body: body.slice(0, 200) });
  // Notify the other side so it shows up on their bell.
  if (req.user.role === 'ho') {
    await notify(act.proposed_by, 'comment', `${req.user.name} commented on "${act.title}" — please review`, 'activity', act.id);
  } else {
    await notifyHO('comment', `${req.user.name} replied on "${act.title}"`, 'activity', act.id);
  }
  res.json({ ok: true });
}));

module.exports = router;
module.exports.EXPENSE_CATEGORIES = EXPENSE_CATEGORIES;
