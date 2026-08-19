const express = require('express');
const bcrypt = require('bcryptjs');
const { q } = require('../db/connection');
const { requireRole, requireAdmin } = require('../middleware/auth');
const { CHAINS, nextStage, canActResolved, stageForUser, verifyPendingCondition, ADD_FLAG, REM_FLAG, STAGE_LABEL } = require('../services/approvals');
const { audit, notify, notifyStage } = require('../middleware/audit');

// Current pending stage of a field account in the add / removal chains (clm -> cm -> marketing -> admin).
function addStage(rec) {
  if (!rec.clm_ok) return 'clm';
  if (!rec.cm_ok) return 'cm';
  if (!rec.mkt_verified) return 'marketing';
  return 'admin';
}
function removalStage(rec) {
  if (!rec.removal_clm_ok) return 'clm';
  if (!rec.removal_cm_ok) return 'cm';
  if (!rec.removal_mkt_ok) return 'marketing';
  return 'admin';
}
const { doctorProfile, chemistProfile } = require('../services/roi');
const mastersCsv = require('../services/mastersCsv');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const now = () => new Date().toISOString();

// Sequential id generator. `h` is a query handle (global q, or a transaction handle so
// that ids stay unique for multiple inserts within one transaction).
async function genId(h, prefix, table) {
  const r = await h.get(`SELECT COUNT(*) AS c FROM ${table}`);
  return `${prefix}${String(Number(r.c) + 1).padStart(3, '0')}`;
}

// ---------- Countries ----------
router.get('/countries', ah(async (req, res) => res.json(await q.all('SELECT * FROM countries WHERE active = 1 ORDER BY name'))));

// ---------- Master data import / export (HO) ----------
function sendCsv(res, filename, text) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(text);
}
router.get('/masters/doctors/template', requireRole('ho'), (req, res) => sendCsv(res, 'doctors_template.csv', mastersCsv.doctorTemplate()));
router.get('/masters/chemists/template', requireRole('ho'), (req, res) => sendCsv(res, 'chemists_template.csv', mastersCsv.chemistTemplate()));
router.get('/masters/doctors/export', requireRole('ho'), ah(async (req, res) => sendCsv(res, 'doctors.csv', await mastersCsv.exportDoctors())));
router.get('/masters/chemists/export', requireRole('ho'), ah(async (req, res) => sendCsv(res, 'chemists.csv', await mastersCsv.exportChemists())));

function validationSummary(result) {
  return {
    totalRows: result.totalRows || 0,
    validCount: result.validRows.length,
    inserts: result.validRows.filter((r) => !r.isUpdate).length,
    updates: result.validRows.filter((r) => r.isUpdate).length,
    errorCount: result.errors.length,
    errors: result.errors.slice(0, 200),
    warnings: result.warnings.slice(0, 200),
    preview: result.validRows.slice(0, 50),
  };
}

router.post('/masters/doctors/validate', requireRole('ho'), ah(async (req, res) => {
  if (!req.body?.csvText) return res.status(400).json({ error: 'csvText is required' });
  res.json(validationSummary(await mastersCsv.validateDoctors(req.body.csvText)));
}));
router.post('/masters/chemists/validate', requireRole('ho'), ah(async (req, res) => {
  if (!req.body?.csvText) return res.status(400).json({ error: 'csvText is required' });
  res.json(validationSummary(await mastersCsv.validateChemists(req.body.csvText)));
}));

