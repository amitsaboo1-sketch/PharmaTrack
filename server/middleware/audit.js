const { q } = require('../db/connection');

async function audit(req, action, entityType, entityId, before, after) {
  await q.run(
    `INSERT INTO audit_log (at,user_id,action,entity_type,entity_id,before_json,after_json,ip)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      new Date().toISOString(),
      req.user ? req.user.id : null,
      action,
      entityType || null,
      entityId != null ? String(entityId) : null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      req.ip || null,
    ]
  );
}

async function notify(userId, type, message, entityType, entityId) {
  await q.run(
    `INSERT INTO notifications (user_id,type,message,entity_type,entity_id,created_at)
     VALUES (?,?,?,?,?,?)`,
    [userId, type, message, entityType || null, entityId != null ? String(entityId) : null, new Date().toISOString()]
  );
}

// Notify every active HO user (e.g. new submission awaiting approval).
async function notifyHO(type, message, entityType, entityId) {
  const hos = await q.all(`SELECT id FROM users WHERE role = 'ho' AND active = 1`);
  for (const u of hos) await notify(u.id, type, message, entityType, entityId);
}

// Notify whoever approves at a given chain stage (CLM is scoped to `country`).
async function notifyStage(stage, country, message, entityType, entityId) {
  let rows = [];
  if (stage === 'clm') rows = await q.all(`SELECT id FROM users WHERE role='clm' AND country=? AND active=1`, [country]);
  else if (stage === 'cm') rows = await q.all(`SELECT id FROM users WHERE role='cm' AND active=1`);
  else if (stage === 'marketing') rows = await q.all(`SELECT id FROM users WHERE role='ho' AND sub_role IN ('Product Manager','Marketing Head') AND active=1`);
  else if (stage === 'admin') rows = await q.all(`SELECT id FROM users WHERE role='ho' AND sub_role='Admin' AND active=1`);
  for (const u of rows) await notify(u.id, 'approval', message, entityType, entityId);
}

module.exports = { audit, notify, notifyHO, notifyStage };
