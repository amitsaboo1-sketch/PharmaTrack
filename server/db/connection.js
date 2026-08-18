const { createClient } = require('@libsql/client');
const { DB_URL, DB_AUTH_TOKEN } = require('../config');
const { SCHEMA_SQL } = require('./schema');
const { seedIfEmpty, ensureManagementUsers } = require('./seed');

const client = createClient(DB_AUTH_TOKEN ? { url: DB_URL, authToken: DB_AUTH_TOKEN } : { url: DB_URL });

const norm = (params) => (params || []).map((v) => (v === undefined ? null : v));
const toRun = (r) => ({ changes: Number(r.rowsAffected || 0), lastID: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : undefined });

function handle(exec) {
  return {
    all: async (sql, params = []) => (await exec({ sql, args: norm(params) })).rows,
    get: async (sql, params = []) => (await exec({ sql, args: norm(params) })).rows[0],
    run: async (sql, params = []) => toRun(await exec({ sql, args: norm(params) })),
  };
}

// Async data layer (libSQL). q.get/all/run return promises; q.tx runs a callback inside a
// write transaction, passing a transaction-scoped handle (use it, not the global q, inside).
const base = handle((stmt) => client.execute(stmt));
const q = {
  ...base,
  batch: (stmts) => client.batch(stmts, 'write'),
  tx: async (fn) => {
    const t = await client.transaction('write');
    try {
      const out = await fn(handle((stmt) => t.execute(stmt)));
      await t.commit();
      return out;
    } catch (e) {
      try { await t.rollback(); } catch { /* ignore */ }
      throw e;
    }
  },
};

// Idempotent migrations for columns added after the initial schema (CREATE TABLE IF NOT
// EXISTS won't alter an existing table). Each ALTER throws once the column exists — caught.
async function migrate() {
  for (const tbl of ['hcps', 'chemists']) {
    try {
      await client.execute(`ALTER TABLE ${tbl} ADD COLUMN mkt_verified INTEGER DEFAULT 0`);
      // Column just added: anything already verified is treated as fully approved (both stages).
      await client.execute(`UPDATE ${tbl} SET mkt_verified = 1 WHERE verified = 1`);
    } catch { /* column already exists */ }
  }
  // Verification justification/removal columns (added later).
  const cols = [
    'add_reason TEXT', 'mkt_note TEXT', 'pending_removal INTEGER DEFAULT 0',
    'removal_reason TEXT', 'removal_mkt_note TEXT', 'removal_mkt_ok INTEGER DEFAULT 0',
    // CLM/CM stages prepended to the verification chain.
    'clm_ok INTEGER DEFAULT 0', 'cm_ok INTEGER DEFAULT 0', 'removal_clm_ok INTEGER DEFAULT 0', 'removal_cm_ok INTEGER DEFAULT 0',
  ];
  for (const tbl of ['hcps', 'chemists']) {
    for (const col of cols) {
      try { await client.execute(`ALTER TABLE ${tbl} ADD COLUMN ${col}`); } catch { /* exists */ }
    }
  }
  // Sequential-approval columns on activities + daily allowances.
  for (const col of ['approval_stage TEXT', 'country TEXT']) {
    try { await client.execute(`ALTER TABLE activities ADD COLUMN ${col}`); } catch { /* exists */ }
  }
  try { await client.execute(`ALTER TABLE daily_allowances ADD COLUMN approval_stage TEXT`); } catch { /* exists */ }

  // Relax users.role CHECK to allow clm/cm (SQLite can't ALTER a CHECK — recreate the table once).
  try {
    const info = await client.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
    const ddl = (info.rows[0] && info.rows[0].sql) || '';
    if (ddl.includes("role IN ('sales','ho')") && !ddl.includes("'clm'")) {
      await client.executeMultiple(`
CREATE TABLE users_new (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('sales','ho','clm','cm')), sub_role TEXT NOT NULL,
  territory TEXT, region TEXT, country TEXT, manager_id TEXT, active INTEGER DEFAULT 1
);
INSERT INTO users_new SELECT id,name,email,password_hash,role,sub_role,territory,region,country,manager_id,active FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
`);
    }
  } catch (e) { console.error('users role migration:', e && e.message); }

  // Backfill in-flight items into the new chain (front of the chain = CLM).
  try {
    await client.execute(`UPDATE activities SET approval_stage = 'clm' WHERE status = 'submitted' AND (approval_stage IS NULL OR approval_stage = '')`);
    await client.execute(`UPDATE activities SET country = (SELECT country FROM users u WHERE u.id = activities.proposed_by) WHERE country IS NULL OR country = ''`);
    await client.execute(`UPDATE daily_allowances SET approval_stage = 'clm' WHERE status = 'submitted' AND (approval_stage IS NULL OR approval_stage = '')`);
  } catch (e) { console.error('chain backfill:', e && e.message); }
}

// One-time schema + migrate + seed. Lazily initialized and cached so it runs once per process
// (works for a long-lived server and for serverless cold starts).
let initPromise = null;
function ready() {
  if (!initPromise) {
    initPromise = (async () => {
      await client.executeMultiple(SCHEMA_SQL);
      await migrate();
      await seedIfEmpty(q);
      // Runs on every boot (after migrate relaxed the role CHECK) so pre-existing
      // databases gain the CLM/CM users without a full reseed. No-op once present.
      await ensureManagementUsers(q);
    })().catch((err) => { initPromise = null; throw err; });
  }
  return initPromise;
}

module.exports = { client, q, ready };
