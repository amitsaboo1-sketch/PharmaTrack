const { q } = require('../db/connection');

const CLASSES = ['Diamond', 'Ruby', 'Pearl', 'Opal'];
const CATEGORIES = ['A', 'B', 'C'];
const CHEMIST_TYPES = ['Retail', 'Wholesaler', 'Stockist'];

const DOCTOR_HEADERS = ['hcp_id', 'name', 'speciality', 'qualification', 'hospital_clinic', 'location', 'class', 'category', 'rep_code', 'country', 'registration_no', 'contact', 'chemist_ids'];
const CHEMIST_HEADERS = ['chemist_id', 'name', 'type', 'address', 'city', 'rep_code', 'country', 'is_hospital_in_house'];

// Minimal RFC-4180-ish parser (quoted fields, embedded commas/newlines).
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
  pushField(); pushRow();
  return rows;
}

function toCSV(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map((r) => headers.map((hh) => esc(r[hh])).join(','))].join('\r\n');
}

function doctorTemplate() {
  return [
    DOCTOR_HEADERS.join(','),
    ',Dr. Jane Kamau,Cardiology,MD,Aga Khan Hospital,Nairobi,Diamond,A,EMP001,KE,KMPDU-12345,+254700000000,CHEM001;CHEM002',
    ',Dr. Paul Otim,Diabetology,MBChB,Case Clinic,Kampala,Ruby,B,EMP002,UG,,,CHEM004',
  ].join('\r\n');
}
function chemistTemplate() {
  return [
    CHEMIST_HEADERS.join(','),
    ',Nairobi Uptown Pharmacy,Retail,Ngong Road,Nairobi,EMP001,KE,0',
    ',Kampala Mega Distributors,Wholesaler,Industrial Area,Kampala,EMP002,UG,0',
  ].join('\r\n');
}

async function refs() {
  return {
    reps: new Map((await q.all(`SELECT id, country FROM users WHERE role='sales'`)).map((u) => [u.id, u.country])),
    countries: new Set((await q.all('SELECT code FROM countries')).map((c) => c.code)),
    hcpIds: new Set((await q.all('SELECT id FROM hcps')).map((r) => r.id)),
    chemIds: new Set((await q.all('SELECT id FROM chemists')).map((r) => r.id)),
  };
}

function makeColReader(header, wanted) {
  const idx = {};
  header.forEach((h2, i) => { idx[h2.trim().toLowerCase()] = i; });
  return (row, name) => {
    const i = idx[name];
    return i == null ? '' : (row[i] || '').trim();
  };
}

async function validateDoctors(text) {
  const raw = parseCSV(text);
  if (!raw.length) return { validRows: [], errors: [{ row: 0, reason: 'Empty file' }], warnings: [], totalRows: 0 };
  const header = raw[0].map((h2) => h2.trim().toLowerCase());
  if (!header.includes('name') || !header.includes('rep_code')) {
    return { validRows: [], errors: [{ row: 1, reason: 'Missing required columns: name and rep_code' }], warnings: [], totalRows: 0 };
  }
  const col = makeColReader(header);
  const r = await refs();
  const errors = [], warnings = [], validRows = [];

  for (let i = 1; i < raw.length; i++) {
    const rowNo = i + 1;
    const name = col(raw[i], 'name');
    const repCode = col(raw[i], 'rep_code');
    const fail = (reason) => errors.push({ row: rowNo, reason });
    if (!name) { fail('Name is required'); continue; }
    if (!repCode || !r.reps.has(repCode)) { fail(`Unknown rep_code "${repCode}"`); continue; }

    let cls = col(raw[i], 'class') || 'Ruby';
    if (!CLASSES.includes(cls)) { warnings.push({ row: rowNo, reason: `Class "${cls}" not recognised — defaulted to Ruby` }); cls = 'Ruby'; }
    let cat = (col(raw[i], 'category') || 'B').toUpperCase();
    if (!CATEGORIES.includes(cat)) { warnings.push({ row: rowNo, reason: `Category "${cat}" not recognised — defaulted to B` }); cat = 'B'; }

    let country = col(raw[i], 'country') || r.reps.get(repCode) || '';
    if (country && !r.countries.has(country)) { warnings.push({ row: rowNo, reason: `Unknown country "${country}" — using rep's country` }); country = r.reps.get(repCode) || ''; }

    const id = col(raw[i], 'hcp_id');
    const chemistIds = col(raw[i], 'chemist_ids').split(';').map((s) => s.trim()).filter(Boolean);
    const unknownChems = chemistIds.filter((c) => !r.chemIds.has(c));
    if (unknownChems.length) warnings.push({ row: rowNo, reason: `Unknown chemist id(s) skipped: ${unknownChems.join(', ')}` });

    validRows.push({
      id: id || null, isUpdate: !!(id && r.hcpIds.has(id)),
      name, speciality: col(raw[i], 'speciality'), qualification: col(raw[i], 'qualification'),
      clinic: col(raw[i], 'hospital_clinic'), city: col(raw[i], 'location'),
      class: cls, category: cat, repId: repCode, country,
      registrationNo: col(raw[i], 'registration_no'), contact: col(raw[i], 'contact'),
      chemistIds: chemistIds.filter((c) => r.chemIds.has(c)),
    });
  }
  return { validRows, errors, warnings, totalRows: raw.length - 1 };
}

