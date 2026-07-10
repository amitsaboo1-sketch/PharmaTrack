const { q } = require('../db/connection');

// Consolidated country performance with a FISCAL year starting in April.
//  - VALUE is summable across brands/products -> overall value roll-up is valid.
//  - UNITS are NOT summable across products -> reported per brand/product only.
//  - YTD = fiscal-year-to-date (April 1 of the current FY .. latest data month).

const FY_START_MONTH = 4;

function addMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthRange(start, end) {
  const out = [];
  let m = start;
  while (m <= end) { out.push(m); m = addMonth(m, 1); }
  return out;
}
function fyStartOf(month) {
  const [y, mo] = month.split('-').map(Number);
  const startYear = mo >= FY_START_MONTH ? y : y - 1;
  return `${startYear}-${String(FY_START_MONTH).padStart(2, '0')}`;
}
function fyLabelOf(startMonth) {
  const y = Number(startMonth.slice(0, 4));
  return `FY${String(y).slice(2)}-${String((y + 1)).slice(2)}`;
}
function prettyMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

async function referenceMonth() {
  const r = await q.get(`SELECT MAX(s.month) AS m FROM sales_data s JOIN sales_batches b ON b.id=s.batch_id AND b.status='committed'`);
  return (r && r.m) || new Date().toISOString().slice(0, 7);
}

async function fiscalWindows() {
  const ref = await referenceMonth();
  const fyStart = fyStartOf(ref);
  const ytdMonths = monthRange(fyStart, ref);
  const lastFyStart = addMonth(fyStart, -12);
  const lastFyEnd = addMonth(fyStart, -1);
  const lastFyMonths = monthRange(lastFyStart, lastFyEnd);
  const lastYtdMonths = monthRange(addMonth(fyStart, -12), addMonth(ref, -12));
  return { ref, fyStart, fyLabel: fyLabelOf(fyStart), ytdMonths, lastFyStart, lastFyMonths, lastFyLabel: fyLabelOf(lastFyStart), lastYtdMonths };
}

function listCountries() {
  return q.all('SELECT * FROM countries WHERE active = 1 ORDER BY name');
}
function pct(a, t) { return t > 0 ? (a / t) * 100 : null; }

async function sumCountrySales(code, months, groupCol) {
  if (!months.length) return [];
  const ph = months.map(() => '?').join(',');
  const rows = await q.all(
    `SELECT ${groupCol} AS g, COALESCE(SUM(s.quantity),0) AS units, COALESCE(SUM(s.sales_value),0) AS value
     FROM sales_data s
     JOIN sales_batches b ON b.id = s.batch_id AND b.status='committed'
     JOIN users u ON u.id = s.employee_id
     WHERE u.country = ? AND s.month IN (${ph}) GROUP BY ${groupCol}`, [code, ...months]);
  return rows.map((r) => ({ g: r.g, units: Number(r.units), value: Number(r.value) }));
}

