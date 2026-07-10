// Small DOM + component helpers shared by all pages.

// Pharos lighthouse brand mark (self-contained indigo badge, scales to any size).
export const BRAND_SVG = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Pharos">
  <rect width="64" height="64" rx="15" fill="#4f46e5"/>
  <polygon points="32,18 13,11 15,20" fill="#fbbf24" opacity="0.9"/>
  <polygon points="32,18 51,11 49,20" fill="#fbbf24" opacity="0.9"/>
  <polygon points="24,13 40,13 32,6" fill="#ffffff"/>
  <rect x="26" y="13" width="12" height="7" fill="#ffffff"/>
  <rect x="28" y="15" width="8" height="5" rx="1" fill="#fbbf24"/>
  <polygon points="26,20 38,20 42,50 22,50" fill="#ffffff"/>
  <rect x="23.5" y="29" width="17" height="4" fill="#4f46e5"/>
  <rect x="22" y="40" width="20" height="4" fill="#4f46e5"/>
  <rect x="19" y="50" width="26" height="5" rx="1.5" fill="#ffffff"/>
</svg>`;

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
