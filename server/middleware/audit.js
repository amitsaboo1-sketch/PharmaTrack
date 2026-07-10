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

module.exports = { audit, notify, notifyHO };
