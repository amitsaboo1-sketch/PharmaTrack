const express = require('express');
const { q } = require('../db/connection');
const { requireRole } = require('../middleware/auth');
const { computeActivityROI, leaderboard, cfgNum } = require('../services/roi');
const { countryPerformance, countryProducts, repAttribution, poolOverview } = require('../services/performance');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Country performance (consolidated targets vs achievement) ----------
// Sales users are scoped to their own country; HO can query any / the whole pool.
router.get('/performance/pool', requireRole('ho', 'cm'), ah(async (req, res) => res.json(await poolOverview())));

function scopeCountry(req, res, code) {
  if (req.user.role === 'sales' && req.user.country !== code) {
    res.status(403).json({ error: 'Outside your country' });
    return false;
  }
  return true;
}

router.get('/performance/country/:code', ah(async (req, res) => {
  if (!scopeCountry(req, res, req.params.code)) return;
  const perf = await countryPerformance(req.params.code);
  if (!perf) return res.status(404).json({ error: 'Country not found' });
  res.json(perf);
}));

// Product-level month-on-month + year-on-year (last FY vs this FY).
router.get('/performance/country/:code/products', ah(async (req, res) => {
  if (!scopeCountry(req, res, req.params.code)) return;
  const data = await countryProducts(req.params.code);
  if (!data) return res.status(404).json({ error: 'Country not found' });
  res.json(data);
}));

// Account-wise rep attribution + ROI (sales are country-wide, accounts are rep-owned).
router.get('/performance/reps', ah(async (req, res) => {
  // A SER and a CLM are scoped to their own country; CM/HO see the whole pool (or a filter).
  const country = req.query.country || (['sales', 'clm'].includes(req.user.role) ? req.user.country : null);
  const usd = !country;   // a single country → local currency; the whole pool → consolidated US$
  const rows = await repAttribution(country, { usd });
  let currency = 'USD';
  if (country) { const c = await q.get('SELECT currency_code FROM countries WHERE code = ?', [country]); currency = (c && c.currency_code) || 'USD'; }
  res.json({ rows, currency });
}));

// ---------- ROI ----------
router.get('/roi/activity/:id', ah(async (req, res) => {
  const act = await q.get('SELECT * FROM activities WHERE id = ?', [req.params.id]);
  if (!act) return res.status(404).json({ error: 'Activity not found' });
  if (req.user.role === 'sales' && act.proposed_by !== req.user.id) return res.status(403).json({ error: 'Not your activity' });
  res.json(await computeActivityROI(act.id));
}));

router.get('/roi/leaderboard', ah(async (req, res) => {
  const scope = ['hcp', 'chemist', 'employee', 'brand'].includes(req.query.scope) ? req.query.scope : 'hcp';
  const isSales = req.user.role === 'sales';
  const repFilter = isSales ? req.user.id : null;
  // A sales rep sees only their own country → keep local currency. Anyone who spans multiple
  // countries (HO / CM / CLM) gets figures consolidated in US$.
  const rows = await leaderboard(scope, repFilter, { usd: !isSales });
  let currency = 'USD';
  if (isSales && req.user.country) {
    const c = await q.get('SELECT currency_code FROM countries WHERE code = ?', [req.user.country]);
    currency = (c && c.currency_code) || 'USD';
  }
  res.json({ rows, currency });
}));