router.post('/masters/doctors/import', requireRole('ho'), ah(async (req, res) => {
  const result = await mastersCsv.validateDoctors(req.body?.csvText || '');
  if (result.errors.length) return res.status(400).json({ error: `File has ${result.errors.length} error(s); fix and retry`, errors: result.errors.slice(0, 50) });
  if (!result.validRows.length) return res.status(400).json({ error: 'No valid rows to import' });

  let inserted = 0, updated = 0;
  await q.tx(async (t) => {
    for (const r of result.validRows) {
      if (r.isUpdate) {
        await t.run(`UPDATE hcps SET name=?, speciality=?, qualification=?, clinic=?, city=?, territory=?, rep_id=?, class=?, category=?, country=?, registration_no=?, contact=? WHERE id=?`,
          [r.name, r.speciality, r.qualification, r.clinic, r.city, r.country, r.repId, r.class, r.category, r.country, r.registrationNo, r.contact, r.id]);
        updated++;
      } else {
        const id = r.id || await genId(t, 'HCP', 'hcps');
        await t.run(`INSERT INTO hcps (id,name,speciality,qualification,clinic,city,territory,rep_id,class,category,country,registration_no,contact,verified,mkt_verified,created_by,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?)`,
          [id, r.name, r.speciality, r.qualification, r.clinic, r.city, r.country, r.repId, r.class, r.category, r.country, r.registrationNo, r.contact, req.user.id, now()]);
        r.id = id; inserted++;
      }
      for (const chemId of r.chemistIds) await t.run('INSERT OR IGNORE INTO hcp_chemist_map (hcp_id, chemist_id) VALUES (?,?)', [r.id, chemId]);
    }
  });
  await audit(req, 'masters.import_doctors', 'hcp', null, null, { inserted, updated });
  res.json({ inserted, updated, warnings: result.warnings.slice(0, 50) });
}));

router.post('/masters/chemists/import', requireRole('ho'), ah(async (req, res) => {
  const result = await mastersCsv.validateChemists(req.body?.csvText || '');
  if (result.errors.length) return res.status(400).json({ error: `File has ${result.errors.length} error(s); fix and retry`, errors: result.errors.slice(0, 50) });
  if (!result.validRows.length) return res.status(400).json({ error: 'No valid rows to import' });

  let inserted = 0, updated = 0;
  await q.tx(async (t) => {
    for (const r of result.validRows) {
      if (r.isUpdate) {
        await t.run(`UPDATE chemists SET name=?, type=?, address=?, city=?, rep_id=?, country=?, is_hospital_in_house=? WHERE id=?`,
          [r.name, r.type, r.address, r.city, r.repId, r.country, r.isHospitalInHouse, r.id]);
        updated++;
      } else {
        const id = r.id || await genId(t, 'CHEM', 'chemists');
        await t.run(`INSERT INTO chemists (id,name,type,address,city,rep_id,country,is_hospital_in_house,verified,mkt_verified) VALUES (?,?,?,?,?,?,?,?,1,1)`,
          [id, r.name, r.type, r.address, r.city, r.repId, r.country, r.isHospitalInHouse]);
        inserted++;
      }
    }
  });
  await audit(req, 'masters.import_chemists', 'chemist', null, null, { inserted, updated });
  res.json({ inserted, updated, warnings: result.warnings.slice(0, 50) });
}));

// ---------- HCPs ----------
router.get('/hcps', ah(async (req, res) => {
  const params = [];
  let where = 'WHERE active = 1';
  if (req.user.role === 'sales') { where += ' AND rep_id = ?'; params.push(req.user.id); }
  if (req.query.q) { where += ' AND (name LIKE ? OR id LIKE ?)'; params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.speciality) { where += ' AND speciality = ?'; params.push(req.query.speciality); }
  if (req.query.verified !== undefined) { where += ' AND verified = ?'; params.push(Number(req.query.verified)); }
  res.json(await q.all(`SELECT * FROM hcps ${where} ORDER BY name`, params));
}));

router.get('/hcps/:id/profile', ah(async (req, res) => {
  const profile = await doctorProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: 'HCP not found' });
  if (req.user.role === 'sales' && profile.hcp.rep_id !== req.user.id) return res.status(403).json({ error: 'Not in your territory' });
  res.json(profile);
}));

