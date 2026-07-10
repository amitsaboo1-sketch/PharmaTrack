const { q } = require('../db/connection');

const HEADERS = [
  'month', 'employee_code', 'hcp_id', 'chemist_id', 'brand', 'product',
  'quantity', 'sales_value', 'prescription_count', 'source', 'remarks',
];

function templateCSV() {
  return [
    HEADERS.join(','),
    '2026-06,EMP001,,CHEM001,BR01,PR01,290,58000,72,distributor,June secondary sales',
    '2026-06,EMP002,HCP005,,BR03,PR04,16,67200,18,rx-audit,Direct doctor attribution',
  ].join('\r\n');
}

// Minimal RFC-4180-ish parser (quoted fields, embedded commas).
function parseCSV(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { if (row.length > 1 || row[0] !== '') rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') { pushField(); pushRow(); }
    else if (c !== '\r') field += c;
  }
  pushField();
  pushRow();
  return rows;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

// Validates CSV text against masters. Returns { header, validRows, errors, warnings }.
async function validateSalesCSV(text) {
  const raw = parseCSV(text);
  if (raw.length === 0) return { errors: [{ row: 0, reason: 'Empty file' }], validRows: [], warnings: [] };

  const header = raw[0].map((h) => h.trim().toLowerCase());
  const missing = HEADERS.filter((h) => !header.includes(h) && !['source', 'remarks', 'prescription_count', 'quantity'].includes(h));
  if (missing.length) {
    return { errors: [{ row: 1, reason: `Missing required columns: ${missing.join(', ')}` }], validRows: [], warnings: [] };
  }
  const col = (r, name) => {
    const i = header.indexOf(name);
    return i >= 0 ? (r[i] || '').trim() : '';
  };

  const exists = {
    emp: new Set((await q.all('SELECT id FROM users')).map((r) => r.id)),
    hcp: new Set((await q.all('SELECT id FROM hcps')).map((r) => r.id)),
    chem: new Set((await q.all('SELECT id FROM chemists')).map((r) => r.id)),
    brand: new Set((await q.all('SELECT id FROM brands')).map((r) => r.id)),
    product: new Map((await q.all('SELECT id, brand_id FROM products')).map((r) => [r.id, r.brand_id])),
  };
  const committedMonths = new Set(
    (await q.all(`SELECT DISTINCT s.month FROM sales_data s JOIN sales_batches b ON b.id=s.batch_id WHERE b.status='committed'`))
      .map((r) => r.month)
  );

  const errors = [];
  const warnings = [];
  const validRows = [];
  const seen = new Set();
  const nowM = currentMonth();

  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const rowNo = i + 1;
    const month = col(r, 'month');
    const emp = col(r, 'employee_code');
    const hcp = col(r, 'hcp_id');
    const chem = col(r, 'chemist_id');
    const brand = col(r, 'brand');
    const product = col(r, 'product');
    const qty = col(r, 'quantity');
    const value = col(r, 'sales_value');
    const rx = col(r, 'prescription_count');

    const fail = (reason) => errors.push({ row: rowNo, reason });

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { fail(`Invalid month "${month}" (expected YYYY-MM)`); continue; }
    if (month > nowM) { fail(`Future month ${month} not allowed`); continue; }
    if (!emp || !exists.emp.has(emp)) { fail(`Unknown employee_code "${emp}"`); continue; }
    if (!hcp && !chem) { fail('Either hcp_id or chemist_id is required'); continue; }
    if (hcp && !exists.hcp.has(hcp)) { fail(`Unknown hcp_id "${hcp}"`); continue; }
    if (chem && !exists.chem.has(chem)) { fail(`Unknown chemist_id "${chem}"`); continue; }
    if (!brand || !exists.brand.has(brand)) { fail(`Unknown brand "${brand}"`); continue; }
    if (!product || !exists.product.has(product)) { fail(`Unknown product "${product}"`); continue; }
    if (exists.product.get(product) !== brand) warnings.push({ row: rowNo, reason: `Product ${product} does not belong to brand ${brand}` });

    const nVal = Number(value);
    if (!Number.isFinite(nVal)) { fail(`sales_value "${value}" is not a number`); continue; }
    if (nVal < 0) { fail(`Negative sales_value ${nVal}`); continue; }
    const nQty = qty === '' ? 0 : Number(qty);
    if (!Number.isFinite(nQty) || nQty < 0) { fail(`Invalid quantity "${qty}"`); continue; }
    const nRx = rx === '' ? 0 : Number(rx);
    if (!Number.isFinite(nRx) || nRx < 0) { fail(`Invalid prescription_count "${rx}"`); continue; }

    const key = [month, emp, hcp, chem, brand, product].join('|');
    if (seen.has(key)) { fail('Duplicate row within file (same month/employee/account/product)'); continue; }
    seen.add(key);

    if (committedMonths.has(month)) {
      warnings.push({ row: rowNo, reason: `Month ${month} already has committed data (batch overlap) — roll back the earlier batch if this is a re-upload` });
    }

    validRows.push({
      month, employee_id: emp, hcp_id: hcp || null, chemist_id: chem || null,
      brand_id: brand, product_id: product, quantity: nQty, sales_value: nVal,
      prescription_count: nRx, source: col(r, 'source') || 'csv', remarks: col(r, 'remarks') || null,
    });
  }

  return { validRows, errors, warnings, totalRows: raw.length - 1 };
}

module.exports = { templateCSV, validateSalesCSV, HEADERS };