async function validateChemists(text) {
  const raw = parseCSV(text);
  if (!raw.length) return { validRows: [], errors: [{ row: 0, reason: 'Empty file' }], warnings: [], totalRows: 0 };
  const header = raw[0].map((h2) => h2.trim().toLowerCase());
  if (!header.includes('name') || !header.includes('rep_code')) {
    return { validRows: [], errors: [{ row: 1, reason: 'Missing required columns: name and rep_code' }], warnings: [], totalRows: 0 };
  }
  const col = makeColReader(header);
  const r = await refs();
  const errors = [], warnings = [], validRows = [];

  for (let i = 1; i < raw.length; i++) {
    const rowNo = i + 1;
    const name = col(raw[i], 'name');
    const repCode = col(raw[i], 'rep_code');
    const fail = (reason) => errors.push({ row: rowNo, reason });
    if (!name) { fail('Name is required'); continue; }
    if (!repCode || !r.reps.has(repCode)) { fail(`Unknown rep_code "${repCode}"`); continue; }

    let type = col(raw[i], 'type') || 'Retail';
    if (!CHEMIST_TYPES.includes(type)) { warnings.push({ row: rowNo, reason: `Type "${type}" not recognised — defaulted to Retail` }); type = 'Retail'; }
    let country = col(raw[i], 'country') || r.reps.get(repCode) || '';
    if (country && !r.countries.has(country)) { warnings.push({ row: rowNo, reason: `Unknown country "${country}" — using rep's country` }); country = r.reps.get(repCode) || ''; }
    const id = col(raw[i], 'chemist_id');
    const hosp = col(raw[i], 'is_hospital_in_house');

    validRows.push({
      id: id || null, isUpdate: !!(id && r.chemIds.has(id)),
      name, type, address: col(raw[i], 'address'), city: col(raw[i], 'city'),
      repId: repCode, country, isHospitalInHouse: hosp === '1' || hosp.toLowerCase() === 'yes' ? 1 : 0,
    });
  }
  return { validRows, errors, warnings, totalRows: raw.length - 1 };
}

// Export current masters as CSV (round-trips with the import templates).
async function exportDoctors() {
  const rows = await q.all(`SELECT * FROM hcps WHERE active=1 ORDER BY id`);
  const out = [];
  for (const d of rows) {
    const maps = (await q.all('SELECT chemist_id FROM hcp_chemist_map WHERE hcp_id=?', [d.id])).map((m) => m.chemist_id).join(';');
    out.push({
      hcp_id: d.id, name: d.name, speciality: d.speciality || '', qualification: d.qualification || '',
      hospital_clinic: d.clinic || '', location: d.city || '', class: d.class || '', category: d.category || '',
      rep_code: d.rep_id || '', country: d.country || '', registration_no: d.registration_no || '', contact: d.contact || '',
      chemist_ids: maps,
    });
  }
  return toCSV(out);
}
async function exportChemists() {
  const rows = await q.all(`SELECT * FROM chemists WHERE active=1 ORDER BY id`);
  return toCSV(rows.map((c) => ({
    chemist_id: c.id, name: c.name, type: c.type || 'Retail', address: c.address || '', city: c.city || '',
    rep_code: c.rep_id || '', country: c.country || '', is_hospital_in_house: c.is_hospital_in_house ? 1 : 0,
  })));
}

module.exports = { doctorTemplate, chemistTemplate, validateDoctors, validateChemists, exportDoctors, exportChemists };
