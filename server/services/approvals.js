// Shared sequential-approval engine. Everything a SER submits climbs the chain:
//   SER -> CLM (cluster lead of that country) -> CM (country manager) -> final approver.
// Activities finish at Marketing; field verification at Marketing then Admin; DA at Admin.
//
// VACANCY / ESCALATION: a seat can be empty (no CLM appointed for a country, CM on leave, etc.).
// Because a vacant seat can never approve, items simply pile up AT that stage — they never
// advance past it. The rule that keeps the pipeline moving:
//   • You always act on your own stage.
//   • You may act on a LOWER stage when that seat is currently vacant (authority flows upward:
//     a CM covers a country with no CLM; Marketing covers a missing CM; and so on).
//   • Admin (Operations) is the universal break-glass — it can act on ANY stage whose seat is
//     vacant, even outside its own chain (e.g. approve an activity if Marketing is unfilled).
// Everything is audited with who acted, so an escalated approval is traceable.

const MARKETING_ROLES = ['Product Manager', 'Marketing Head'];

const CHAINS = {
  activity: ['clm', 'cm', 'marketing'],
  verify: ['clm', 'cm', 'marketing', 'admin'],
  da: ['clm', 'cm', 'admin'],
};

const STAGE_LABEL = { clm: 'Cluster Lead (CLM)', cm: 'Country Manager (CM)', marketing: 'Marketing', admin: 'Admin' };

// Field-flag conditions that place an hcp/chemist row at a given verification stage.
const ADD_FLAG = {
  clm: 'clm_ok=0 AND verified=0 AND pending_removal=0',
  cm: 'clm_ok=1 AND cm_ok=0 AND verified=0 AND pending_removal=0',
  marketing: 'cm_ok=1 AND mkt_verified=0 AND verified=0 AND pending_removal=0',
  admin: 'mkt_verified=1 AND verified=0 AND pending_removal=0',
};
const REM_FLAG = {
  clm: 'pending_removal=1 AND removal_clm_ok=0',
  cm: 'pending_removal=1 AND removal_clm_ok=1 AND removal_cm_ok=0',
  marketing: 'pending_removal=1 AND removal_cm_ok=1 AND removal_mkt_ok=0',
  admin: 'pending_removal=1 AND removal_mkt_ok=1',
};

function nextStage(chain, stage) {
  const i = chain.indexOf(stage);
  return i >= 0 && i < chain.length - 1 ? chain[i + 1] : null;
}

// Can `user` act at `stage` for an item in `country` (code)? CLM is scoped to their own country.
function canActAtStage(user, stage, country) {
  if (!user) return false;
  if (stage === 'clm') return user.role === 'clm' && user.country === country;
  if (stage === 'cm') return user.role === 'cm';
  if (stage === 'marketing') return user.role === 'ho' && MARKETING_ROLES.includes(user.sub_role);
  if (stage === 'admin') return user.role === 'ho' && user.sub_role === 'Admin';
  return false;
}

// Which single stage (if any) is this user the approver for, generically?
function stageForUser(user) {
  if (!user) return null;
  if (user.role === 'clm') return 'clm';
  if (user.role === 'cm') return 'cm';
  if (user.role === 'ho' && MARKETING_ROLES.includes(user.sub_role)) return 'marketing';
  if (user.role === 'ho' && user.sub_role === 'Admin') return 'admin';
  return null;
}

// --- Vacancy helpers ---------------------------------------------------------

// TRUE when `stage` currently has at least one active approver (for CLM, in `country`).
async function stageHasApprover(q, stage, country) {
  let sql; let args = [];
  if (stage === 'clm') { sql = "SELECT COUNT(*) AS c FROM users WHERE role='clm' AND country=? AND active=1"; args = [country]; }
  else if (stage === 'cm') sql = "SELECT COUNT(*) AS c FROM users WHERE role='cm' AND active=1";
  else if (stage === 'marketing') sql = "SELECT COUNT(*) AS c FROM users WHERE role='ho' AND sub_role IN ('Product Manager','Marketing Head') AND active=1";
  else if (stage === 'admin') sql = "SELECT COUNT(*) AS c FROM users WHERE role='ho' AND sub_role='Admin' AND active=1";
  else return true;
  const row = await q.get(sql, args);
  return !!(row && Number(row.c) > 0);
}