async function countryPerformance(code) {
  const country = await q.get('SELECT * FROM countries WHERE code = ?', [code]);
  if (!country) return null;
  const w = await fiscalWindows();

  const targetRows = await q.all(
    `SELECT brand_id, COALESCE(SUM(target_units),0) AS tu, COALESCE(SUM(target_value),0) AS tv
     FROM country_targets WHERE country_code = ? AND month IN (${w.ytdMonths.map(() => '?').join(',')})
     GROUP BY brand_id`, [code, ...w.ytdMonths]);
  const achRows = await sumCountrySales(code, w.ytdMonths, 's.brand_id');

  const brands = await q.all('SELECT id, name FROM brands WHERE active = 1 ORDER BY name');
  const tById = Object.fromEntries(targetRows.map((r) => [r.brand_id, { tu: Number(r.tu), tv: Number(r.tv) }]));
  const aById = Object.fromEntries(achRows.map((r) => [r.g, r]));

  const brandRows = brands.map((b) => {
    const t = tById[b.id] || { tu: 0, tv: 0 };
    const a = aById[b.id] || { units: 0, value: 0 };
    return {
      brandId: b.id, brandName: b.name,
      targetUnits: t.tu, achievedUnits: a.units, unitsPct: pct(a.units, t.tu),
      targetValue: t.tv, achievedValue: a.value, valuePct: pct(a.value, t.tv),
    };
  });

  const overall = brandRows.reduce((o, r) => ({
    targetValue: o.targetValue + r.targetValue, achievedValue: o.achievedValue + r.achievedValue,
  }), { targetValue: 0, achievedValue: 0 });
  overall.valuePct = pct(overall.achievedValue, overall.targetValue);

  const tByMonth = {}, aByMonth = {};
  (await q.all(`SELECT month, COALESCE(SUM(target_value),0) AS tv FROM country_targets WHERE country_code=? AND month IN (${w.ytdMonths.map(() => '?').join(',')}) GROUP BY month`, [code, ...w.ytdMonths]))
    .forEach((r) => { tByMonth[r.month] = Number(r.tv); });
  (await sumCountrySales(code, w.ytdMonths, 's.month')).forEach((r) => { aByMonth[r.g] = r.value; });
  const monthly = w.ytdMonths.map((m) => ({ month: m, label: prettyMonth(m), targetValue: tByMonth[m] || 0, achievedValue: aByMonth[m] || 0 }));

  const lastYtdValue = (await sumCountrySales(code, w.lastYtdMonths, 's.brand_id')).reduce((s, r) => s + r.value, 0);
  const thisYtdValue = overall.achievedValue;
  const valueYoYPct = lastYtdValue > 0 ? ((thisYtdValue - lastYtdValue) / lastYtdValue) * 100 : null;

  return {
    country: { code: country.code, name: country.name, currency: country.currency_code, symbol: country.currency_symbol },
    fyLabel: w.fyLabel,
    ytdLabel: `${prettyMonth(w.fyStart)} – ${prettyMonth(w.ref)}`,
    brands: brandRows, overall, monthly,
    yoy: { lastFyLabel: w.lastFyLabel, lastYtdValue, thisYtdValue, valueYoYPct },
  };
}

async function countryProducts(code) {
  const country = await q.get('SELECT * FROM countries WHERE code = ?', [code]);
  if (!country) return null;
  const w = await fiscalWindows();

  const prodMeta = await q.all(
    `SELECT p.id, p.name, p.pack, b.name AS brand_name FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.active=1`);
  const metaById = Object.fromEntries(prodMeta.map((p) => [p.id, p]));

  const load = async (months) => {
    if (!months.length) return {};
    const ph = months.map(() => '?').join(',');
    const rows = await q.all(
      `SELECT s.product_id AS pid, s.month, COALESCE(SUM(s.quantity),0) AS units, COALESCE(SUM(s.sales_value),0) AS value
       FROM sales_data s JOIN sales_batches b ON b.id=s.batch_id AND b.status='committed'
       JOIN users u ON u.id=s.employee_id
       WHERE u.country=? AND s.month IN (${ph}) GROUP BY s.product_id, s.month`, [code, ...months]);
    const by = {};
    rows.forEach((r) => { (by[r.pid] = by[r.pid] || {})[r.month] = { units: Number(r.units), value: Number(r.value) }; });
    return by;
  };
  const cur = await load(w.ytdMonths);
  const lastSame = await load(w.lastYtdMonths);
  const lastFull = await load(w.lastFyMonths);

  const sum = (obj, k) => Object.values(obj || {}).reduce((s, x) => s + (x[k] || 0), 0);
  const productIds = [...new Set([...Object.keys(cur), ...Object.keys(lastFull)])];
  const products = productIds.map((pid) => {
    const m = metaById[pid] || { name: pid, brand_name: '' };
    const curMonths = cur[pid] || {};
    const curUnits = sum(curMonths, 'units'), curValue = sum(curMonths, 'value');
    const lsUnits = sum(lastSame[pid], 'units'), lsValue = sum(lastSame[pid], 'value');
    const lfUnits = sum(lastFull[pid], 'units'), lfValue = sum(lastFull[pid], 'value');
    return {
      productId: pid, productName: m.name, brandName: m.brand_name, pack: m.pack,
      current: { months: curMonths, totalUnits: curUnits, totalValue: curValue },
      lastSame: { totalUnits: lsUnits, totalValue: lsValue },
      last: { months: lastFull[pid] || {}, totalUnits: lfUnits, totalValue: lfValue },
      unitsYoYPct: lsUnits > 0 ? ((curUnits - lsUnits) / lsUnits) * 100 : null,
      valueYoYPct: lsValue > 0 ? ((curValue - lsValue) / lsValue) * 100 : null,
    };
  }).sort((a, b) => b.current.totalValue - a.current.totalValue);

  return {
    currency: country.currency_code,
    country: { code: country.code, name: country.name },
    currentFY: { label: w.fyLabel, months: w.ytdMonths.map((m) => ({ key: m, label: prettyMonth(m) })) },
    lastFY: { label: w.lastFyLabel, months: w.lastFyMonths.map((m) => ({ key: m, label: prettyMonth(m) })) },
    lastSamePeriodLabel: `${prettyMonth(w.lastYtdMonths[0])} – ${prettyMonth(w.lastYtdMonths[w.lastYtdMonths.length - 1])}`,
    products,
  };
}

