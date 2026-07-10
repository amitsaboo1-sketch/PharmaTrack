import { api, download } from '../api.js';
import { h, table, fmtMoney, fmtDate, toast } from '../ui.js';

export default async function salesImportPage(root) {
  let csvText = '';
  let filename = '';
  let step = 1;

  const stepsBar = h('div', { class: 'step-tabs' });
  const stage = h('div');
  const historyBox = h('div');
  root.append(stepsBar, stage, h('div', { style: 'margin-top:18px;' }, historyBox));

  function renderSteps() {
    stepsBar.innerHTML = '';
    ['1 · Upload', '2 · Validate', '3 · Preview', '4 · Commit'].forEach((label, i) => {
      stepsBar.append(h('span', { class: `step ${i + 1 === step ? 'active' : i + 1 < step ? 'done' : ''}` }, label));
    });
  }

  function stepUpload() {
    step = 1; renderSteps();
    const fileInput = h('input', { type: 'file', accept: '.csv,text/csv' });
    stage.innerHTML = '';
    stage.append(h('div', { class: 'card' },
      h('h3', {}, 'Upload monthly sales CSV'),
      h('div', { style: 'display:flex; gap:10px; align-items:center; flex-wrap:wrap;' },
        fileInput,
        h('button', { class: 'btn', onclick: () => download('/sales/template', 'sales_template.csv') }, '⬇ Download template'),
        h('button', { class: 'btn primary', onclick: async () => {
          const file = fileInput.files[0];
          if (!file) return toast('Choose a CSV file first', 'error');
          filename = file.name;
          csvText = await file.text();
          stepValidate();
        } }, 'Validate →')),
      h('div', { class: 'hint', style: 'margin-top:10px;' },
        'Required columns: month (YYYY-MM), employee_code, hcp_id or chemist_id, brand, product, sales_value. Duplicate months are flagged; roll back the earlier batch to re-upload.')));
  }

  async function stepValidate() {
    step = 2; renderSteps();
    const v = await api('/sales/validate', { method: 'POST', body: { csvText } });
    stage.innerHTML = '';
    stage.append(h('div', { class: 'card' },
      h('h3', {}, `Validation report — ${filename}`),
      h('div', { class: 'grid cards-4', style: 'margin-bottom:12px;' },
        mini('Rows in file', v.totalRows), mini('Valid', v.validCount, 'var(--accent)'),
        mini('Errors', v.errorCount, v.errorCount ? 'var(--danger)' : undefined),
        mini('Warnings', v.warnings.length, v.warnings.length ? 'var(--warn)' : undefined)),
      v.errorCount ? h('div', {},
        h('h3', {}, 'Errors (fix these in the file and re-upload)'),
        table(['Row', 'Problem'], v.errors.map((e) => [String(e.row), e.reason]))) : null,
      v.warnings.length ? h('div', { style: 'margin-top:10px;' },
        h('h3', {}, 'Warnings'),
        table(['Row', 'Warning'], v.warnings.map((w) => [String(w.row), w.reason]))) : null,
      h('div', { style: 'display:flex; gap:10px; margin-top:14px;' },
        h('button', { class: 'btn', onclick: stepUpload }, '← Back'),
        h('button', { class: 'btn primary', disabled: v.errorCount > 0 || v.validCount === 0 ? true : undefined, onclick: () => stepPreview(v) }, 'Preview →'))));
  }

  function stepPreview(v) {
    step = 3; renderSteps();
    const total = v.preview.reduce((s, r) => s + r.sales_value, 0);
    stage.innerHTML = '';
    stage.append(h('div', { class: 'card' },
      h('h3', {}, `Preview — first ${v.preview.length} of ${v.validCount} valid rows (preview total ${fmtMoney(total)})`),
      table(['Month', 'Employee', 'HCP', 'Chemist', 'Brand', 'Product', 'Qty', 'Value', 'Rx'],
        v.preview.map((r) => [r.month, r.employee_id, r.hcp_id || '—', r.chemist_id || '—', r.brand_id, r.product_id,
          String(r.quantity), fmtMoney(r.sales_value), String(r.prescription_count)])),
      h('div', { style: 'display:flex; gap:10px; margin-top:14px;' },
        h('button', { class: 'btn', onclick: stepValidate }, '← Back'),
        h('button', { class: 'btn success', onclick: commit }, `Commit ${v.validCount} rows`))));
  }

  async function commit() {
    step = 4; renderSteps();
    try {
      const r = await api('/sales/commit', { method: 'POST', body: { csvText, filename } });
      stage.innerHTML = '';
      stage.append(h('div', { class: 'card' },
        h('h3', {}, '✅ Import complete'),
        h('p', {}, `Batch #${r.batchId} committed with ${r.rows} rows. Dashboards and ROI figures now include this data.`),
        h('button', { class: 'btn primary', style: 'margin-top:12px;', onclick: stepUpload }, 'Import another file')));
      loadHistory();
    } catch { stepValidate(); }
  }

  function mini(label, value, color) {
    return h('div', { class: 'card kpi', style: 'padding:12px;' },
      h('div', { class: 'label' }, label),
      h('div', { class: 'value', style: `font-size:20px;${color ? `color:${color};` : ''}` }, String(value)));
  }

  async function loadHistory() {
    const batches = await api('/sales/batches');
    historyBox.innerHTML = '';
    historyBox.append(h('div', { class: 'card' },
      h('h3', {}, 'Upload history'),
      table(['Batch', 'File', 'Months', 'Rows', 'Uploaded by', 'When', 'Status', ''],
        batches.map((b) => [
          `#${b.id}`, b.filename, b.month, String(b.row_count), b.uploader_name || b.uploaded_by, fmtDate(b.uploaded_at),
          b.status === 'committed' ? h('span', { class: 'badge ok' }, 'Committed') : h('span', { class: 'badge rejected' }, 'Rolled back'),
          b.status === 'committed'
            ? h('button', { class: 'btn sm danger', onclick: async () => {
                if (!confirm(`Roll back batch #${b.id}? Its ${b.row_count} sales rows will be removed.`)) return;
                await api(`/sales/batches/${b.id}/rollback`, { method: 'POST', body: {} });
                toast(`Batch #${b.id} rolled back`); loadHistory();
              } }, 'Rollback')
            : '',
        ]))));
  }

  stepUpload();
  await loadHistory();
}