// SQL predicate (string) that is TRUE for a row whose `stage` seat is vacant. `countryCol` is the
// name of the row's country column (e.g. 'a.country', 'd.country_code', 'country'). Stage names
// come from CHAINS constants only — never user input — so string interpolation here is safe.
function vacantPredicate(stage, countryCol) {
  if (stage === 'clm') return `${countryCol} NOT IN (SELECT country FROM users WHERE role='clm' AND active=1 AND country IS NOT NULL)`;
  if (stage === 'cm') return "NOT EXISTS (SELECT 1 FROM users WHERE role='cm' AND active=1)";
  if (stage === 'marketing') return "NOT EXISTS (SELECT 1 FROM users WHERE role='ho' AND sub_role IN ('Product Manager','Marketing Head') AND active=1)";
  if (stage === 'admin') return "NOT EXISTS (SELECT 1 FROM users WHERE role='ho' AND sub_role='Admin' AND active=1)";
  return '0=1';
}

// Decision-time authority check for one item (country known): own stage, or a vacant lower
// stage, or Admin break-glass on any vacant stage.
async function canActResolved(q, user, chain, stage, country) {
  const userStage = stageForUser(user);
  if (stage === userStage && canActAtStage(user, stage, country)) return true;
  const idx = chain.indexOf(userStage);
  const si = chain.indexOf(stage);
  if (idx >= 0 && si >= 0 && si < idx) {                    // acting downward on a vacant lower stage
    return !(await stageHasApprover(q, stage, country));
  }
  if (user.role === 'ho' && user.sub_role === 'Admin' && idx < 0) {  // break-glass outside own chain
    return !(await stageHasApprover(q, stage, country));
  }
  return false;
}

// WHERE fragment (no status filter) selecting items this user may currently act on, for a chain
// that stores its stage in a column. `cols` = { stage, country } column names.
function pendingCondition(user, chain, cols) {
  const userStage = stageForUser(user);
  const idx = chain.indexOf(userStage);
  const ors = []; const params = [];
  if (idx >= 0) {
    if (userStage === 'clm') { ors.push(`(${cols.stage}='clm' AND ${cols.country}=?)`); params.push(user.country); }
    else ors.push(`${cols.stage}='${userStage}'`);
    for (let k = 0; k < idx; k++) {                          // vacant lower stages
      const st = chain[k];
      ors.push(`(${cols.stage}='${st}' AND ${vacantPredicate(st, cols.country)})`);
    }
  } else if (user.role === 'ho' && user.sub_role === 'Admin') {   // break-glass in a chain without admin
    for (const st of chain) ors.push(`(${cols.stage}='${st}' AND ${vacantPredicate(st, cols.country)})`);
  }
  return { sql: ors.length ? '(' + ors.join(' OR ') + ')' : '0=1', params };
}

// WHERE fragment for the flag-based verification tables (no approval_stage column). `flagMap` is
// ADD_FLAG or REM_FLAG. Own stage + vacant lower stages (admin is inside the verify chain).
function verifyPendingCondition(user, flagMap) {
  const userStage = stageForUser(user);
  const idx = CHAINS.verify.indexOf(userStage);
  const ors = []; const params = [];
  if (idx < 0) return { sql: '0=1', params };
  if (userStage === 'clm') { ors.push(`(${flagMap.clm} AND country=?)`); params.push(user.country); }
  else ors.push(`(${flagMap[userStage]})`);
  for (let k = 0; k < idx; k++) {
    const st = CHAINS.verify[k];
    ors.push(`(${flagMap[st]} AND ${vacantPredicate(st, 'country')})`);
  }
  return { sql: '(' + ors.join(' OR ') + ')', params };
}

module.exports = {
  CHAINS, STAGE_LABEL, ADD_FLAG, REM_FLAG, MARKETING_ROLES,
  nextStage, canActAtStage, stageForUser,
  stageHasApprover, canActResolved, pendingCondition, verifyPendingCondition, vacantPredicate,
};
