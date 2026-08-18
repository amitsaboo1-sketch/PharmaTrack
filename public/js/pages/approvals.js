import { api, session } from '../api.js';
import { h, table, fmtMoney, fmtDate } from '../ui.js';

const STAGE_LABEL = { clm: 'Cluster Lead (CLM)', cm: 'Country Manager (CM)', marketing: 'Marketing' };

export default async function approvalsPage(root) {
  const user = session.user;
  // Only what is awaiting THIS approver's turn in the SER → CLM → CM → Marketing chain.
  const acts = await api('/activities?pending=mine');
  const myStage = user.role === 'clm' ? 'clm' : user.role === 'cm' ? 'cm' : 'marketing';
  root.append(h('div', { class: 'card' },
    h('h3', {}, `Awaiting your approval — ${STAGE_LABEL[myStage]} (${acts.length})`),
    table(['Activity', 'Type / Brand', 'Proposed by', 'Country', 'Planned', 'Est. Cost', 'Target HCPs'],
      acts.map((a) => [
        h('div', {}, h('b', {}, a.title), h('div', { class: 'sub' }, a.id)),
        `${a.type_name || ''}${a.brand_name ? ' · ' + a.brand_name : ''}`,
        a.proposer_name, a.country || '—', fmtDate(a.planned_date), fmtMoney(a.estimated_cost), String(a.proposed_hcps),
      ]),
      (i) => (location.hash = `#/activity/${acts[i].id}`))));
  const nextTxt = myStage === 'clm' ? 'Approved items advance to the Country Manager (CM).'
    : myStage === 'cm' ? 'Approved items advance to Marketing for final sign-off.'
    : 'Approving here grants final approval.';
  root.append(h('div', { class: 'hint', style: 'margin-top:10px;' },
    `Open an activity to approve, return for modification, or reject (remarks are mandatory for return/reject). ${nextTxt}`));
}
