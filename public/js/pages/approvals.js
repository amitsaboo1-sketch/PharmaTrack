import { api } from '../api.js';
import { h, table, fmtMoney, fmtDate } from '../ui.js';

export default async function approvalsPage(root) {
  const acts = await api('/activities?status=submitted');
  root.append(h('div', { class: 'card' },
    h('h3', {}, `Awaiting decision (${acts.length})`),
    table(['Activity', 'Type / Brand', 'Proposed by', 'Planned', 'Est. Cost', 'Target HCPs'],
      acts.map((a) => [
        h('div', {}, h('b', {}, a.title), h('div', { class: 'sub' }, a.id)),
        `${a.type_name || ''}${a.brand_name ? ' · ' + a.brand_name : ''}`,
        a.proposer_name, fmtDate(a.planned_date), fmtMoney(a.estimated_cost), String(a.proposed_hcps),
      ]),
      (i) => (location.hash = `#/activity/${acts[i].id}`))));
  root.append(h('div', { class: 'hint', style: 'margin-top:10px;' },
    'Open an activity to approve, return for modification, or reject (remarks are mandatory for return/reject).'));
}
