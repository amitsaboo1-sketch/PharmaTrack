import { api, session } from '../api.js';
import { h, kpiCard, table, badge, fmtMoney, fmtUnits, fmtPct, fmtDate, chartCanvas, makeChart, colors } from '../ui.js';

export default async function dashboardPage(root) {
  const user = session.user;
  // CM sees the all-country executive view; CLM (and SER) see the country view scoped to them.
  if (user.role === 'ho' || user.role === 'cm') return executive(root);
  return salesDash(root);
}

function pctCell(p, bold) {
  const val = p == null ? '—' : `${p.toFixed(0)}%`;
  const color = p == null ? 'var(--muted)' : p >= 100 ? 'var(--accent)' : p >= 90 ? 'var(--warn)' : 'var(--danger)';
  return bold ? h('b', { style: `color:${color}` }, val) : h('span', { style: `color:${color}; font-weight:600;` }, val);
}

async function executive(root) {
  const d = await api('/dashboards/executive');
  const c = d.cards;

  root.append(
    h('div', { class: 'grid cards-4' },
      kpiCard('Total Spend (executed)', fmtMoney(c.totalSpend),
        c.budgetUtilizationPct != null ? `${c.budgetUtilizationPct.toFixed(0)}% of planned budget` : ''),
      kpiCard('Activities', String(c.activities), `${c.completed} completed`),
      kpiCard('Pending Approvals', String(c.pendingApprovals), c.pendingApprovals ? 'Action needed' : 'All clear', c.pendingApprovals ? 'down' : 'up'),
      kpiCard('Blended Marketing Effectiveness', fmtPct(c.blendedRoiPct), `Incremental sales ${fmtMoney(c.incrementalSales)}`, (c.blendedRoiPct ?? 0) >= 0 ? 'up' : 'down')));

  const spendCanvas = chartCanvas();
  const typeCanvas = chartCanvas();
  const brandCanvas = chartCanvas();

  root.append(h('div', { class: 'grid cols-3-1', style: 'margin-top:14px;' },
    h('div', { class: 'card' },
      h('h3', {}, 'Monthly Marketing Spend vs Total Sales'),
      h('div', { class: 'chart-box' }, spendCanvas)),
    h('div', { class: 'card' },
      h('h3', {}, `Pending Approvals (${d.pendingList.length})`),
      d.pendingList.length
        ? d.pendingList.map((p) => h('div', { style: 'padding:8px 0; border-bottom:1px solid #f1f2f4;' },
            h('div', { style: 'font-weight:600; font-size:13px;' }, p.title),
            h('div', { class: 'sub', style: 'color:var(--muted); font-size:12px;' },
              `${p.proposer_name} · ${p.type_name} · ${fmtMoney(p.estimated_cost)} · ${fmtDate(p.planned_date)}`),
            h('button', { class: 'btn sm primary', style: 'margin-top:6px;', onclick: () => (location.hash = `#/activity/${p.id}`) }, 'Review')))
        : h('div', { class: 'empty' }, 'Nothing pending 🎉'))));

  root.append(h('div', { class: 'grid cols-2', style: 'margin-top:14px;' },
    h('div', { class: 'card' }, h('h3', {}, 'Spend by Activity Type'), h('div', { class: 'chart-box sm' }, typeCanvas)),
    h('div', { class: 'card' }, h('h3', {}, 'Marketing Effectiveness by Brand'), h('div', { class: 'chart-box sm' }, brandCanvas))));

  // ----- East Africa pool: consolidated performance per country (value; YoY), each own currency -----
  const pool = await api('/performance/pool');
  const ytdLabel = pool[0]?.ytdLabel || 'YTD';
  root.append(h('div', { class: 'card', style: 'margin-top:14px;' },
    h('h3', {}, `East Africa Pool — Country Performance (value, ${ytdLabel})`),
    h('div', { class: 'hint', style: 'margin-bottom:8px;' }, 'Value roll-up only — unit volumes are compared per product, not clubbed across products.'),
    table(['Country', 'Currency', 'Target Value', 'Achieved Value', 'Value %', 'YoY vs last year'],
      pool.map((p) => [
        h('a', { href: `#/country/${p.code}`, onclick: (e) => { e.preventDefault(); location.hash = '#/country/' + p.code; } }, p.name),
        p.currency,
        fmtMoney(p.overall.targetValue, p.currency), fmtMoney(p.overall.achievedValue, p.currency),
        pctCell(p.overall.valuePct),
        h('b', { style: `color:${(p.yoy?.valueYoYPct ?? 0) >= 0 ? 'var(--accent)' : 'var(--danger)'}` }, fmtPct(p.yoy?.valueYoYPct)),
      ]))));

  root.append(h('div', { class: 'card', style: 'margin-top:14px;' },
    h('h3', {}, 'Rep Performance Leaderboard (marketing effectiveness)'),
    table(['Representative', 'Country', 'Activities', 'Spend', 'Incremental Sales', 'Marketing Effectiveness'],
      d.repRoi.map((r) => [r.label, r.sublabel, String(r.activities), fmtMoney(r.cost), fmtMoney(r.incremental),
        h('b', { style: `color:${(r.roiPct ?? 0) >= 0 ? 'var(--accent)' : 'var(--danger)'}` }, fmtPct(r.roiPct))]))));

  const months = [...new Set([...d.monthlySpend.map((m) => m.month), ...d.monthlySales.map((m) => m.month)])].sort();
  makeChart(spendCanvas, {
    data: { labels: months, datasets: [
      { type: 'bar', label: 'Marketing spend', data: months.map((m) => d.monthlySpend.find((x) => x.month === m)?.spend || 0), backgroundColor: '#4f46e5', borderRadius: 5, yAxisID: 'y1' },
      { type: 'line', label: 'Total sales', data: months.map((m) => d.monthlySales.find((x) => x.month === m)?.sales || 0), borderColor: '#059669', backgroundColor: '#059669', tension: .35, yAxisID: 'y' }] },
    options: { scales: { y: { position: 'left' }, y1: { position: 'right', grid: { drawOnChartArea: false } } } },
  });
  makeChart(typeCanvas, { type: 'doughnut',
    data: { labels: d.spendByType.map((x) => x.type), datasets: [{ data: d.spendByType.map((x) => x.spend), backgroundColor: colors(d.spendByType.length) }] } });
  makeChart(brandCanvas, { type: 'bar',
    data: { labels: d.brandRoi.map((b) => b.label), datasets: [{ label: 'Marketing Effectiveness %', data: d.brandRoi.map((b) => b.roiPct), backgroundColor: d.brandRoi.map((b) => (b.roiPct ?? 0) >= 0 ? '#059669' : '#dc2626'), borderRadius: 5 }] },
    options: { plugins: { legend: { display: false } } } });
}

