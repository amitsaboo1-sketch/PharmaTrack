const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { q } = require('../db/connection');

// Verifies JWT and attaches the fresh user record to req.user.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  try {
    const user = await q.get('SELECT * FROM users WHERE id = ? AND active = 1', [payload.sub]);
    if (!user) return res.status(401).json({ error: 'User not found or deactivated' });
    delete user.password_hash;
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Admin = HO user with Admin sub_role.
function requireAdmin(req, res, next) {
  if (req.user?.role === 'ho' && req.user.sub_role === 'Admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
}

// Marketing = HO product/marketing managers. Only they can approve/reject activities
// (Operations/Admin and Finance cannot).
const MARKETING_ROLES = ['Product Manager', 'Marketing Head'];
function isMarketing(user) {
  return !!user && user.role === 'ho' && MARKETING_ROLES.includes(user.sub_role);
}
function requireMarketing(req, res, next) {
  if (isMarketing(req.user)) return next();
  return res.status(403).json({ error: 'Only Marketing can approve or reject activities' });
}

// True when the user may see rows belonging to repId.
function canSeeRep(user, repId) {
  return user.role === 'ho' || user.id === repId;
}

module.exports = { requireAuth, requireRole, requireAdmin, requireMarketing, isMarketing, MARKETING_ROLES, canSeeRep };
