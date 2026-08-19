// End-to-end critical path: boot on a scratch DB, then
// login(sales) -> propose -> login(HO) -> approve -> execute -> validate CSV -> commit -> ROI.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PORT = 3999;
const BASE = `http://localhost:${PORT}/api`;
let child;
let dbFile;

async function call(pathname, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

before(async () => {
  // Boot against a throwaway on-disk libSQL database via DATABASE_URL (a file: URL).
  // A file DB — not :memory: — is required because @libsql/client gives each connection
  // its own in-memory database, so the transaction()/batch() connections would not share
  // tables with the main one. A file is shared across connections, exactly like Turso.
  dbFile = path.join(os.tmpdir(), `pharmatrack-test-${Date.now()}.db`);
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: `file:${dbFile.replace(/\\/g, '/')}` },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not start');
});

after(() => {
  child && child.kill();
  try { fs.rmSync(dbFile, { force: true }); fs.rmSync(dbFile + '-wal', { force: true }); fs.rmSync(dbFile + '-shm', { force: true }); } catch {}
});

test('critical path', async () => {
  // 1. login as sales rep
  const repLogin = await call('/auth/login', { method: 'POST', body: { email: 'kenya@pharos.demo', password: 'demo123' } });
  assert.equal(repLogin.status, 200);
  const rep = repLogin.data.token;

  // wrong password rejected
  const bad = await call('/auth/login', { method: 'POST', body: { email: 'kenya@pharos.demo', password: 'nope' } });
  assert.equal(bad.status, 401);

  // 2. RBAC: sales cannot approve or see audit
  const forbidden = await call('/audit', { token: rep });
  assert.equal(forbidden.status, 403);

  // 3. propose
  const proposal = await call('/activities', {
    method: 'POST', token: rep,
    body: { title: 'Test CME', typeId: 'CME', brandId: 'BR01', estimatedCost: 10000, submit: true,
            targets: [{ accountId: 'HCP001', accountType: 'hcp' }] },
  });
  assert.equal(proposal.status, 200);
  const actId = proposal.data.id;

  // 4. Sequential sign-off: SER → CLM (Kenya) → CM → Marketing
  const clmLogin = await call('/auth/login', { method: 'POST', body: { email: 'clm.kenya@pharos.demo', password: 'demo123' } });
  assert.equal(clmLogin.status, 200);
  const clm = clmLogin.data.token;
  const cmLogin = await call('/auth/login', { method: 'POST', body: { email: 'cm@pharos.demo', password: 'demo123' } });
  assert.equal(cmLogin.status, 200);
  const cm = cmLogin.data.token;
  const hoLogin = await call('/auth/login', { method: 'POST', body: { email: 'amit@pharos.demo', password: 'demo123' } });
  const ho = hoLogin.data.token;

  // Out-of-turn approval is blocked: Marketing cannot approve while it is still at the CLM stage
  const early = await call(`/activities/${actId}/decision`, { method: 'POST', token: ho, body: { decision: 'approved', remarks: 'ok' } });
  assert.equal(early.status, 403);
  // A CLM from a different country cannot approve this Kenya proposal
  const clmUgLogin = await call('/auth/login', { method: 'POST', body: { email: 'clm.uganda@pharos.demo', password: 'demo123' } });
  const clmUg = clmUgLogin.data.token;
  const wrongClm = await call(`/activities/${actId}/decision`, { method: 'POST', token: clmUg, body: { decision: 'approved' } });
  assert.equal(wrongClm.status, 403);
  // CM cannot skip ahead while the Kenya CLM seat is filled (no vacancy to cover)
  const cmEarly = await call(`/activities/${actId}/decision`, { method: 'POST', token: cm, body: { decision: 'approved' } });
  assert.equal(cmEarly.status, 403);
  // CLM (Kenya) signs off → advances to CM
  const dClm = await call(`/activities/${actId}/decision`, { method: 'POST', token: clm, body: { decision: 'approved', remarks: 'clm ok' } });
  assert.equal(dClm.status, 200);
  assert.equal(dClm.data.stage, 'cm');
  // CM signs off → advances to Marketing
  const dCm = await call(`/activities/${actId}/decision`, { method: 'POST', token: cm, body: { decision: 'approved', remarks: 'cm ok' } });
  assert.equal(dCm.status, 200);
  assert.equal(dCm.data.stage, 'marketing');
  // Marketing gives the final approval
  const decision = await call(`/activities/${actId}/decision`, { method: 'POST', token: ho, body: { decision: 'approved', remarks: 'ok' } });
  assert.equal(decision.status, 200);
  assert.equal(decision.data.stage, 'approved');

  // HO cannot execute (sales-only)
  const hoExec = await call(`/activities/${actId}/execute`, { method: 'POST', token: ho, body: {} });
  assert.equal(hoExec.status, 403);

  // execution requires feedback + attendance + bills + photos — a bare body is rejected
  const execIncomplete = await call(`/activities/${actId}/execute`, {
    method: 'POST', token: rep,
    body: { actualDate: '2026-03-20', actualCost: 9000,
      expenses: [{ category: 'Food', amount: 9000 }],
      attendees: [{ accountId: 'HCP001', accountType: 'hcp', attended: true }] },
  });
  assert.equal(execIncomplete.status, 400); // no feedback / no photos

  // 5. execute with all mandatory fields (feedback, attendance, bills, photos)
  const exec = await call(`/activities/${actId}/execute`, {
    method: 'POST', token: rep,
    body: {
      actualDate: '2026-03-20', actualCost: 9000,
      expenses: [{ category: 'Food', amount: 5000 }, { category: 'Hall', amount: 4000 }],
      attendees: [{ accountId: 'HCP001', accountType: 'hcp', attended: true }],
      completionRemarks: 'Strong turnout; good engagement on the brand.',
      attachments: [{ kind: 'photo', filename: 'event.jpg', mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA' }],
    },
  });
  assert.equal(exec.status, 200);

  // unbalanced breakup rejected
  const bad2 = await call(`/activities/${actId}/execute`, {
    method: 'POST', token: rep,
    body: { actualDate: '2026-03-20', actualCost: 1, expenses: [{ category: 'Food', amount: 99 }], attendees: [{ accountId: 'HCP001', accountType: 'hcp', attended: true }] },
  });
  assert.equal(bad2.status, 409); // already executed → lifecycle guard fires first

  // 6. CSV validate + commit
  const csvText = ['month,employee_code,hcp_id,chemist_id,brand,product,quantity,sales_value,prescription_count,source,remarks',
    '2026-05,EMP001,,CHEM001,BR01,PR01,10,5000,4,test,', '2026-05,EMP001,HCP001,,BR01,PR01,5,2500,2,test,'].join('\n');
  const val = await call('/sales/validate', { method: 'POST', token: ho, body: { csvText } });
  assert.equal(val.status, 200);
  assert.equal(val.data.validCount, 2);
  const commit = await call('/sales/commit', { method: 'POST', token: ho, body: { csvText, filename: 'test.csv' } });
  assert.equal(commit.status, 200);

  // bad CSV rejected
  const badCsv = await call('/sales/validate', { method: 'POST', token: ho, body: { csvText: 'month,employee_code,hcp_id,chemist_id,brand,product,quantity,sales_value,prescription_count,source,remarks\n2099-01,EMPX,,CHEMX,BRX,PRX,1,-5,0,,' } });
  assert.equal(badCsv.data.validCount, 0);
  assert.ok(badCsv.data.errorCount >= 1);

  // 7. ROI endpoint returns a finite structure
  const roi = await call(`/roi/activity/ACT001`, { token: ho });
  assert.equal(roi.status, 200);
  assert.equal(roi.data.available, true);
  assert.ok(Number.isFinite(roi.data.roiPct));

  // 8. executive dashboard
  const dash = await call('/dashboards/executive', { token: ho });
  assert.equal(dash.status, 200);
  assert.ok(dash.data.cards.activities >= 4);
  assert.equal(dash.data.reportingCurrency, 'USD'); // cross-country roll-up consolidated in US$
  // Country Manager sees the all-country executive dashboard + pool too (not just HO).
  const cmDash = await call('/dashboards/executive', { token: cm });
  assert.equal(cmDash.status, 200);
  const cmPool = await call('/performance/pool', { token: cm });
  assert.equal(cmPool.status, 200);
  assert.equal(cmPool.data.length, 6);

  // 9. country performance: consolidated targets vs achievement, units + value
  const perf = await call('/performance/country/KE', { token: ho });
  assert.equal(perf.status, 200);
  assert.equal(perf.data.country.currency, 'KES');
  assert.ok(perf.data.brands.length >= 1);
  assert.ok(Number.isFinite(perf.data.overall.targetValue));
  assert.ok(Number.isFinite(perf.data.overall.achievedValue));
  assert.ok(Number.isFinite(perf.data.brands[0].achievedUnits)); // units per brand
  assert.ok(perf.data.ytdLabel && perf.data.yoy);

  // product-level month-on-month + YoY
  const products = await call('/performance/country/KE/products', { token: ho });
  assert.equal(products.status, 200);
  assert.ok(products.data.products.length >= 1);
  assert.ok(products.data.lastFY.label && products.data.currentFY.label);

  // account-wise rep attribution + ROI
  const repsPerf = await call('/performance/reps?country=KE', { token: ho });
  assert.equal(repsPerf.status, 200);
  assert.ok(repsPerf.data.length >= 2); // Kenya has 2 reps

  // chemist / wholesaler activity ROI (ACT006 = Kampala Wholesaler Trade Meet)
  const chemRoi = await call('/roi/activity/ACT006', { token: ho });
  assert.equal(chemRoi.status, 200);
  assert.equal(chemRoi.data.available, true);
  assert.ok(chemRoi.data.perChemist.length >= 1);
  assert.ok(Number.isFinite(chemRoi.data.perChemist[0].incremental));

  const chemBoard = await call('/roi/leaderboard?scope=chemist', { token: ho });
  assert.equal(chemBoard.status, 200);
  assert.ok(chemBoard.data.rows.length >= 1);
  assert.equal(chemBoard.data.currency, 'USD'); // HO spans countries -> consolidated in US$

  const chemProfile = await call('/chemists/CHEM005/profile', { token: ho });
  assert.equal(chemProfile.status, 200);
  assert.equal(chemProfile.data.chemist.type, 'Wholesaler');
  assert.ok(chemProfile.data.engagements.length >= 1);

  // master-data import (HO) -> reflects rep-wise on the sales interface
  const docCsv = 'hcp_id,name,speciality,qualification,hospital_clinic,location,class,category,rep_code,country,registration_no,contact,chemist_ids\n' +
    ',Dr. Import Test,Cardiology,MD,Test Hospital,Nairobi,Diamond,A,EMP001,KE,,,CHEM001';
  const dval = await call('/masters/doctors/validate', { method: 'POST', token: ho, body: { csvText: docCsv } });
  assert.equal(dval.status, 200);
  assert.equal(dval.data.validCount, 1);
  assert.equal(dval.data.inserts, 1);
  const dimp = await call('/masters/doctors/import', { method: 'POST', token: ho, body: { csvText: docCsv } });
  assert.equal(dimp.status, 200);
  assert.equal(dimp.data.inserted, 1);
  const repDocs = await call('/hcps', { token: rep }); // rep = EMP001 (Kenya)
  assert.ok(repDocs.data.some((d) => d.name === 'Dr. Import Test'), 'imported doctor should appear for its rep');

  const dexp = await call('/masters/doctors/export', { token: ho });
  assert.equal(dexp.status, 200);
  assert.ok(String(dexp.data).includes('Dr. Import Test'));

  const chemCsv = 'chemist_id,name,type,address,city,rep_code,country,is_hospital_in_house\n' +
    ',Import Wholesaler,Wholesaler,CBD,Nairobi,EMP001,KE,0';
  const cimp = await call('/masters/chemists/import', { method: 'POST', token: ho, body: { csvText: chemCsv } });
  assert.equal(cimp.status, 200);
  assert.equal(cimp.data.inserted, 1);

  // sales users cannot import master data
  const importForbidden = await call('/masters/doctors/import', { method: 'POST', token: rep, body: { csvText: docCsv } });
  assert.equal(importForbidden.status, 403);

  // per-country PTR pricing (no single MRP)
  const prods = await call('/products', { token: ho });
  assert.equal(prods.status, 200);
  assert.ok(prods.data.some((p) => p.prices && p.prices.length), 'products should carry per-country PTR');
  const newProd = await call('/products', { method: 'POST', token: ho,
    body: { name: 'TestMed', brandId: 'BR01', pack: '1x10', prices: [{ country: 'KE', ptr: 500 }, { country: 'UG', ptr: 15000 }] } });
  assert.equal(newProd.status, 200);
  const created = (await call('/products', { token: ho })).data.find((p) => p.id === newProd.data.id);
  assert.equal(created.prices.length, 2);
  const upd = await call(`/products/${newProd.data.id}/prices`, { method: 'PUT', token: ho, body: { prices: [{ country: 'KE', ptr: 600 }] } });
  assert.equal(upd.status, 200);
  const afterUpd = (await call('/products', { token: ho })).data.find((p) => p.id === newProd.data.id);
  assert.equal(afterUpd.prices.length, 1);
  const prodForbidden = await call('/products', { method: 'POST', token: rep, body: { name: 'x', brandId: 'BR01' } });
  assert.equal(prodForbidden.status, 403);

  // sales rep is scoped to own country only
  const wrongCountry = await call('/performance/country/UG', { token: rep });
  assert.equal(wrongCountry.status, 403);

  // pool overview lists all 6 countries
  const pool = await call('/performance/pool', { token: ho });
  assert.equal(pool.data.length, 6);

  // sales users cannot download report files
  const dl = await call('/reports/sales.csv', { token: rep });
  assert.equal(dl.status, 403);

  // 10. daily allowance: rep creates a claim; routes SER → CLM → CM → Admin
  const daCreate = await call('/da', {
    method: 'POST', token: rep,
    body: { daDate: '2026-06-26', location: 'Nairobi', purpose: 'calls', daAmount: 3000,
            attachments: [{ category: 'Fuel', amount: 1500, filename: 'r.jpg' }] },
  });
  assert.equal(daCreate.status, 200);
  const daId = daCreate.data.id;
  const adminLogin = await call('/auth/login', { method: 'POST', body: { email: 'admin@pharos.demo', password: 'demo123' } });
  const admin = adminLogin.data.token;
  // Neither Marketing nor Admin can approve out of turn while it is still at the CLM stage
  const daByMarketing = await call(`/da/${daId}/decision`, { method: 'POST', token: ho, body: { decision: 'approved' } });
  assert.equal(daByMarketing.status, 403);
  const daEarlyAdmin = await call(`/da/${daId}/decision`, { method: 'POST', token: admin, body: { decision: 'approved' } });
  assert.equal(daEarlyAdmin.status, 403);
  // CLM (Kenya) → CM → Admin
  const daClm = await call(`/da/${daId}/decision`, { method: 'POST', token: clm, body: { decision: 'approved' } });
  assert.equal(daClm.status, 200);
  assert.equal(daClm.data.stage, 'cm');
  const daCm = await call(`/da/${daId}/decision`, { method: 'POST', token: cm, body: { decision: 'approved' } });
  assert.equal(daCm.status, 200);
  assert.equal(daCm.data.stage, 'admin');
  const daDecision = await call(`/da/${daId}/decision`, { method: 'POST', token: admin, body: { decision: 'approved' } });
  assert.equal(daDecision.status, 200);
  assert.equal(daDecision.data.stage, 'approved');

  // 11. Admin creates users with the real designations; SER/CLM must carry a country.
  const serNoCountry = await call('/users', { method: 'POST', token: admin,
    body: { name: 'Test SER', email: 'test.ser@pharos.demo', role: 'sales', subRole: 'Sales Executive Representative' } });
  assert.equal(serNoCountry.status, 400); // country required for a SER
  const clmCreate = await call('/users', { method: 'POST', token: admin,
    body: { name: 'Test CLM', email: 'test.clm@pharos.demo', role: 'clm', subRole: 'Cluster Lead Manager', country: 'KE' } });
  assert.equal(clmCreate.status, 200);
  assert.ok(clmCreate.data.id.startsWith('CLM'));
  const usersList = await call('/users', { token: admin });
  const madeClm = usersList.data.find((u) => u.email === 'test.clm@pharos.demo');
  assert.equal(madeClm.role, 'clm');
  assert.equal(madeClm.country, 'KE');
  // non-admin cannot manage users
  const salesUsers = await call('/users', { token: rep });
  assert.equal(salesUsers.status, 403);

  // 12. rollback batch
  const rb = await call(`/sales/batches/${commit.data.batchId}/rollback`, { method: 'POST', token: ho, body: {} });
  assert.equal(rb.status, 200);
});

// Vacancy / escalation rules, tested directly against the engine with a stubbed data layer.
test('vacancy escalation authority', async () => {
  const { CHAINS, canActResolved } = require('../server/services/approvals');
  const CM = { role: 'cm' };
  const ADMIN = { role: 'ho', sub_role: 'Admin' };
  const CLM_KE = { role: 'clm', country: 'KE' };
  const MKT = { role: 'ho', sub_role: 'Product Manager' };

  // `present` = seats that are currently filled. Stub answers the COUNT(*) probes by SQL shape.
  const stubQ = (present) => ({
    get: async (sql, args) => {
      let key;
      if (sql.includes("role='clm'")) key = 'clm:' + args[0];
      else if (sql.includes("role='cm'")) key = 'cm';
      else if (sql.includes('Product Manager')) key = 'marketing';
      else if (sql.includes("sub_role='Admin'")) key = 'admin';
      return { c: present.has(key) ? 1 : 0 };
    },
  });
  const all = new Set(['clm:KE', 'cm', 'marketing', 'admin']);

  // Normal: everyone can act on their own stage; no one skips a filled seat.
  assert.equal(await canActResolved(stubQ(all), CLM_KE, CHAINS.activity, 'clm', 'KE'), true);
  assert.equal(await canActResolved(stubQ(all), CM, CHAINS.activity, 'clm', 'KE'), false); // CLM seat filled
  assert.equal(await canActResolved(stubQ(all), CM, CHAINS.activity, 'cm', 'KE'), true);

  // Vacant CLM (Kenya): the CM covers the clm stage for Kenya.
  const noClmKE = new Set(['cm', 'marketing', 'admin']);
  assert.equal(await canActResolved(stubQ(noClmKE), CM, CHAINS.activity, 'clm', 'KE'), true);
  // But not for a country whose CLM still exists.
  assert.equal(await canActResolved(stubQ(new Set(['clm:UG', 'cm', 'marketing', 'admin'])), CM, CHAINS.activity, 'clm', 'UG'), false);

  // Vacant CM: Marketing covers the cm stage (activity chain).
  const noCm = new Set(['clm:KE', 'marketing', 'admin']);
  assert.equal(await canActResolved(stubQ(noCm), MKT, CHAINS.activity, 'cm', 'KE'), true);

  // Vacant Marketing on an activity: Admin is the break-glass (even though admin isn't in the activity chain).
  const noMkt = new Set(['clm:KE', 'cm', 'admin']);
  assert.equal(await canActResolved(stubQ(noMkt), ADMIN, CHAINS.activity, 'marketing', 'KE'), true);
  // Admin does NOT get to bypass a filled Marketing seat.
  assert.equal(await canActResolved(stubQ(all), ADMIN, CHAINS.activity, 'marketing', 'KE'), false);
});
