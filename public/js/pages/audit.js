import { api } from '../api.js';
import { h, table, badge, fmtDate } from '../ui.js';

export default async function auditPage(root) {
  const disc = await api('/audit/discrepancies');
  root.append(h('div', { class: 'card', style: 'margin-bottom:14px;' },
    h('h3', {}, `Discrepancy Audit (${disc.length} findings)`),
    table(['Severity', 'Finding', 'Activity', 'Owner', 'Detail'],
      disc.map((f) => [
        badge(f.severity),
        { proposed_absent: 'Proposed but absent', unproposed_attendee: 'Unproposed attendee', unverified_account: 'Unverified account used', cost_overrun: 'Cost overrun' }[f.kind] || f.kind,
        h('a', { href: `#/activity/${f.activityId}` }, f.activity),
        f.proposer, f.detail]))));

  const logs = await api('/audit');
  root.append(h('div', { class: 'card' },
    h('h3', {}, 'Audit Trail (latest 300 events — append-only)'),
    table(['When', 'User', 'Action', 'Entity', 'Change'],
      logs.map((l) => [
        h('span', { class: 'mono' }, fmtDate(l.at)),
        l.user_id || '—', l.action,
        l.entity_type ? `${l.entity_type} ${l.entity_id || ''}` : '—',
        l.after_json ? h('span', { class: 'hint', style: 'font-size:11.5px;' }, l.after_json.slice(0, 90)) : '—']))));
}
