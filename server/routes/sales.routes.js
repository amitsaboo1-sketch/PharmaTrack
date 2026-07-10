const express = require('express');
const { q } = require('../db/connection');
const { requireRole } = require('../middleware/auth');
const { audit, notifyHO } = require('../middleware/audit');
const { templateCSV, validateSalesCSV } = require('../services/csv');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/template', requireRole('ho'), (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sales_template.csv"');
  res.send(templateCSV());
});

router.post('/validate', requireRole('ho'), ah(async (req, res) => {
  const { csvText } = req.body || {};
  if (!csvText) return res.status(400).json({ error: 'csvText is required' });
  const result = await validateSalesCSV(csvText);
  res.json({
    totalRows: result.totalRows || 0,
    validCount: result.validRows.length,
    errorCount: result.errors.length,
    errors: result.errors.slice(0, 200),
    warnings: result.warnings.slice(0, 200),
    preview: result.validRows.slice(0, 50),
  });
}));

router.post('/commit', requireRole('ho'), ah(async (req, res) => {
  const { csvText, filename } = req.body || {};
  if (!csvText) return res.status(400).json({ error: 'csvText is required' });
  const result = await validateSalesCSV(csvText);
  if (result.errors.length) {
    return res.status(400).json({ error: `File has ${result.errors.length} validation error(s); fix and retry`, errors: result.errors.slice(0, 50) });
  }
  if (!result.validRows.length) return res.status(400).json({ error: 'No valid rows to import' });

  const months = [...new Set(result.validRows.map((r) => r.month))].sort();
  const batchId = await q.tx(async (t) => {
    const ins = await t.run(`INSERT INTO sales_batches (uploaded_by,uploaded_at,filename,month,row_count,status) VALUES (?,?,?,?,?,'committed')`,
      [req.user.id, new Date().toISOString(), filename || 'upload.csv', months.join(','), result.validRows.length]);
    const id = ins.lastID;
    for (const r of result.validRows) {
      await t.run(`INSERT INTO sales_data (batch_id,month,employee_id,hcp_id,chemist_id,brand_id,product_id,quantity,sales_value,prescription_count,source,remarks)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, r.month, r.employee_id, r.hcp_id, r.chemist_id, r.brand_id, r.product_id, r.quantity, r.sales_value, r.prescription_count, r.source, r.remarks]);
    }
    return id;
  });

  await audit(req, 'sales.commit', 'sales_batch', batchId, null, { rows: result.validRows.length, months });
  await notifyHO('csv_committed', `${req.user.name} imported ${result.validRows.length} sales rows (${months.join(', ')})`, 'sales_batch', batchId);
  res.json({ batchId, rows: result.validRows.length, warnings: result.warnings.slice(0, 50) });
}));

router.get('/batches', requireRole('ho'), ah(async (req, res) => {
  res.json(await q.all(
    `SELECT b.*, u.name AS uploader_name FROM sales_batches b LEFT JOIN users u ON u.id = b.uploaded_by ORDER BY b.id DESC`));
}));

router.post('/batches/:id/rollback', requireRole('ho'), ah(async (req, res) => {
  const batch = await q.get('SELECT * FROM sales_batches WHERE id = ?', [req.params.id]);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (batch.status === 'rolled_back') return res.status(409).json({ error: 'Batch already rolled back' });
  await q.tx(async (t) => {
    await t.run('DELETE FROM sales_data WHERE batch_id = ?', [batch.id]);
    await t.run(`UPDATE sales_batches SET status='rolled_back' WHERE id = ?`, [batch.id]);
  });
  await audit(req, 'sales.rollback', 'sales_batch', batch.id, batch, { status: 'rolled_back' });
  res.json({ ok: true });
}));

// Monthly totals for charts; sales users get their own book only.
router.get('/summary', ah(async (req, res) => {
  const params = [];
  let scope = '';
  if (req.user.role === 'sales') { scope = 'AND s.employee_id = ?'; params.push(req.user.id); }
  else if (req.query.repId) { scope = 'AND s.employee_id = ?'; params.push(req.query.repId); }
  res.json(await q.all(
    `SELECT s.month, SUM(s.sales_value) AS sales, SUM(s.prescription_count) AS rx, COUNT(*) AS rows
     FROM sales_data s JOIN sales_batches b ON b.id = s.batch_id AND b.status='committed'
     WHERE 1=1 ${scope} GROUP BY s.month ORDER BY s.month`, params));
}));

module.exports = router;
