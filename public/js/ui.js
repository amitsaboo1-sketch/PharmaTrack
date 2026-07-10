// Small DOM + component helpers shared by all pages.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

const CURRENCY_SYMBOLS = { KES: 'KSh', UGX: 'USh', TZS: 'TSh', RWF: 'FRw', MUR: 'Rs', ZMW: 'ZK', USD: '$', INR: '₹' };
// fmtMoney(amount) -> plain number; fmtMoney(amount, 'KES') -> "KSh 12,340"
export const fmtMoney = (n, currency) => {
  if (n == null || !isFinite(n)) return '—';
  const sym = currency ? (CURRENCY_SYMBOLS[currency] || currency) : '';
  return (sym ? sym + ' ' : '') + Math.round(n).toLocaleString('en');
};
export const fmtUnits = (n) => (n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('en') + ' u');
export const fmtPct = (n, digits = 1) =>
  n == null || !isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export function toast(msg, kind = 'info') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}` }, msg);
  box.append(t);
  setTimeout(() => t.remove(), 4200);
}

export function badge(status) {
  const labels = {
    draft: 'Draft', submitted: 'Pending approval', approved: 'Approved', returned: 'Returned',
    rejected: 'Rejected', executed: 'Executed', closed: 'Closed',
    high: 'High', medium: 'Medium', ok: 'OK', unverified: 'Unverified',
  };
  return h('span', { class: `badge ${status}` }, labels[status] || status);
}

export function kpiCard(label, value, sub, subClass = '') {
  return h('div', { class: 'card kpi' },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value),
    sub ? h('div', { class: `sub ${subClass}` }, sub) : null);
}

// rows: array of arrays or nodes; onRow optional click handler receiving index
export function table(headers, rows, onRow) {
  const thead = h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x))));
  const tbody = h('tbody', {},
    rows.length
      ? rows.map((cells, i) =>
          h('tr', { class: onRow ? 'clickable' : '', onclick: onRow ? () => onRow(i) : undefined },
            cells.map((c) => h('td', {}, c == null ? '' : c))))
      : [h('tr', {}, h('td', { colspan: headers.length }, h('div', { class: 'empty' }, 'No records')))]);
  return h('div', { class: 'table-wrap' }, h('table', {}, thead, tbody));
}

export function modal(title, bodyNodes, actions) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const close = () => (root.innerHTML = '');
  const box = h('div', { class: 'modal' },
    h('h2', {}, title),
    ...bodyNodes,
    h('div', { class: 'actions' }, actions(close)));
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, box);
  root.append(backdrop);
  return close;
}

export function field(labelText, inputEl) {
  return h('div', { class: 'field' }, h('label', {}, labelText), inputEl);
}

export function select(options, attrs = {}) {
  return h('select', attrs, options.map(([v, label, selected]) =>
    h('option', { value: v, selected: selected || undefined }, label)));
}

// ---- charts (Chart.js is global) ----
const palette = ['#4f46e5', '#059669', '#d97706', '#dc2626', '#0891b2', '#7c3aed', '#db2777', '#65a30d', '#475569'];

export function chartCanvas() {
  return h('canvas');
}
export function makeChart(canvas, cfg) {
  // eslint-disable-next-line no-undef
  return new Chart(canvas, {
    ...cfg,
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
      ...cfg.options,
    },
  });
}
export function colors(n) {
  return Array.from({ length: n }, (_, i) => palette[i % palette.length]);
}