async function salesDash(root) {
  const d = await api('/dashboards/sales');
  const perf = d.performance;
  const cur = d.country ? d.country.currency : null;
  if (!perf) { root.append(h('div', { class: 'empty' }, 'No country assigned to your profile — contact Admin.')); return; }
  const o = perf.overall;

  root.append(h('div', { class: 'page-head' },
    h('h2', { style: 'font-size:17px;' }, `${d.country.name} — consolidated performance`),
    h('span', { class: 'hint' }, `Pooled territory · ${perf.fyLabel} · YTD ${perf.ytdLabel} · reported in ${d.country.currency}`)));

  const ring = (label, achievedTxt, targetTxt, p) => h('div', { class: 'card kpi' },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, p == null ? '—' : `${p.toFixed(0)}%`),
    h('div', { class: 'sub' }, `${achievedTxt} of ${targetTxt}`),
    h('div', { class: 'progress' }, h('div', { class: (p ?? 0) < 95 ? 'warn' : '', style: `width:${Math.min(100, p ?? 0)}%` })));

  root.append(h('div', { class: 'grid cards-4' },
    ring('Value Achievement (YTD)', fmtMoney(o.achievedValue, cur), fmtMoney(o.targetValue, cur), o.valuePct),
    kpiCard('YoY Growth (value)', fmtPct(perf.yoy.valueYoYPct), `vs ${perf.yoy.lastFyLabel} same period`, (perf.yoy.valueYoYPct ?? 0) >= 0 ? 'up' : 'down'),
    kpiCard('My Activity Marketing Effectiveness (account-wise)', fmtPct(d.myRoiPct), `Spend ${fmtMoney(d.totalSpend, cur)} → +${fmtMoney(d.incrementalSales, cur)}`, (d.myRoiPct ?? 0) >= 0 ? 'up' : 'down'),
    kpiCard('My Approvals Pending', String(d.statusCounts.submitted || 0), `${d.statusCounts.approved || 0} approved · ${d.statusCounts.draft || 0} draft`)));

  // Brand-wise: units per brand (NOT clubbed), value + %
  root.append(h('div', { class: 'card', style: 'margin-top:14px;' },
    h('h3', {}, `Brand-wise Target vs Achievement — ${d.country.name} (${d.country.currency}) · YTD ${perf.ytdLabel}`),
    h('div', { class: 'hint', style: 'margin-bottom:8px;' }, 'Units are shown per brand/product only — they are not summed across products. The overall figure is by value.'),
    table(['Brand', 'Target Units', 'Achieved Units', 'Units %', 'Target Value', 'Achieved Value', 'Value %'],
      [...perf.brands.map((b) => [
        h('b', {}, b.brandName), fmtUnits(b.targetUnits), fmtUnits(b.achievedUnits), pctCell(b.unitsPct),
        fmtMoney(b.targetValue, cur), fmtMoney(b.achievedValue, cur), pctCell(b.valuePct)]),
       [h('b', {}, 'Overall (value)'), h('span', { class: 'hint' }, '—'), h('span', { class: 'hint' }, '—'), h('span', { class: 'hint' }, '—'),
        h('b', {}, fmtMoney(o.targetValue, cur)), h('b', {}, fmtMoney(o.achievedValue, cur)), pctCell(o.valuePct, true)]])));

  const trendCanvas = chartCanvas();
  const brandCanvas = chartCanvas();
  root.append(h('div', { class: 'grid cols-2', style: 'margin-top:14px;' },
    h('div', { class: 'card' }, h('h3', {}, `Monthly Target vs Achievement (Value, ${cur})`), h('div', { class: 'chart-box sm' }, trendCanvas)),
    h('div', { class: 'card' }, h('h3', {}, 'Monthly Brand Achievement % (Value)'), h('div', { class: 'chart-box sm' }, brandCanvas))));

  const daApproved = (d.daSummary.find((s) => s.status === 'approved') || {}).da_total || 0;
  const daPending = (d.daSummary.find((s) => s.status === 'submitted') || {}).da_total || 0;
  root.append(h('div', { class: 'grid cols-2', style: 'margin-top:14px;' },
    h('div', { class: 'card' },
      h('h3', {}, 'My Recent Activities'),
      table(['Activity', 'Type', 'Date', 'Status'],
        d.activities.slice(0, 6).map((a) => [a.title, a.type_name, fmtDate(a.actual_date || a.planned_date), badge(a.status)]),
        (i) => (location.hash = `#/activity/${d.activities[i].id}`))),
    h('div', { class: 'card' },
      h('h3', {}, 'My Daily Allowance'),
      h('div', { class: 'grid cards-4' }, kpiCard('Approved', fmtMoney(daApproved, cur)), kpiCard('Pending', fmtMoney(daPending, cur))),
      h('button', { class: 'btn primary sm', style: 'margin-top:10px;', onclick: () => (location.hash = '#/daily-allowance') }, 'Open Daily Allowance'))));

  makeChart(trendCanvas, {
    data: { labels: perf.monthly.map((m) => m.label), datasets: [
      { type: 'bar', label: 'Achieved', data: perf.monthly.map((m) => m.achievedValue), backgroundColor: '#059669', borderRadius: 5 },
      { type: 'line', label: 'Target', data: perf.monthly.map((m) => m.targetValue), borderColor: '#4f46e5', tension: .3 }] },
  });
  makeChart(brandCanvas, { type: 'bar',
    data: { labels: perf.brands.map((b) => b.brandName), datasets: [{ label: 'Value %', data: perf.brands.map((b) => b.valuePct), backgroundColor: perf.brands.map((b) => (b.valuePct ?? 0) >= 100 ? '#059669' : '#d97706'), borderRadius: 5 }] },
    options: { plugins: { legend: { display: false } } } });
}