router.post('/hcps', requireRole('ho'), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name is required' });
  const id = b.id || await genId(q, 'HCP', 'hcps');
  await q.run(
    `INSERT INTO hcps (id,name,qualification,speciality,clinic,address,city,territory,rep_id,class,category,registration_no,contact,verified,mkt_verified,created_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?)`,
    [id, b.name, b.qualification || '', b.speciality || '', b.clinic || '', b.address || '', b.city || '',
     b.territory || '', b.repId || null, b.class || 'Ruby', b.category || 'B', b.registrationNo || '', b.contact || '', req.user.id, now()]
  );
  for (const chemId of Array.isArray(b.chemistIds) ? b.chemistIds : []) {
    await q.run('INSERT OR IGNORE INTO hcp_chemist_map (hcp_id, chemist_id) VALUES (?,?)', [id, chemId]);
  }
  await audit(req, 'hcp.create', 'hcp', id, null, b);
  res.json({ id });
}));

router.post('/hcps/adhoc', requireRole('sales'), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name is required' });
  if (!b.reason || !String(b.reason).trim()) return res.status(400).json({ error: 'A reason for adding this doctor is required' });
  const id = await genId(q, 'HCP', 'hcps');
  await q.run(
    `INSERT INTO hcps (id,name,speciality,clinic,address,city,territory,rep_id,class,category,verified,add_reason,created_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?)`,
    [id, b.name, b.speciality || '', b.clinic || '', b.address || '', b.city || '',
     req.user.territory, req.user.id, b.class || 'Pearl', b.category || 'C', String(b.reason).trim(), req.user.id, now()]
  );
  for (const chemId of Array.isArray(b.chemistIds) ? b.chemistIds : []) {
    await q.run('INSERT OR IGNORE INTO hcp_chemist_map (hcp_id, chemist_id) VALUES (?,?)', [id, chemId]);
  }
  await audit(req, 'hcp.adhoc_create', 'hcp', id, null, b);
  res.json({ id, verified: 0 });
}));

router.put('/hcps/:id', requireRole('ho'), ah(async (req, res) => {
  const before = await q.get('SELECT * FROM hcps WHERE id = ?', [req.params.id]);
  if (!before) return res.status(404).json({ error: 'HCP not found' });
  const b = req.body || {};
  await q.run(
    `UPDATE hcps SET name=?, qualification=?, speciality=?, clinic=?, city=?, territory=?, rep_id=?, class=?, category=?, active=? WHERE id=?`,
    [b.name ?? before.name, b.qualification ?? before.qualification, b.speciality ?? before.speciality,
     b.clinic ?? before.clinic, b.city ?? before.city, b.territory ?? before.territory,
     b.repId ?? before.rep_id, b.class ?? before.class, b.category ?? before.category,
     b.active ?? before.active, req.params.id]
  );
  await audit(req, 'hcp.update', 'hcp', req.params.id, before, b);
  res.json({ ok: true });
}));

// ---------- Chemists ----------
router.get('/chemists', ah(async (req, res) => {
  const params = [];
  let where = 'WHERE active = 1';
  if (req.user.role === 'sales') { where += ' AND rep_id = ?'; params.push(req.user.id); }
  res.json(await q.all(`SELECT * FROM chemists ${where} ORDER BY name`, params));
}));

router.get('/chemists/:id/profile', ah(async (req, res) => {
  const profile = await chemistProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Chemist not found' });
  if (req.user.role === 'sales' && profile.chemist.rep_id !== req.user.id) return res.status(403).json({ error: 'Not in your territory' });
  res.json(profile);
}));

router.post('/chemists', requireRole('ho'), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name is required' });
  const id = b.id || await genId(q, 'CHEM', 'chemists');
  await q.run(`INSERT INTO chemists (id,name,address,city,rep_id,is_hospital_in_house,type,verified,mkt_verified) VALUES (?,?,?,?,?,?,?,1,1)`,
    [id, b.name, b.address || '', b.city || '', b.repId || null, b.isHospitalInHouse ? 1 : 0, b.type || 'Retail']);
  await audit(req, 'chemist.create', 'chemist', id, null, b);
  res.json({ id });
}));

