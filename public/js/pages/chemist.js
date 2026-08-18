import { api, session } from '../api.js';
import { h, table, badge, kpiCard, fmtMoney, fmtUnits, fmtPct, fmtDate, chartCanvas, makeChart } from '../ui.js';
import { requestRemoval } from './masters.js';

export default async function chemistPage(root, id) {
  if (!id) { root.append(h('div', { class: 'empty' }, 'No chemist selected')); return; }
  const d = await api(`/chemists/${id}/profile`);
  const c = d.chemist;
  const canRemove = session.user.role === 'sales' && c.rep_id === session.user.id;

  const typeColor = { Retail: '#0891b2', Wholesaler: '#7c3aed', Stockist: '#d97706' }[c.type] || '#6b7280';
  root.append(h('div', { class: 'page-head' },
    h('button', { class: 'btn sm', onclick: () => (location.hash = '#/chemists') }, '← Back'),
    h('h2', { style: 'font-size:18px;' }, c.name),
    h('span', { style: `font-weight:700; color:${typeColor};` }, c.type || 'Retail'),
    h('span', { class: 'hint' }, `${c.address || ''} · ${c.city || ''}`),
    c.verified ? h('span', { class: 'badge ok' }, 'Verified') : h('span', { class: 'badge unverified' }, 'Unverified'),
    h('div', { class: 'spacer' }),
    c.pending_removal
      ? h('span', { class: 'badge unverified' }, 'Removal requested')
      : (canRemove ? h('button', { class: 'btn sm danger', onclick: () => requestRemoval('chemist', c) }, 'Request removal') : null)));

  root.append(h('div', { class: 'grid cards-4' },
    kpiCard('Trade-Activity Spend (allocated)', fmtMoney(d.historicalSpend)),
    kpiCard('Incremental Sales', fmtMoney(d.incremental)),
    kpiCard('Account Marketing Effectiveness', fmtPct(d.roiPct), null, (d.roiPct ?? 0) >= 0 ? 'up' : 'down'),
    kpiCard('Activities', String(d.engagements.length), `${d.engagements.filter((e) => e.attended).length} attended`)));

  const trendCanvas = chartCanvas();
  root.append(h('div', { class: 'grid cols-3-1', style: 'margin-top:14px;' },
    h('div', { class: 'card' },
      h('h3', {}, 'Monthly Sales (this account)'),
      h('div', { class: 'chart-box' }, trendCanvas)),
    h('div', { class: 'card' },
      h('h3', {}, 'Dispensing for Doctors'),
      d.mappedDoctors.length
        ? d.mappedDoctors.map((doc) => h('div', { style: 'padding:7px 0; border-bottom:1px solid #f1f2f4; font-size:13px;' },
            h('a', { href: `#/doctor/${doc.id}` }, doc.name),
            h('div', { class: 'sub', style: 'color:var(--muted); font-size:12px;' }, `${doc.speciality || ''} · ${doc.class || ''}`)))
        : h('div', { class: 'empty' }, 'No doctors mapped'))));

  root.append(h('div', { class: 'card', style: 'margin-top:14px;' },
    h('h3', {}, 'Trade Activities'),
    table(['Activity', 'Type', 'Date', 'Status', 'Attended', 'Cost'],
      d.engagements.map((e) => [
        h('a', { href: `#/activity/${e.id}` }, e.title), e.type_id,
        fmtDate(e.actual_date || e.planned_date), badge(e.status),
        e.attended ? h('b', { style: 'color:var(--accent)' }, '✔') : (e.proposed ? 'proposed' : '—'),
        e.actual_cost != null ? fmtMoney(e.actual_cost) : fmtMoney(e.estimated_cost)]))));

  makeChart(trendCanvas, {
    data: {
      labels: d.trend.map((t) => t.month),
      datasets: [
        { type: 'bar', label: 'Sales value', data: d.trend.map((t) => t.sales), backgroundColor: '#0891b2', borderRadius: 5, yAxisID: 'y' },
        { type: 'line', label: 'Units', data: d.trend.map((t) => t.units), borderColor: '#d97706', tension: .3, yAxisID: 'y1' },
      ],
    },
    options: { scales: { y: { position: 'left' }, y1: { position: 'right', grid: { drawOnChartArea: false } } } },
  });
}