// ---------- Executive dashboard (HO) ----------
router.get('/dashboards/executive', requireRole('ho', 'cm'), ah(async (req, res) => {
  // This view rolls up across all six countries, each with a different currency, so every
  // monetary figure is converted to a single reporting currency (US$) via each row's country
  // rate (activities by activity.country; sales by the rep's country). Per-country pages keep
  // their own local currency. R = local-per-USD; dividing local amounts by R gives US$.
  const totals = await q.get(
    `SELECT COUNT(*) AS activities,
            SUM(CASE WHEN a.status='submitted' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN a.status IN ('executed','closed') THEN 1 ELSE 0 END) AS completed,
            COALESCE(SUM(CASE WHEN a.status IN ('executed','closed') THEN a.actual_cost/COALESCE(c.usd_rate,1) ELSE 0 END),0) AS actual_spend,
            COALESCE(SUM(a.estimated_cost/COALESCE(c.usd_rate,1)),0) AS planned_budget
     FROM activities a LEFT JOIN countries c ON c.code = a.country`);

  const monthlySpend = await q.all(
    `SELECT substr(a.actual_date,1,7) AS month, SUM(a.actual_cost/COALESCE(c.usd_rate,1)) AS spend
     FROM activities a LEFT JOIN countries c ON c.code = a.country
     WHERE a.status IN ('executed','closed') AND a.actual_date IS NOT NULL
     GROUP BY month ORDER BY month`);

  const monthlySales = await q.all(
    `SELECT s.month, SUM(s.sales_value/COALESCE(c.usd_rate,1)) AS sales
     FROM sales_data s JOIN sales_batches b ON b.id=s.batch_id AND b.status='committed'
     LEFT JOIN users u ON u.id = s.employee_id LEFT JOIN countries c ON c.code = u.country
     GROUP BY s.month ORDER BY s.month`);

  const spendByType = await q.all(
    `SELECT t.name AS type, SUM(a.actual_cost/COALESCE(c.usd_rate,1)) AS spend
     FROM activities a JOIN activity_types t ON t.id = a.type_id LEFT JOIN countries c ON c.code = a.country
     WHERE a.status IN ('executed','closed') GROUP BY t.name ORDER BY spend DESC`);

  const pendingList = await q.all(
    `SELECT a.id, a.title, a.estimated_cost/COALESCE(c.usd_rate,1) AS estimated_cost, a.planned_date,
            u.name AS proposer_name, t.name AS type_name, a.country
     FROM activities a LEFT JOIN users u ON u.id=a.proposed_by LEFT JOIN activity_types t ON t.id=a.type_id
     LEFT JOIN countries c ON c.code = a.country
     WHERE a.status='submitted' ORDER BY a.created_at`);

  const brandRoi = await leaderboard('brand', null, { usd: true });
  const repRoi = await leaderboard('employee', null, { usd: true });

  // Blended ROI across executed activities with data — each activity converted to US$ first.
  const margin = (await cfgNum('gross_margin_pct', 70)) / 100;
  let cost = 0, incremental = 0, dataPoints = 0;
  for (const a of await q.all(
    `SELECT a.id, COALESCE(c.usd_rate,1) AS rate FROM activities a LEFT JOIN countries c ON c.code = a.country
     WHERE a.status IN ('executed','closed')`)) {
    const r = await computeActivityROI(a.id);
    if (r && r.available) { cost += r.cost / a.rate; incremental += r.incremental / a.rate; dataPoints++; }
  }
  const blendedRoiPct = cost > 0 && dataPoints > 0 ? ((incremental * margin - cost) / cost) * 100 : null;

  const totalSales = monthlySales.reduce((s, m) => s + m.sales, 0);
  res.json({
    reportingCurrency: 'USD',
    cards: {
      totalSpend: totals.actual_spend,
      plannedBudget: totals.planned_budget,
      budgetUtilizationPct: totals.planned_budget > 0 ? (totals.actual_spend / totals.planned_budget) * 100 : null,
      activities: totals.activities,
      pendingApprovals: totals.pending,
      completed: totals.completed,
      totalSales,
      blendedRoiPct,
      incrementalSales: incremental,
    },
    monthlySpend, monthlySales, spendByType, pendingList, brandRoi, repRoi,
  });
}));

