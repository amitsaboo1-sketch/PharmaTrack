// Shared sequential-approval engine. Everything a SER submits climbs the chain:
//   SER -> CLM (cluster lead of that country) -> CM (country manager) -> final approver.
// Activities finish at Marketing; field verification at Marketing then Admin; DA at Admin.

const MARKETING_ROLES = ['Product Manager', 'Marketing Head'];

const CHAINS = {
  activity: ['clm', 'cm', 'marketing'],
  verify: ['clm', 'cm', 'marketing', 'admin'],
  da: ['clm', 'cm', 'admin'],
};

const STAGE_LABEL = { clm: 'Cluster Lead (CLM)', cm: 'Country Manager (CM)', marketing: 'Marketing', admin: 'Admin' };

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

module.exports = { CHAINS, STAGE_LABEL, nextStage, canActAtStage, stageForUser, MARKETING_ROLES };