// ---------- account-wise rep attribution + ROI ----------
async function repAttribution(countryFilter) {
  const { computeActivityROI, cfgNum } = require('./roi');
  const w = await fiscalWindows();
  const margin = (await cfgNum('gross_margin_pct', 70)) / 100;

  const chemOwner = Object.fromEntries((await q.all('SELECT id, rep_id FROM chemists')).map((c) => [c.id, c.rep_id]));
  const hcpOwner = Object.fromEntries((await q.all('SELECT id, rep_id FROM hcps')).map((hc) => [hc.id, hc.rep_id]));

  const ytdSet = new Set(w.ytdMonths);
  const repSales = {};
  (await q.all(`SELECT s.hcp_id, s.chemist_id, s.month, s.sales_value FROM sales_data s
         JOIN sales_batches b ON b.id=s.batch_id AND b.status='committed'`)).forEach((r) => {
    if (!ytdSet.has(r.month)) return;
    const rep = (r.chemist_id && chemOwner[r.chemist_id]) || (r.hcp_id && hcpOwner[r.hcp_id]);
    if (!rep) return;
    repSales[rep] = (repSales[rep] || 0) + Number(r.sales_value);
  });

  const reps = await q.all(`SELECT id, name, country FROM users WHERE role='sales' ${countryFilter ? 'AND country=?' : ''} ORDER BY country, name`,
    countryFilter ? [countryFilter] : []);

  const out = [];
  for (const rep of reps) {
    const acts = await q.all(`SELECT id, actual_cost FROM activities WHERE proposed_by=? AND status IN ('executed','closed')`, [rep.id]);
    let spend = 0, incremental = 0, dataPoints = 0;
    for (const a of acts) {
      const roi = await computeActivityROI(a.id);
      if (roi && roi.available) { spend += roi.cost; incremental += roi.incremental; dataPoints++; }
      else spend += a.actual_cost || 0;
    }
    const roiPct = spend > 0 && dataPoints > 0 ? ((incremental * margin - spend) / spend) * 100 : null;
    const accounts = await q.get(`SELECT
        (SELECT COUNT(*) FROM hcps WHERE rep_id=?) AS docs,
        (SELECT COUNT(*) FROM chemists WHERE rep_id=?) AS chems`, [rep.id, rep.id]);
    out.push({
      repId: rep.id, name: rep.name, country: rep.country,
      ownedDoctors: Number(accounts.docs), ownedChemists: Number(accounts.chems),
      accountSalesYTD: repSales[rep.id] || 0,
      activities: acts.length, spend, incremental, roiPct,
    });
  }
  return out;
}

async function poolOverview() {
  const countries = await listCountries();
  const out = [];
  for (const c of countries) {
    const p = await countryPerformance(c.code);
    out.push({ code: c.code, name: c.name, currency: c.currency_code, symbol: c.currency_symbol,
      overall: p.overall, yoy: p.yoy, ytdLabel: p.ytdLabel, fyLabel: p.fyLabel });
  }
  return out;
}

module.exports = { listCountries, countryPerformance, countryProducts, repAttribution, poolOverview, fiscalWindows };