// ---------- Sales dashboard (personal + consolidated country view) ----------
router.get('/dashboards/sales', ah(async (req, res) => {
  const repId = req.user.role === 'sales' ? req.user.id : (req.query.repId || req.user.id);
  const rep = await q.get('SELECT * FROM users WHERE id = ?', [repId]);
  const performance = rep && rep.country ? await countryPerformance(rep.country) : null;

  const acts = await q.all(
    `SELECT a.*, t.name AS type_name FROM activities a LEFT JOIN activity_types t ON t.id=a.type_id
     WHERE a.proposed_by = ? ORDER BY COALESCE(a.actual_date,a.planned_date) DESC`, [repId]);

  const statusCounts = {};
  acts.forEach((a) => { statusCounts[a.status] = (statusCounts[a.status] || 0) + 1; });

  const expenseByCategory = await q.all(
    `SELECT e.category, SUM(e.amount) AS amount
     FROM expense_lines e JOIN activities a ON a.id = e.activity_id
     WHERE a.proposed_by = ? GROUP BY e.category ORDER BY amount DESC`, [repId]);

  const topDoctors = (await leaderboard('hcp', repId)).slice(0, 5);

  const daSummary = await q.all(
    `SELECT status, COUNT(*) AS count, COALESCE(SUM(da_amount),0) AS da_total
     FROM daily_allowances WHERE user_id = ? GROUP BY status`, [repId]);

  const margin = (await cfgNum('gross_margin_pct', 70)) / 100;
  let cost = 0, incremental = 0, dataPoints = 0;
  for (const a of acts.filter((x) => ['executed', 'closed'].includes(x.status))) {
    const r = await computeActivityROI(a.id);
    if (r && r.available) { cost += r.cost; incremental += r.incremental; dataPoints++; }
  }
  res.json({
    country: performance ? performance.country : null,
    performance,
    statusCounts,
    activities: acts.slice(0, 20),
    expenseByCategory,
    topDoctors,
    daSummary,
    myRoiPct: cost > 0 && dataPoints > 0 ? ((incremental * margin - cost) / cost) * 100 : null,
    totalSpend: cost,
    incrementalSales: incremental,
  });
}));

// ---------- Discrepancy audit (HO) ----------
router.get('/audit/discrepancies', requireRole('ho'), ah(async (req, res) => {
  const overrunPct = await cfgNum('overrun_threshold_pct', 110);
  const executed = await q.all(
    `SELECT a.*, u.name AS proposer_name FROM activities a LEFT JOIN users u ON u.id = a.proposed_by
     WHERE a.status IN ('executed','closed')`);

  const findings = [];
  for (const a of executed) {
    const parts = await q.all(
      `SELECT p.*, COALESCE(h.name,c.name) AS name, h.verified AS hcp_verified, c.verified AS chem_verified
       FROM activity_participants p
       LEFT JOIN hcps h ON h.id=p.account_id AND p.account_type='hcp'
       LEFT JOIN chemists c ON c.id=p.account_id AND p.account_type='chemist'
       WHERE p.activity_id = ?`, [a.id]);

    parts.filter((p) => p.proposed && !p.attended).forEach((p) =>
      findings.push({ severity: 'medium', kind: 'proposed_absent', activityId: a.id, activity: a.title, proposer: a.proposer_name, detail: `${p.name} (${p.account_id}) was proposed but did not attend` }));
    parts.filter((p) => !p.proposed && p.attended).forEach((p) =>
      findings.push({ severity: 'medium', kind: 'unproposed_attendee', activityId: a.id, activity: a.title, proposer: a.proposer_name, detail: `${p.name} (${p.account_id}) attended but was never proposed` }));
    parts.filter((p) => p.attended && ((p.account_type === 'hcp' && p.hcp_verified === 0) || (p.account_type === 'chemist' && p.chem_verified === 0))).forEach((p) =>
      findings.push({ severity: 'high', kind: 'unverified_account', activityId: a.id, activity: a.title, proposer: a.proposer_name, detail: `${p.name} (${p.account_id}) is an unverified field account used in an executed activity` }));

    if (a.actual_cost && a.estimated_cost && a.actual_cost > a.estimated_cost * (overrunPct / 100)) {
      findings.push({ severity: 'high', kind: 'cost_overrun', activityId: a.id, activity: a.title, proposer: a.proposer_name, detail: `Actual cost exceeds estimate by ${(((a.actual_cost / a.estimated_cost) - 1) * 100).toFixed(1)}% (threshold ${overrunPct - 100}%)` });
    }
  }
  res.json(findings.sort((x, y) => (x.severity === 'high' ? -1 : 1) - (y.severity === 'high' ? -1 : 1)));
}));

// ---------- Reports (CSV downloads) ----------
function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\r\n');
}

