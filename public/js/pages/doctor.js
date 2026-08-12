import { api } from '../api.js';
import { h, table, badge, kpiCard, fmtMoney, fmtPct, fmtDate, chartCanvas, makeChart } from '../ui.js';

export default async function doctorPage(root, id) {
  if (!id) { root.append(h('div', { class: 'empty' }, 'No doctor selected')); return; }
  const d = await api(`/hcps/${id}/profile`);
  const x = d.hcp;

  root.append(h('div', { class: 'page-head' },
    h('button', { class: 'btn sm', onclick: () => (location.hash = '#/doctors') }, '← Back'),
    h('h2', { style: 'font-size:18px;' }, x.name),
    h('span', { class: 'hint' }, `${x.speciality || ''} · ${x.clinic || ''} · ${x.city || ''} · Class ${x.class || '—'} · Category ${x.category || '—'}`),
    x.verified ? h('span', { class: 'badge ok' }, 'Verified') : h('span', { class: 'badge unverified' }, 'Unverified')));

  root.append(h('div', { class: 'grid cards-4' },
    kpiCard('Historical Spend (allocated)', fmtMoney(d.historicalSpend)),
    kpiCard('Incremental Sales', fmtMoney(d.incremental)),
    kpiCard('Doctor Marketing Effectiveness', fmtPct(d.roiPct), null, (d.roiPct ?? 0) >= 0 ? 'up' : 'down'),
    kpiCard('Engagements', String(d.engagements.length), `${d.engagements.filter((e) => e.attended).length} attended`)));

  const trendCanvas = chartCanvas();
  root.append(h('div', { class: 'grid cols-3-1', style: 'margin-top:14px;' },
    h('div', { class: 'card' },
      h('h3', {}, 'Attributed Monthly Sales (own + mapped chemists)'),
      h('div', { class: 'chart-box' }, trendCanvas)),
    h('div', { class: 'card' },
      h('h3', {}, 'Mapped Chemists'),
      d.mappedChemists.length
        ? d.mappedChemists.map((c) => h('div', { style: 'padding:7px 0; border-bottom:1px solid #f1f2f4; font-size:13px;' },
            h('b', {}, c.name), h('div', { class: 'sub', style: 'color:var(--muted); font-size:12px;' }, c.address || '')))
        : h('div', { class: 'empty' }, 'No chemists mapped — sales attribution will be limited'))));

  root.append(h('div', { class: 'card', style: 'margin-top:14px;' },
    h('h3', {}, 'Engagement Timeline'),
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
        { type: 'bar', label: 'Sales', data: d.trend.map((t) => t.sales), backgroundColor: '#4f46e5', borderRadius: 5 },
        { type: 'line', label: 'Prescriptions', data: d.trend.map((t) => t.rx), borderColor: '#d97706', tension: .3, yAxisID: 'y1' },
      ],
    },
    options: { scales: { y1: { position: 'right', grid: { drawOnChartArea: false } } } },
  });
}
