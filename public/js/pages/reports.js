import { api, session, download } from '../api.js';
import { h, table, badge, kpiCard, fmtMoney, fmtUnits, fmtPct, fmtDate, select, chartCanvas, makeChart, colors } from '../ui.js';

export default async function reportsPage(root) {
  let user = session.user;
  try { user = await api('/auth/me'); session.set(session.token, user); } catch { /* keep cached */ }
  if (user.role === 'sales') return salesReports(root, user);
  return hoReports(root);
}

// ============ Sales: full in-app analytics — filters + graphs, no downloads ============
async function salesReports(root, user) {
  root.append(h('div', { class: 'hint', style: 'margin-bottom:14px;' },
    '📊 All reports are shown here in the app — filter and explore. Data export is disabled for field users.'));

  const [dash, perf, prod, reps, activityTypes, brands, da] = await Promise.all([
    api('/dashboards/sales').catch(() => null),
    user.country ? api(`/performance/country/${user.country}`).catch(() => null) : Promise.resolve(null),
    user.country ? api(`/performance/country/${user.country}/products`).catch(() => null) : Promise.resolve(null),
    api('/performance/reps').catch(() => []),
    api('/activity-types').catch(() => []),
    api('/brands').catch(() => []),
    api('/da').catch(() => []),
  ]);
  const cur = perf ? perf.country.currency : null;

  // ---------- summary ----------
  if (perf) {
    const o = perf.overall;
    root.append(h('div', { class: 'grid cards-4' },
      kpiCard('Value Achievement (YTD)', o.valuePct == null ? '—' : `${o.valuePct.toFixed(0)}%`, `${fmtMoney(o.achievedValue, cur)} / ${fmtMoney(o.targetValue, cur)}`, (o.valuePct ?? 0) >= 100 ? 'up' : 'down'),
      kpiCard('YoY Growth (value)', fmtPct(perf.yoy.valueYoYPct), `vs ${perf.yoy.lastFyLabel}`, (perf.yoy.valueYoYPct ?? 0) >= 0 ? 'up' : 'down'),
      kpiCard('My Activity ROI', fmtPct(dash?.myRoiPct), `account-wise`, (dash?.myRoiPct ?? 0) >= 0 ? 'up' : 'down'),
      kpiCard('Reporting period', perf.fyLabel, perf.ytdLabel)));
  }

  // ---------- 1) Brand-wise YTD (units per brand, value overall) ----------
  if (perf) {
    const bar = chartCanvas();
    root.append(sectionCard(`Brand-wise Target vs Achievement — YTD ${perf.ytdLabel} (${cur})`,
      h('div', { class: 'hint', style: 'margin-bottom:8px;' }, 'Units are per brand/product only (never clubbed across products); overall is by value.'),
      h('div', { class: 'chart-box sm' }, bar),
      table(['Brand', 'Target Units', 'Achieved Units', 'Units %', 'Target Value', 'Achieved Value', 'Value %'],
        [...perf.brands.map((b) => [h('b', {}, b.brandName), fmtUnits(b.targetUnits), fmtUnits(b.achievedUnits), pctText(b.unitsPct),
          fmtMoney(b.targetValue, cur), fmtMoney(b.achievedValue, cur), pctText(b.valuePct)]),
         [h('b', {}, 'Overall (value)'), h('span', { class: 'hint' }, '—'), h('span', { class: 'hint' }, '—'), h('span', { class: 'hint' }, '—'),
          h('b', {}, fmtMoney(perf.overall.targetValue, cur)), h('b', {}, fmtMoney(perf.overall.achievedValue, cur)), pctText(perf.overall.valuePct)]])));
    makeChart(bar, { type: 'bar', data: { labels: perf.brands.map((b) => b.brandName), datasets: [
      { label: 'Target value', data: perf.brands.map((b) => b.targetValue), backgroundColor: '#c7d2fe', borderRadius: 4 },
      { label: 'Achieved value', data: perf.brands.map((b) => b.achievedValue), backgroundColor: '#059669', borderRadius: 4 }] } });
  }

  // ---------- 2) Month-on-month by product ----------
  if (prod && prod.products.length) {
    const prodSel = select(prod.products.map((p) => [p.productId, `${p.productName} (${p.brandName})`]));
    const momCanvas = chartCanvas();
    const momTableBox = h('div');
    let momChart;
    const drawMoM = () => {
      const p = prod.products.find((x) => x.productId === prodSel.value) || prod.products[0];
      const labels = prod.currentFY.months.map((m) => m.label);
      const units = prod.currentFY.months.map((m) => (p.current.months[m.key]?.units) || 0);
      const value = prod.currentFY.months.map((m) => (p.current.months[m.key]?.value) || 0);
      if (momChart) momChart.destroy();
      momChart = makeChart(momCanvas, { data: { labels, datasets: [
        { type: 'bar', label: `Value (${cur})`, data: value, backgroundColor: '#4f46e5', borderRadius: 4, yAxisID: 'y' },
        { type: 'line', label: 'Units', data: units, borderColor: '#d97706', tension: .3, yAxisID: 'y1' }] },
        options: { scales: { y: { position: 'left' }, y1: { position: 'right', grid: { drawOnChartArea: false } } } } });
      momTableBox.innerHTML = '';
      momTableBox.append(table(['Month', 'Units', `Value (${cur})`],
        prod.currentFY.months.map((m) => [m.label, fmtUnits(p.current.months[m.key]?.units || 0), fmtMoney(p.current.months[m.key]?.value || 0, cur)])));
    };
    prodSel.addEventListener('change', drawMoM);
    root.append(sectionCard(`Month-on-Month by Product — ${prod.currentFY.label}`,
      h('div', { class: 'filters', style: 'margin-bottom:10px;' }, h('span', { class: 'hint' }, 'Product:'), prodSel),
      h('div', { class: 'chart-box' }, momCanvas), momTableBox));
    drawMoM();
  }

  // ---------- 3) Year-on-Year comparison (same period: this FY YTD vs last FY same months) ----------
  if (prod && prod.products.length) {
    const yoyCanvas = chartCanvas();
    root.append(sectionCard(`Year-on-Year by Product — same period (${prod.currentFY.label} YTD vs ${prod.lastFY.label} ${prod.lastSamePeriodLabel})`,
      h('div', { class: 'hint', style: 'margin-bottom:8px;' }, 'Like-for-like: this year to date compared against the same months last year.'),
      h('div', { class: 'chart-box sm' }, yoyCanvas),
      table(['Product', 'Brand', `${prod.lastFY.label} Value`, `${prod.currentFY.label} Value`, 'Value YoY', `${prod.lastFY.label} Units`, `${prod.currentFY.label} Units`, 'Units YoY'],
        prod.products.map((p) => [h('b', {}, p.productName), p.brandName || '—',
          fmtMoney(p.lastSame.totalValue, cur), fmtMoney(p.current.totalValue, cur), yoyText(p.valueYoYPct),
          fmtUnits(p.lastSame.totalUnits), fmtUnits(p.current.totalUnits), yoyText(p.unitsYoYPct)]))));
    makeChart(yoyCanvas, { type: 'bar', data: { labels: prod.products.map((p) => p.productName), datasets: [
      { label: `${prod.lastFY.label} (same period)`, data: prod.products.map((p) => p.lastSame.totalValue), backgroundColor: '#94a3b8', borderRadius: 4 },
      { label: `${prod.currentFY.label} (YTD)`, data: prod.products.map((p) => p.current.totalValue), backgroundColor: '#4f46e5', borderRadius: 4 }] } });
  }

  // ---------- 4) Last-year sales (full prior fiscal year) ----------
  if (prod && prod.products.length) {
    const lastCanvas = chartCanvas();
    const byMonth = {};
    prod.products.forEach((p) => Object.entries(p.last.months).forEach(([m, v]) => { byMonth[m] = (byMonth[m] || 0) + v.value; }));
    root.append(sectionCard(`Last Year Sales — ${prod.lastFY.label} (monthly value, ${cur})`,
      h('div', { class: 'chart-box sm' }, lastCanvas),
      table(['Product', `Total Value (${prod.lastFY.label})`, 'Total Units'],
        prod.products.map((p) => [p.productName, fmtMoney(p.last.totalValue, cur), fmtUnits(p.last.totalUnits)]))));
    makeChart(lastCanvas, { data: { labels: prod.lastFY.months.map((m) => m.label),
      datasets: [{ type: 'bar', label: `Value (${cur})`, data: prod.lastFY.months.map((m) => byMonth[m.key] || 0), backgroundColor: '#0891b2', borderRadius: 4 }] } });
  }

  // ---------- 5) Account-wise Rep ROI ----------
  if (reps.length) {
    root.append(sectionCard('Rep ROI — account-wise attribution',
      h('div', { class: 'hint', style: 'margin-bottom:8px;' },
        'Sales are country-wide, but every doctor/chemist is owned by one rep. Each rep\'s sales = sales through their accounts; ROI = incremental on those accounts ÷ their activity spend.'),
      table(['Rep', 'Country', 'Owned Doctors', 'Owned Chemists', 'Account Sales (YTD)', 'Activities', 'Spend', 'Incremental', 'ROI'],
        reps.map((r) => [h('b', {}, r.name), r.country, String(r.ownedDoctors), String(r.ownedChemists),
          fmtMoney(r.accountSalesYTD, cur), String(r.activities), fmtMoney(r.spend, cur), fmtMoney(r.incremental, cur),
          r.roiPct == null ? h('span', { class: 'hint' }, 'n/a') : h('b', { style: `color:${r.roiPct >= 0 ? 'var(--accent)' : 'var(--danger)'}` }, fmtPct(r.roiPct))]))));
  }

  // ---------- 6) Activity report with live filters ----------
  const statusSel = select([['', 'All statuses'], ...['draft', 'submitted', 'approved', 'returned', 'rejected', 'executed'].map((s) => [s, s])]);
  const typeSel = select([['', 'All types'], ...activityTypes.map((t) => [t.id, t.name])]);
  const abrandSel = select([['', 'All brands'], ...brands.map((b) => [b.id, b.name])]);
  const fromInp = h('input', { type: 'date' });
  const toInp = h('input', { type: 'date' });
  const actTableBox = h('div');
  const actChartBox = h('div', { class: 'chart-box sm' });
  let actChart;
  async function loadActivities() {
    const qs = new URLSearchParams();
    if (statusSel.value) qs.set('status', statusSel.value);
    if (typeSel.value) qs.set('type', typeSel.value);
    if (abrandSel.value) qs.set('brand', abrandSel.value);
    if (fromInp.value) qs.set('from', fromInp.value);
    if (toInp.value) qs.set('to', toInp.value);
    const acts = await api(`/activities${qs.toString() ? '?' + qs : ''}`);
    actTableBox.innerHTML = '';
    actTableBox.append(table(['Activity', 'Type', 'Brand', 'Date', 'Est. Cost', 'Actual', 'Status'],
      acts.map((a) => [a.title, a.type_name || a.type_id, a.brand_name || '—', fmtDate(a.actual_date || a.planned_date),
        fmtMoney(a.estimated_cost), a.actual_cost != null ? fmtMoney(a.actual_cost) : '—', badge(a.status)]),
      (i) => (location.hash = `#/activity/${acts[i].id}`)));
    const byStatus = {}; acts.forEach((a) => { byStatus[a.status] = (byStatus[a.status] || 0) + 1; });
    actChartBox.innerHTML = ''; const cv = chartCanvas(); actChartBox.append(cv);
    if (actChart) actChart.destroy();
    actChart = makeChart(cv, { type: 'doughnut', data: { labels: Object.keys(byStatus), datasets: [{ data: Object.values(byStatus), backgroundColor: colors(Object.keys(byStatus).length) }] } });
  }
  [statusSel, typeSel, abrandSel, fromInp, toInp].forEach((el) => el.addEventListener('change', loadActivities));
  root.append(sectionCard('Activity Report',
    h('div', { class: 'filters', style: 'margin-bottom:12px;' }, statusSel, typeSel, abrandSel, h('span', { class: 'hint' }, 'From'), fromInp, h('span', { class: 'hint' }, 'To'), toInp),
    h('div', { class: 'grid cols-3-1' }, actTableBox, actChartBox)));
  await loadActivities();

  // ---------- 7) Expense by category ----------
  if (dash?.expenseByCategory?.length) {
    const expCanvas = chartCanvas();
    root.append(sectionCard('Expense Report — by category',
      h('div', { class: 'grid cols-3-1' },
        table(['Category', 'Amount'], dash.expenseByCategory.map((e) => [e.category, fmtMoney(e.amount, cur)])),
        h('div', { class: 'chart-box sm' }, expCanvas))));
    makeChart(expCanvas, { type: 'doughnut', data: { labels: dash.expenseByCategory.map((e) => e.category), datasets: [{ data: dash.expenseByCategory.map((e) => e.amount), backgroundColor: colors(dash.expenseByCategory.length) }] } });
  }

  // ---------- 8) Doctor ROI ----------
  if (dash?.topDoctors?.length) {
    const roiCanvas = chartCanvas();
    root.append(sectionCard('Doctor ROI',
      h('div', { class: 'grid cols-3-1' },
        table(['Doctor', 'Speciality', 'Allocated Spend', 'Incremental Sales', 'ROI'],
          dash.topDoctors.map((dd) => [h('a', { href: `#/doctor/${dd.key}` }, dd.label), dd.sublabel || '—',
            fmtMoney(dd.cost, cur), fmtMoney(dd.incremental, cur),
            dd.roiPct == null ? h('span', { class: 'hint' }, 'n/a') : h('b', { style: `color:${dd.roiPct >= 0 ? 'var(--accent)' : 'var(--danger)'}` }, fmtPct(dd.roiPct))]),
          (i) => (location.hash = `#/doctor/${dash.topDoctors[i].key}`)),
        h('div', { class: 'chart-box sm' }, roiCanvas))));
    makeChart(roiCanvas, { type: 'bar', data: { labels: dash.topDoctors.map((dd) => dd.label), datasets: [{ label: 'ROI %', data: dash.topDoctors.map((dd) => dd.roiPct), backgroundColor: dash.topDoctors.map((dd) => (dd.roiPct ?? 0) >= 0 ? '#059669' : '#dc2626'), borderRadius: 4 }] }, options: { plugins: { legend: { display: false } } } });
  }

  // ---------- 9) Daily Allowance ----------
  const daStatusSel = select([['', 'All statuses'], ['submitted', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']]);
  const daBox = h('div');
  const daChart = h('div', { class: 'chart-box sm' });
  let daChartObj;
  function renderDA() {
    const rows = da.filter((c) => !daStatusSel.value || c.status === daStatusSel.value);
    daBox.innerHTML = '';
    daBox.append(table(['Date', 'Location', 'Purpose', 'DA Amount', 'Proofs', 'Status'],
      rows.map((c) => [fmtDate(c.da_date), c.location || '—', c.purpose || '—', fmtMoney(c.da_amount, c.currency_code),
        `${c.attachment_count} · ${fmtMoney(c.expense_total, c.currency_code)}`, badge(c.status === 'submitted' ? 'submitted' : c.status)])));
    const byStatus = {}; da.forEach((c) => { byStatus[c.status] = (byStatus[c.status] || 0) + c.da_amount; });
    daChart.innerHTML = ''; const cv = chartCanvas(); daChart.append(cv);
    if (daChartObj) daChartObj.destroy();
    daChartObj = makeChart(cv, { type: 'doughnut', data: { labels: Object.keys(byStatus), datasets: [{ data: Object.values(byStatus), backgroundColor: colors(Object.keys(byStatus).length) }] } });
  }
  daStatusSel.addEventListener('change', renderDA);
  root.append(sectionCard('Daily Allowance Report',
    h('div', { class: 'filters', style: 'margin-bottom:10px;' }, h('span', { class: 'hint' }, 'Status:'), daStatusSel),
    h('div', { class: 'grid cols-3-1' }, daBox, daChart)));
  renderDA();
}

// ============ HO reports ============
async function hoReports(root) {
  const pool = await api('/performance/pool');
  root.append(h('div', { class: 'card' },
    h('h3', {}, `East Africa Pool — Country Performance (value, ${pool[0]?.ytdLabel || 'YTD'})`),
    table(['Country', 'Currency', 'Target Value', 'Achieved Value', 'Value %', 'YoY'],
      pool.map((p) => [h('a', { href: `#/country/${p.code}` }, p.name), p.currency,
        fmtMoney(p.overall.targetValue, p.currency), fmtMoney(p.overall.achievedValue, p.currency),
        pctText(p.overall.valuePct), yoyText(p.yoy?.valueYoYPct)]))));

  const reps = await api('/performance/reps').catch(() => []);
  if (reps.length) root.append(h('div', { class: 'card', style: 'margin-top:14px;' },
    h('h3', {}, 'Rep ROI — account-wise attribution'),
    table(['Rep', 'Country', 'Doctors', 'Chemists', 'Account Sales (YTD)', 'Activities', 'Spend', 'Incremental', 'ROI'],
      reps.map((r) => [h('b', {}, r.name), r.country, String(r.ownedDoctors), String(r.ownedChemists),
        fmtMoney(r.accountSalesYTD), String(r.activities), fmtMoney(r.spend), fmtMoney(r.incremental),
        r.roiPct == null ? h('span', { class: 'hint' }, 'n/a') : h('b', { style: `color:${r.roiPct >= 0 ? 'var(--accent)' : 'var(--danger)'}` }, fmtPct(r.roiPct))]))));

  const catalog = [
    ['activities', 'Activity Report'], ['expenses', 'Expense Report'], ['attendance', 'Attendance Report'],
    ['doctor-roi', 'Doctor ROI'], ['employee-roi', 'Employee ROI'], ['brand-roi', 'Brand ROI'],
    ['sales', 'Sales Data'], ['audit', 'Audit Report'],
  ];
  root.append(h('h3', { style: 'margin:20px 0 10px;' }, 'Finance & Audit exports (Head Office only)'));
  root.append(h('div', { class: 'grid cards-4' },
    catalog.map(([key, title]) => h('div', { class: 'card' },
      h('h3', {}, title),
      h('button', { class: 'btn primary sm', style: 'margin-top:8px;', onclick: () => download(`/reports/${key}.csv`, `${key}.csv`) }, '⬇ Download CSV')))));
}

// ---- helpers ----
function sectionCard(title, ...children) {
  return h('div', { class: 'card', style: 'margin-top:14px;' }, h('h3', {}, title), ...children);
}
function pctText(p) {
  const val = p == null ? '—' : `${p.toFixed(0)}%`;
  const color = p == null ? 'var(--muted)' : p >= 100 ? 'var(--accent)' : p >= 90 ? 'var(--warn)' : 'var(--danger)';
  return h('span', { style: `color:${color}; font-weight:600;` }, val);
}
function yoyText(p) {
  const color = p == null ? 'var(--muted)' : p >= 0 ? 'var(--accent)' : 'var(--danger)';
  return h('b', { style: `color:${color}` }, fmtPct(p));
}