router.post('/chemists/adhoc', requireRole('sales'), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name is required' });
  if (!b.reason || !String(b.reason).trim()) return res.status(400).json({ error: 'A reason for adding this chemist is required' });
  const id = await genId(q, 'CHEM', 'chemists');
  await q.run(`INSERT INTO chemists (id,name,address,city,rep_id,is_hospital_in_house,type,verified,add_reason) VALUES (?,?,?,?,?,?,?,0,?)`,
    [id, b.name, b.address || '', b.city || '', req.user.id, b.isHospitalInHouse ? 1 : 0, b.type || 'Retail', String(b.reason).trim()]);
  await audit(req, 'chemist.adhoc_create', 'chemist', id, null, b);
  res.json({ id, verified: 0 });
}));

// ---------- Brands & products ----------
router.get('/brands', ah(async (req, res) => res.json(await q.all('SELECT * FROM brands WHERE active = 1 ORDER BY name'))));
router.post('/brands', requireRole('ho'), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name is required' });
  const id = b.id || await genId(q, 'BR', 'brands');
  await q.run('INSERT INTO brands (id,name,therapy_area) VALUES (?,?,?)', [id, b.name, b.therapyArea || '']);
  await audit(req, 'brand.create', 'brand', id, null, b);
  res.json({ id });
}));

router.get('/products', ah(async (req, res) => {
  const products = await q.all(`SELECT p.*, b.name AS brand_name FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.active = 1 ORDER BY p.name`);
  const prices = await q.all(`SELECT pp.*, c.currency_code, c.name AS country_name FROM product_prices pp
                        LEFT JOIN countries c ON c.code = pp.country_code WHERE pp.active = 1`);
  const byProduct = {};
  prices.forEach((p) => { (byProduct[p.product_id] = byProduct[p.product_id] || []).push(p); });
  products.forEach((p) => { p.prices = byProduct[p.id] || []; });
  res.json(products);
}));

async function setPrices(productId, prices) {
  await q.run('DELETE FROM product_prices WHERE product_id = ?', [productId]);
  for (const pr of Array.isArray(prices) ? prices : []) {
    const ptr = Number(pr.ptr);
    if (!pr.country || !Number.isFinite(ptr) || ptr <= 0) continue;
    await q.run('INSERT OR REPLACE INTO product_prices (product_id,country_code,ptr,active) VALUES (?,?,?,1)', [productId, pr.country, ptr]);
  }
}

router.post('/products', requireRole('ho'), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.brandId) return res.status(400).json({ error: 'Name and brandId are required' });
  const id = b.id || await genId(q, 'PR', 'products');
  await q.run('INSERT INTO products (id,brand_id,name,pack,sku,unit_price) VALUES (?,?,?,?,?,0)', [id, b.brandId, b.name, b.pack || '', b.sku || '']);
  await setPrices(id, b.prices);
  await audit(req, 'product.create', 'product', id, null, b);
  res.json({ id });
}));

