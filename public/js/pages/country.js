import { api } from '../api.js';
import { h, table, kpiCard, fmtMoney, fmtUnits, fmtPct, chartCanvas, makeChart } from '../ui.js';

export default async function countryPage(root, code) {
  if (!code) { root.append(h('div', { class: 'empty' }, 'No country selected')); return; }
  const [perf, prod] = await Promise.all([
    api(`/performance/country/${code}`),
    api(`/performance/country/${code}/products`).catch(() => null),
  ]);
  const cur = perf.country.currency;
  const o = perf.overall;

  root.append(h('div', { class: 'page-head' },
    h('button', { class: 'btn sm', onclick: () => (location.hash = '#/dashboard') }, '← Pool'),
    h('h2', { style: 'font-size:18px;' }, `${perf.country.name} — Consolidated Performance`),
    h('span', { class: 'hint' }, `${perf.fyLabel} · YTD ${perf.ytdLabel} · ${perf.country.currency}`)));

  root.append(h('div', { class: 'grid cards-4' },
    kpiCard('Value Achievement (YTD)', o.valuePct == null ? '—' : `${o.valuePct.toFixed(0)}%`, `${fmtMoney(o.achievedValue, cur)} / ${fmtMoney(o.targetValue, cur)}`, (o.valuePct ?? 0) >= 100 ? 'up' : 'down'),
    kpiCard('YoY Growth (value)', fmtPct(perf.yoy.valueYoYPct), `vs ${perf.yoy.lastFyLabel}`, (perf.yoy.valueYoYPct ?? 0) >= 0 ? 'up' : 'down'),
    kpiCard('Brands', String(perf.brands.length)),
    kpiCard('Currency', perf.country.currency, perf.country.symbol)));

  root.append(h('div', { class: 'card', style: 'margin-top:14px;' },
    h('h3', {}, 'Brand-wise Target vs Achievement (units per brand; value overall)'),
    table(['Brand', 'Target Units', 'Achieved Units', 'Units %', 'Target Value', 'Achieved Value', 'Value %'],
      perf.brands.map((b) => [
        h('b', {}, b.brandName), fmtUnits(b.targetUnits), fmtUnits(b.achievedUnits), pctCell(b.unitsPct),
        fmtMoney(b.targetValue, cur), fmtMoney(b.achievedValue, cur), pctCell(b.valuePct)]))));

  const trendCanvas = chartCanvas();
  root.append(h('div', { class: 'card', style: 'margin-top:14px;' },
    h('h3', {}, `Monthly Target vs Achievement (Value, ${cur}) — YTD`),
    h('div', { class: 'chart-box' }, trendCanvas)));
  makeChart(trendCanvas, {
    data: { labels: perf.monthly.map((m) => m.label), datasets: [
      { type: 'bar', label: 'Achieved', data: perf.monthly.map((m) => m.achievedValue), backgroundColor: '#059669', borderRadius: 5 },
      { type: 'line', label: 'Target', data: perf.monthly.map((m) => m.targetValue), borderColor: '#4f46e5', tension: .3 }] },
  });

  // Year-on-year per product (this FY YTD vs last FY)
  if (prod && prod.products.length) {
    root.append(h('div', { class: 'card', style: 'margin-top:14px;' },
      h('h3', {}, `Year-on-Year by Product — same period (${prod.currentFY.label} YTD vs ${prod.lastFY.label} ${prod.lastSamePeriodLabel})`),
      table(['Product', 'Brand', `${prod.lastFY.label} Value`, `${prod.currentFY.label} Value`, 'Value YoY', `${prod.lastFY.label} Units`, `${prod.currentFY.label} Units`, 'Units YoY'],
        prod.products.map((p) => [
          h('b', {}, p.productName), p.brandName || '—',
          fmtMoney(p.lastSame.totalValue, cur), fmtMoney(p.current.totalValue, cur), yoyCell(p.valueYoYPct),
          fmtUnits(p.lastSame.totalUnits), fmtUnits(p.current.totalUnits), yoyCell(p.unitsYoYPct)]))));
  }
}

function pctCell(p) {
  const val = p == null ? '—' : `${p.toFixed(0)}%`;
  const color = p == null ? 'var(--muted)' : p >= 100 ? 'var(--accent)' : p >= 90 ? 'var(--warn)' : 'var(--danger)';
  return h('span', { style: `color:${color}; font-weight:600;` }, val);
}
function yoyCell(p) {
  const color = p == null ? 'var(--muted)' : p >= 0 ? 'var(--accent)' : 'var(--danger)';
  return h('b', { style: `color:${color}` }, fmtPct(p));
}
