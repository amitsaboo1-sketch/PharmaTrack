const { q } = require('../db/connection');

// ---------- helpers ----------

async function cfgNum(key, fallback) {
  const row = await q.get('SELECT value FROM config WHERE key = ?', [key]);
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

// '2026-03' + (-1) -> '2026-02'
function monthShift(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function windowMonths(month, delta, w) {
  const out = [];
  for (let i = 1; i <= w; i++) out.push(monthShift(month, delta * i));
  return out;
}

// Attribution sources for a doctor: direct HCP-tagged sales + mapped chemists' sales.
async function doctorSourceFilter(hcpId) {
  const chemists = (await q.all('SELECT chemist_id FROM hcp_chemist_map WHERE hcp_id = ?', [hcpId])).map((r) => r.chemist_id);
  return { hcpId, chemistIds: chemists };
}

// Sum committed sales for a set of sources in a set of months.
async function sumSales({ hcpIds = [], chemistIds = [] }, months) {
  if (months.length === 0 || (hcpIds.length === 0 && chemistIds.length === 0)) return { total: 0, rows: 0 };
  const mPh = months.map(() => '?').join(',');
  const parts = [];
  const params = [];
  if (hcpIds.length) { parts.push(`s.hcp_id IN (${hcpIds.map(() => '?').join(',')})`); params.push(...hcpIds); }
  if (chemistIds.length) { parts.push(`s.chemist_id IN (${chemistIds.map(() => '?').join(',')})`); params.push(...chemistIds); }
  const row = await q.get(
    `SELECT COALESCE(SUM(s.sales_value),0) AS total, COUNT(*) AS rows
     FROM sales_data s JOIN sales_batches b ON b.id = s.batch_id AND b.status = 'committed'
     WHERE (${parts.join(' OR ')}) AND s.month IN (${mPh})`,
    [...params, ...months]
  );
  return { total: Number(row.total), rows: Number(row.rows) };
}

// ---------- activity ROI (model: before_after) ----------

async function computeActivityROI(activityId) {
  const act = await q.get('SELECT * FROM activities WHERE id = ?', [activityId]);
  if (!act) return null;
  if (!['executed', 'closed'].includes(act.status) || !act.actual_date) {
    return { activityId, status: act.status, available: false, reason: 'Activity not executed yet' };
  }

  const W = await cfgNum('roi_window_months', 3);
  const margin = (await cfgNum('gross_margin_pct', 70)) / 100;
  const month = act.actual_date.slice(0, 7);
  const before = windowMonths(month, -1, W);
  const after = windowMonths(month, +1, W);

  const parts = await q.all(
    `SELECT account_id, account_type FROM activity_participants WHERE activity_id = ? AND attended = 1`, [activityId]);
  const hcpIds = parts.filter((pp) => pp.account_type === 'hcp').map((pp) => pp.account_id);
  const directChemists = parts.filter((pp) => pp.account_type === 'chemist').map((pp) => pp.account_id);

  const cost = act.actual_cost || 0;
  const attendedAccounts = hcpIds.length + directChemists.length;
  const costPerAccount = attendedAccounts ? cost / attendedAccounts : cost;

  const perDoctor = await Promise.all(hcpIds.map(async (h) => {
    const src = await doctorSourceFilter(h);
    const b = await sumSales({ hcpIds: [h], chemistIds: src.chemistIds }, before);
    const a = await sumSales({ hcpIds: [h], chemistIds: src.chemistIds }, after);
    const hcp = await q.get('SELECT name, speciality, class FROM hcps WHERE id = ?', [h]);
    return {
      hcpId: h, name: hcp ? hcp.name : h, speciality: hcp ? hcp.speciality : '', class: hcp ? hcp.class : '',
      allocatedCost: costPerAccount, baselineAvgMonthly: b.total / W, postAvgMonthly: a.total / W,
      incremental: a.total - b.total, hasPostData: a.rows > 0,
    };
  }));

  const perChemist = await Promise.all(directChemists.map(async (cid) => {
    const b = await sumSales({ chemistIds: [cid] }, before);
    const a = await sumSales({ chemistIds: [cid] }, after);
    const c = await q.get('SELECT name, type, city FROM chemists WHERE id = ?', [cid]);
    return {
      chemistId: cid, name: c ? c.name : cid, type: c ? (c.type || 'Retail') : '', city: c ? c.city : '',
      allocatedCost: costPerAccount, baselineAvgMonthly: b.total / W, postAvgMonthly: a.total / W,
      incremental: a.total - b.total, hasPostData: a.rows > 0,
    };
  }));

  // De-duplicated source set for activity-level totals.
  const chemSet = new Set(directChemists);
  for (const h of hcpIds) { (await doctorSourceFilter(h)).chemistIds.forEach((c) => chemSet.add(c)); }
  const sources = { hcpIds, chemistIds: [...chemSet] };
  const bTot = await sumSales(sources, before);
  const aTot = await sumSales(sources, after);

  const available = aTot.rows > 0;
  const baseline = bTot.total;
  const post = aTot.total;
  const incremental = post - baseline;
  const incrementalProfit = incremental * margin;
  const roiPct = available && cost > 0 ? ((incrementalProfit - cost) / cost) * 100 : null;
  const monthlyProfit = (incremental / W) * margin;
  const paybackMonths = available && monthlyProfit > 0 ? cost / monthlyProfit : null;

  let prescriptionsAfter = 0;
  if (hcpIds.length || chemSet.size) {
    const conds = [];
    const rxParams = [];
    if (hcpIds.length) { conds.push(`s.hcp_id IN (${hcpIds.map(() => '?').join(',')})`); rxParams.push(...hcpIds); }
    if (chemSet.size) { const arr = [...chemSet]; conds.push(`s.chemist_id IN (${arr.map(() => '?').join(',')})`); rxParams.push(...arr); }
    const rxRow = await q.get(
      `SELECT COALESCE(SUM(s.prescription_count),0) AS rx
       FROM sales_data s JOIN sales_batches b ON b.id = s.batch_id AND b.status='committed'
       WHERE (${conds.join(' OR ')}) AND s.month IN (${after.map(() => '?').join(',')})`,
      [...rxParams, ...after]
    );
    prescriptionsAfter = Number(rxRow.rx);
  }

  const result = {
    activityId, title: act.title, available, model: 'before_after', windowMonths: W, activityMonth: month,
    cost, baselineSales: baseline, postSales: post, incremental, grossMarginPct: margin * 100, incrementalProfit,
    roiPct, costPerDoctor: hcpIds.length ? costPerAccount : null, costPerAccount, paybackMonths,
    attendedDoctors: hcpIds.length, attendedChemists: directChemists.length, prescriptionsAfter,
    perDoctor, perChemist, reason: available ? null : 'No sales data yet in the post-activity window',
  };

  await q.run(`DELETE FROM roi_results WHERE scope = 'activity' AND scope_id = ?`, [activityId]);
  await q.run(
    `INSERT INTO roi_results (scope,scope_id,model,window_months,computed_at,cost,baseline_sales,post_sales,incremental,roi_pct,details)
     VALUES ('activity',?,?,?,?,?,?,?,?,?,?)`,
    [activityId, 'before_after', W, new Date().toISOString(), cost, baseline, post, incremental, roiPct, JSON.stringify({ attendedDoctors: hcpIds.length })]
  );
  return result;
}

// ---------- rollups ----------

function executedActivities(where = '', params = []) {
  return q.all(`SELECT * FROM activities WHERE status IN ('executed','closed') ${where ? 'AND ' + where : ''}`, params);
}

async function leaderboard(scope, repFilter = null) {
  const acts = repFilter ? await executedActivities('proposed_by = ?', [repFilter]) : await executedActivities();
  const buckets = new Map();
  const bump = (key, label, sublabel, cost, incremental, hasData) => {
    if (!buckets.has(key)) buckets.set(key, { key, label, sublabel, cost: 0, incremental: 0, activities: 0, dataPoints: 0 });
    const b = buckets.get(key);
    b.cost += cost; b.incremental += incremental; b.activities += 1; if (hasData) b.dataPoints += 1;
  };

  for (const act of acts) {
    const roi = await computeActivityROI(act.id);
    const cost = act.actual_cost || 0;
    const inc = roi && roi.available ? roi.incremental : 0;
    const has = !!(roi && roi.available);
    if (scope === 'employee') {
      const u = await q.get('SELECT name, territory FROM users WHERE id = ?', [act.proposed_by]);
      bump(act.proposed_by, u ? u.name : act.proposed_by, u ? u.territory : '', cost, inc, has);
    } else if (scope === 'brand') {
      const b = await q.get('SELECT name, therapy_area FROM brands WHERE id = ?', [act.brand_id]);
      bump(act.brand_id || '—', b ? b.name : act.brand_id || 'Unassigned', b ? b.therapy_area : '', cost, inc, has);
    } else if (scope === 'hcp') {
      for (const d of (roi && roi.perDoctor) || []) bump(d.hcpId, d.name, d.speciality, d.allocatedCost, d.incremental, d.hasPostData);
    } else if (scope === 'chemist') {
      for (const c of (roi && roi.perChemist) || []) bump(c.chemistId, c.name, c.type, c.allocatedCost, c.incremental, c.hasPostData);
    }
  }

  const margin = (await cfgNum('gross_margin_pct', 70)) / 100;
  return [...buckets.values()]
    .map((b) => ({ ...b, roiPct: b.cost > 0 && b.dataPoints > 0 ? ((b.incremental * margin - b.cost) / b.cost) * 100 : null }))
    .sort((x, y) => (y.roiPct ?? -Infinity) - (x.roiPct ?? -Infinity));
}

// Doctor 360
async function doctorProfile(hcpId) {
  const hcp = await q.get('SELECT * FROM hcps WHERE id = ?', [hcpId]);
  if (!hcp) return null;

  const engagements = await q.all(
    `SELECT a.id, a.title, a.type_id, a.status, a.planned_date, a.actual_date, a.actual_cost, a.estimated_cost,
            p.proposed, p.invited, p.attended
     FROM activity_participants p JOIN activities a ON a.id = p.activity_id
     WHERE p.account_id = ? AND p.account_type = 'hcp'
     ORDER BY COALESCE(a.actual_date, a.planned_date) DESC`, [hcpId]);

  const src = await doctorSourceFilter(hcpId);
  const trend = await q.all(
    `SELECT s.month, SUM(s.sales_value) AS sales, SUM(s.prescription_count) AS rx
     FROM sales_data s JOIN sales_batches b ON b.id = s.batch_id AND b.status='committed'
     WHERE s.hcp_id = ? ${src.chemistIds.length ? `OR s.chemist_id IN (${src.chemistIds.map(() => '?').join(',')})` : ''}
     GROUP BY s.month ORDER BY s.month`, [hcpId, ...src.chemistIds]);

  let spend = 0, incremental = 0, dataPoints = 0;
  for (const e of engagements) {
    if (!['executed', 'closed'].includes(e.status) || !e.attended) continue;
    const roi = await computeActivityROI(e.id);
    const mine = roi && roi.perDoctor ? roi.perDoctor.find((d) => d.hcpId === hcpId) : null;
    if (mine) { spend += mine.allocatedCost; incremental += mine.incremental; if (mine.hasPostData) dataPoints += 1; }
  }
  const margin = (await cfgNum('gross_margin_pct', 70)) / 100;
  const roiPct = spend > 0 && dataPoints > 0 ? ((incremental * margin - spend) / spend) * 100 : null;

  const mappedChemists = await q.all(
    `SELECT c.* FROM hcp_chemist_map m JOIN chemists c ON c.id = m.chemist_id WHERE m.hcp_id = ?`, [hcpId]);
  return { hcp, engagements, trend, mappedChemists, historicalSpend: spend, incremental, roiPct };
}

// Chemist / Wholesaler 360
async function chemistProfile(chemistId) {
  const chemist = await q.get('SELECT * FROM chemists WHERE id = ?', [chemistId]);
  if (!chemist) return null;

  const engagements = await q.all(
    `SELECT a.id, a.title, a.type_id, a.status, a.planned_date, a.actual_date, a.actual_cost, a.estimated_cost,
            p.proposed, p.invited, p.attended
     FROM activity_participants p JOIN activities a ON a.id = p.activity_id
     WHERE p.account_id = ? AND p.account_type = 'chemist'
     ORDER BY COALESCE(a.actual_date, a.planned_date) DESC`, [chemistId]);

  const trend = await q.all(
    `SELECT s.month, SUM(s.sales_value) AS sales, SUM(s.quantity) AS units
     FROM sales_data s JOIN sales_batches b ON b.id = s.batch_id AND b.status='committed'
     WHERE s.chemist_id = ? GROUP BY s.month ORDER BY s.month`, [chemistId]);

  let spend = 0, incremental = 0, dataPoints = 0;
  for (const e of engagements) {
    if (!['executed', 'closed'].includes(e.status) || !e.attended) continue;
    const roi = await computeActivityROI(e.id);
    const mine = roi && roi.perChemist ? roi.perChemist.find((c) => c.chemistId === chemistId) : null;
    if (mine) { spend += mine.allocatedCost; incremental += mine.incremental; if (mine.hasPostData) dataPoints += 1; }
  }
  const margin = (await cfgNum('gross_margin_pct', 70)) / 100;
  const roiPct = spend > 0 && dataPoints > 0 ? ((incremental * margin - spend) / spend) * 100 : null;

  const mappedDoctors = await q.all(
    `SELECT h.* FROM hcp_chemist_map m JOIN hcps h ON h.id = m.hcp_id WHERE m.chemist_id = ?`, [chemistId]);
  return { chemist, engagements, trend, mappedDoctors, historicalSpend: spend, incremental, roiPct };
}

module.exports = { computeActivityROI, leaderboard, doctorProfile, chemistProfile, cfgNum, monthShift };