router.put('/products/:id/prices', requireRole('ho'), ah(async (req, res) => {
  const prod = await q.get('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!prod) return res.status(404).json({ error: 'Product not found' });
  await setPrices(req.params.id, req.body?.prices);
  await audit(req, 'product.set_prices', 'product', req.params.id, null, { prices: (req.body?.prices || []).length });
  res.json({ ok: true });
}));

router.get('/activity-types', ah(async (req, res) => res.json(await q.all('SELECT * FROM activity_types ORDER BY name'))));

// ---------- Users (admin) ----------
router.get('/users', requireAdmin, ah(async (req, res) => {
  res.json(await q.all('SELECT id,name,email,role,sub_role,territory,region,country,active FROM users ORDER BY id'));
}));
router.post('/users', requireAdmin, ah(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.email || !b.role) return res.status(400).json({ error: 'name, email, role are required' });
  if (!['sales', 'clm', 'cm', 'ho'].includes(b.role)) return res.status(400).json({ error: 'invalid role' });
  // A field rep (SER) and a Cluster Lead (CLM) are scoped to a country — require one.
  if (['sales', 'clm'].includes(b.role) && !b.country) return res.status(400).json({ error: 'country is required for SER and CLM' });
  const prefix = { sales: 'EMP0', clm: 'CLM0', cm: 'CM0', ho: 'HO0' }[b.role] || 'USR0';
  const id = b.id || await genId(q, prefix, 'users');
  const password = b.password || 'welcome123';
  await q.run(`INSERT INTO users (id,name,email,password_hash,role,sub_role,territory,region,country) VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, b.name, String(b.email).toLowerCase(), bcrypt.hashSync(password, 10), b.role, b.subRole || '', b.territory || '', b.region || 'East Africa Pool', b.country || null]);
  await audit(req, 'user.create', 'user', id, null, { ...b, password: undefined });
  res.json({ id, initialPassword: password });
}));
router.put('/users/:id', requireAdmin, ah(async (req, res) => {
  const before = await q.get('SELECT id,name,email,role,sub_role,territory,active FROM users WHERE id = ?', [req.params.id]);
  if (!before) return res.status(404).json({ error: 'User not found' });
  const b = req.body || {};
  await q.run('UPDATE users SET name=?, role=?, sub_role=?, territory=?, active=? WHERE id=?',
    [b.name ?? before.name, b.role ?? before.role, b.subRole ?? before.sub_role,
     b.territory ?? before.territory, b.active ?? before.active, req.params.id]);
  if (b.resetPassword) {
    await q.run('UPDATE users SET password_hash=? WHERE id=?', [bcrypt.hashSync(String(b.resetPassword), 10), req.params.id]);
  }
  await audit(req, 'user.update', 'user', req.params.id, before, { ...b, resetPassword: b.resetPassword ? '***' : undefined });
  res.json({ ok: true });
}));

// ---------- Doctor <-> Chemist mappings ----------
router.get('/mappings', ah(async (req, res) => {
  if (req.user.role === 'sales') {
    return res.json(await q.all(`SELECT m.* FROM hcp_chemist_map m JOIN hcps h ON h.id = m.hcp_id WHERE h.rep_id = ?`, [req.user.id]));
  }
  res.json(await q.all('SELECT * FROM hcp_chemist_map'));
}));
router.post('/mappings', ah(async (req, res) => {
  const { hcpId, chemistId } = req.body || {};
  if (!hcpId || !chemistId) return res.status(400).json({ error: 'hcpId and chemistId required' });
  const hcp = await q.get('SELECT * FROM hcps WHERE id = ?', [hcpId]);
  if (!hcp) return res.status(404).json({ error: 'HCP not found' });
  if (req.user.role === 'sales' && hcp.rep_id !== req.user.id) return res.status(403).json({ error: 'Not your territory' });
  await q.run('INSERT OR IGNORE INTO hcp_chemist_map (hcp_id, chemist_id) VALUES (?,?)', [hcpId, chemistId]);
  await audit(req, 'mapping.add', 'mapping', `${hcpId}:${chemistId}`);
  res.json({ ok: true });
}));
router.delete('/mappings', ah(async (req, res) => {
  const { hcpId, chemistId } = req.query;
  const hcp = await q.get('SELECT * FROM hcps WHERE id = ?', [hcpId]);
  if (!hcp) return res.status(404).json({ error: 'HCP not found' });
  if (req.user.role === 'sales' && hcp.rep_id !== req.user.id) return res.status(403).json({ error: 'Not your territory' });
  await q.run('DELETE FROM hcp_chemist_map WHERE hcp_id = ? AND chemist_id = ?', [hcpId, chemistId]);
  await audit(req, 'mapping.remove', 'mapping', `${hcpId}:${chemistId}`);
  res.json({ ok: true });
}));

// ---------- Field-account verification (HO) ----------
// A sales rep can request removal of one of their accounts, with a mandatory reason.
router.post('/verification/request-removal', requireRole('sales'), ah(async (req, res) => {
  const { type, id, reason } = req.body || {};
  if (!['hcp', 'chemist'].includes(type)) return res.status(400).json({ error: 'type must be hcp|chemist' });
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'A reason for removal is required' });
  const table = type === 'hcp' ? 'hcps' : 'chemists';
  const rec = await q.get(`SELECT * FROM ${table} WHERE id = ? AND active = 1`, [id]);
  if (!rec) return res.status(404).json({ error: 'Account not found' });
  if (rec.rep_id !== req.user.id) return res.status(403).json({ error: 'Not your account' });
  if (rec.pending_removal) return res.status(409).json({ error: 'Removal already requested' });
  await q.run(`UPDATE ${table} SET pending_removal = 1, removal_reason = ?, removal_clm_ok = 0, removal_cm_ok = 0, removal_mkt_ok = 0, removal_mkt_note = NULL WHERE id = ?`, [String(reason).trim(), id]);
  await audit(req, `${type}.request_removal`, type, id, null, { reason: String(reason).trim() });
  await notifyStage('clm', rec.country, `${req.user.name} requested removal of ${rec.name} — awaiting your approval`, type, id);
  res.json({ ok: true });
}));

router.get('/verification/pending', ah(async (req, res) => {
  const stage = stageForUser(req.user);
  const empty = { stage: null, adds: { hcps: [], chemists: [] }, removals: { hcps: [], chemists: [] } };
  if (!['clm', 'cm', 'marketing', 'admin'].includes(stage)) return res.json(empty);
  // Own stage plus any vacant lower stage this user now covers (escalation), country-aware.
  const add = verifyPendingCondition(req.user, ADD_FLAG);
  const rem = verifyPendingCondition(req.user, REM_FLAG);
  res.json({
    stage,
    adds: {
      hcps: await q.all(`SELECT * FROM hcps WHERE ${add.sql} AND active=1`, add.params),
      chemists: await q.all(`SELECT * FROM chemists WHERE ${add.sql} AND active=1`, add.params),
    },
    removals: {
      hcps: await q.all(`SELECT * FROM hcps WHERE ${rem.sql} AND active=1`, rem.params),
      chemists: await q.all(`SELECT * FROM chemists WHERE ${rem.sql} AND active=1`, rem.params),
    },
  });
}));

router.post('/verification/decide', ah(async (req, res) => {
  const { type, id, action, mergeTargetId, note } = req.body || {};
  if (!['hcp', 'chemist'].includes(type)) return res.status(400).json({ error: 'type must be hcp|chemist' });
  const table = type === 'hcp' ? 'hcps' : 'chemists';
  const rec = await q.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!rec) return res.status(404).json({ error: 'Account not found' });
  if (!stageForUser(req.user)) return res.status(403).json({ error: 'Only CLM, CM, Marketing or Admin can verify field accounts' });

  const isRemoval = !!rec.pending_removal;
  const curStage = isRemoval ? removalStage(rec) : addStage(rec);
  const hasNote = note && String(note).trim();

  if (action === 'approve') {
    if (!(await canActResolved(q, req.user, CHAINS.verify, curStage, rec.country))) {
      return res.status(403).json({ error: `Awaiting ${STAGE_LABEL[curStage] || curStage} approval` });
    }
    if (isRemoval) {
      if (curStage === 'clm') await q.run(`UPDATE ${table} SET removal_clm_ok=1 WHERE id=?`, [id]);
      else if (curStage === 'cm') await q.run(`UPDATE ${table} SET removal_cm_ok=1 WHERE id=?`, [id]);
      else if (curStage === 'marketing') {
        if (!hasNote) return res.status(400).json({ error: 'Please add a comment before sending to Admin' });
        await q.run(`UPDATE ${table} SET removal_mkt_ok=1, removal_mkt_note=? WHERE id=?`, [String(note).trim(), id]);
      } else {
        await q.run(`UPDATE ${table} SET active=0, pending_removal=0 WHERE id=?`, [id]);
        await audit(req, `${type}.removal_admin`, type, id, rec, { active: 0 });
        if (rec.rep_id) await notify(rec.rep_id, 'removed', `${rec.name} was removed from the master list`, type, id);
        return res.json({ ok: true, kind: 'removal', final: true });
      }
      const next = nextStage(CHAINS.verify, curStage);
      await audit(req, `${type}.removal_${curStage}`, type, id, rec, { advancedTo: next });
      await notifyStage(next, rec.country, `Removal of ${rec.name} cleared ${STAGE_LABEL[curStage]} — awaiting your approval`, type, id);
      return res.json({ ok: true, kind: 'removal', stage: curStage, next });
    }
    // ----- Addition -----
    if (curStage === 'clm') await q.run(`UPDATE ${table} SET clm_ok=1 WHERE id=?`, [id]);
    else if (curStage === 'cm') await q.run(`UPDATE ${table} SET cm_ok=1 WHERE id=?`, [id]);
    else if (curStage === 'marketing') {
      if (!hasNote) return res.status(400).json({ error: 'Please add a comment before sending to Admin' });
      await q.run(`UPDATE ${table} SET mkt_verified=1, mkt_note=? WHERE id=?`, [String(note).trim(), id]);
    } else {
      await q.run(`UPDATE ${table} SET verified=1 WHERE id=?`, [id]);
      await audit(req, `${type}.verify_admin`, type, id, rec, { verified: 1 });
      if (rec.rep_id || rec.created_by) await notify(rec.rep_id || rec.created_by, 'verified', `${rec.name} is now fully verified in the master list`, type, id);
      return res.json({ ok: true, kind: 'add', final: true });
    }
    const next = nextStage(CHAINS.verify, curStage);
    await audit(req, `${type}.verify_${curStage}`, type, id, rec, { advancedTo: next });
    await notifyStage(next, rec.country, `${rec.name} cleared ${STAGE_LABEL[curStage]} — awaiting your approval`, type, id);
    return res.json({ ok: true, kind: 'add', stage: curStage, next });
  }

  if (action === 'merge') {
    if (!(await canActResolved(q, req.user, CHAINS.verify, curStage, rec.country))) return res.status(403).json({ error: `Awaiting ${STAGE_LABEL[curStage] || curStage} approval` });
    const target = await q.get(`SELECT * FROM ${table} WHERE id = ?`, [mergeTargetId]);
    if (!target) return res.status(404).json({ error: 'Merge target not found' });
    const col = type === 'hcp' ? 'hcp_id' : 'chemist_id';
    await q.tx(async (t) => {
      await t.run(`INSERT OR IGNORE INTO hcp_chemist_map (hcp_id, chemist_id)
             SELECT ${type === 'hcp' ? '?, chemist_id' : 'hcp_id, ?'} FROM hcp_chemist_map WHERE ${col} = ?`, [mergeTargetId, id]);
      await t.run(`DELETE FROM hcp_chemist_map WHERE ${col} = ?`, [id]);
      await t.run(`UPDATE OR IGNORE activity_participants SET account_id = ? WHERE account_id = ? AND account_type = ?`, [mergeTargetId, id, type]);
      await t.run(`DELETE FROM activity_participants WHERE account_id = ? AND account_type = ?`, [id, type]);
      await t.run(`UPDATE sales_data SET ${col} = ? WHERE ${col} = ?`, [mergeTargetId, id]);
      await t.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
    });
    await audit(req, `${type}.verify_merge`, type, id, rec, { mergedInto: mergeTargetId });
    if (rec.rep_id || rec.created_by) await notify(rec.rep_id || rec.created_by, 'merged', `${rec.name} was merged into ${target.name}`, type, mergeTargetId);
    return res.json({ ok: true });
  }

  res.status(400).json({ error: 'action must be approve|merge' });
}));

module.exports = router;
