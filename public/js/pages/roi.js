import { api, session } from '../api.js';
import { h, table, fmtMoney, fmtPct } from '../ui.js';

export default async function roiPage(root) {
  let scope = 'hcp';
  const box = h('div');
  const tabs = h('div', { class: 'step-tabs' });
  root.append(
    h('div', { class: 'hint', style: 'margin-bottom:10px;' },
      'Attribution model: Before-vs-After monthly average (window configurable in Settings). A doctor\'s sales stream = direct doctor-tagged sales + sales of their mapped chemists.'),
    tabs, box);

  const scopes = [['hcp', 'Doctor ROI'], ['chemist', 'Chemist / Wholesaler ROI'], ['employee', 'Employee ROI'], ['brand', 'Brand ROI']];

  function renderTabs() {
    tabs.innerHTML = '';
    scopes.forEach(([key, label]) => {
      if (session.user.role === 'sales' && (key === 'brand' || key === 'employee')) return;
      tabs.append(h('button', {
        class: `step ${scope === key ? 'active' : ''}`, style: 'border:0; cursor:pointer;',
        onclick: () => { scope = key; load(); },
      }, label));
    });
  }

  async function load() {
    renderTabs();
    const rows = await api(`/roi/leaderboard?scope=${scope}`);
    const headers = {
      hcp: ['Doctor', 'Speciality', 'Activities', 'Allocated Cost', 'Incremental Sales', 'ROI'],
      chemist: ['Chemist / Wholesaler', 'Type', 'Activities', 'Allocated Cost', 'Incremental Sales', 'ROI'],
      employee: ['Employee', 'Territory', 'Activities', 'Spend', 'Incremental Sales', 'ROI'],
      brand: ['Brand', 'Therapy Area', 'Activities', 'Spend', 'Incremental Sales', 'ROI'],
    }[scope];
    const link = (r) => scope === 'hcp' ? h('a', { href: `#/doctor/${r.key}` }, r.label)
      : scope === 'chemist' ? h('a', { href: `#/chemist/${r.key}` }, r.label) : h('b', {}, r.label);
    box.innerHTML = '';
    box.append(h('div', { class: 'card' },
      table(headers, rows.map((r) => [
        link(r), r.sublabel || '—', String(r.activities), fmtMoney(r.cost), fmtMoney(r.incremental),
        r.roiPct == null
          ? h('span', { class: 'hint' }, 'insufficient data')
          : h('b', { style: `color:${r.roiPct >= 0 ? 'var(--accent)' : 'var(--danger)'}` }, fmtPct(r.roiPct)),
      ]))));
  }
  await load();
}