// Data/report file downloads are HO-only. Field reps consume reports on-portal only.
router.get('/reports/:name.csv', requireRole('ho', 'cm'), ah(async (req, res) => {
  const salesScope = req.user.role === 'sales';
  const rep = req.user.id;
  let rows = [];
  switch (req.params.name) {
    case 'activities':
      rows = await q.all(
        `SELECT a.id, a.title, t.name AS type, b.name AS brand, u.name AS proposed_by, a.territory, a.status,
                a.planned_date, a.actual_date, a.estimated_cost, a.actual_cost, a.decision_remarks
         FROM activities a LEFT JOIN activity_types t ON t.id=a.type_id
         LEFT JOIN brands b ON b.id=a.brand_id LEFT JOIN users u ON u.id=a.proposed_by
         ${salesScope ? 'WHERE a.proposed_by = ?' : ''} ORDER BY a.id`, salesScope ? [rep] : []);
      break;
    case 'expenses':
      rows = await q.all(
        `SELECT a.id AS activity_id, a.title, e.category, e.amount, e.vendor, e.invoice_no
         FROM expense_lines e JOIN activities a ON a.id=e.activity_id
         ${salesScope ? 'WHERE a.proposed_by = ?' : ''} ORDER BY a.id`, salesScope ? [rep] : []);
      break;
    case 'attendance':
      rows = await q.all(
        `SELECT p.activity_id, a.title, p.account_id, p.account_type, COALESCE(h.name,c.name) AS name,
                p.proposed, p.invited, p.attended, p.remarks
         FROM activity_participants p JOIN activities a ON a.id=p.activity_id
         LEFT JOIN hcps h ON h.id=p.account_id AND p.account_type='hcp'
         LEFT JOIN chemists c ON c.id=p.account_id AND p.account_type='chemist'
         ${salesScope ? 'WHERE a.proposed_by = ?' : ''} ORDER BY p.activity_id`, salesScope ? [rep] : []);
      break;
    case 'sales':
      rows = await q.all(
        `SELECT s.month, s.employee_id, s.hcp_id, s.chemist_id, s.brand_id, s.product_id, s.quantity, s.sales_value, s.prescription_count, s.source
         FROM sales_data s JOIN sales_batches b ON b.id=s.batch_id AND b.status='committed'
         ${salesScope ? 'WHERE s.employee_id = ?' : ''} ORDER BY s.month`, salesScope ? [rep] : []);
      break;
    case 'doctor-roi':
      rows = (await leaderboard('hcp', salesScope ? rep : null)).map((r) => ({
        hcp_id: r.key, name: r.label, speciality: r.sublabel, activities: r.activities,
        allocated_cost: r.cost.toFixed(2), incremental_sales: r.incremental.toFixed(2),
        roi_pct: r.roiPct == null ? 'insufficient data' : r.roiPct.toFixed(1),
      }));
      break;
    case 'employee-roi':
      if (salesScope) return res.status(403).json({ error: 'HO only' });
      rows = (await leaderboard('employee')).map((r) => ({
        employee_id: r.key, name: r.label, territory: r.sublabel, activities: r.activities,
        spend: r.cost.toFixed(2), incremental_sales: r.incremental.toFixed(2),
        roi_pct: r.roiPct == null ? 'insufficient data' : r.roiPct.toFixed(1),
      }));
      break;
    case 'brand-roi':
      if (salesScope) return res.status(403).json({ error: 'HO only' });
      rows = (await leaderboard('brand')).map((r) => ({
        brand_id: r.key, name: r.label, therapy_area: r.sublabel, activities: r.activities,
        spend: r.cost.toFixed(2), incremental_sales: r.incremental.toFixed(2),
        roi_pct: r.roiPct == null ? 'insufficient data' : r.roiPct.toFixed(1),
      }));
      break;
    case 'audit':
      if (salesScope) return res.status(403).json({ error: 'HO only' });
      rows = await q.all('SELECT at, user_id, action, entity_type, entity_id, ip FROM audit_log ORDER BY id DESC LIMIT 5000');
      break;
    default:
      return res.status(404).json({ error: 'Unknown report' });
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}.csv"`);
  res.send(toCSV(rows));
}));

module.exports = router;
