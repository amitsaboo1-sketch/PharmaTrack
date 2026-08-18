const { createClient } = require('@libsql/client');
const { DB_URL, DB_AUTH_TOKEN } = require('../config');
const { SCHEMA_SQL } = require('./schema');
const { seedIfEmpty } = require('./seed');

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
  ];
  for (const tbl of ['hcps', 'chemists']) {
    for (const col of cols) {
      try { await client.execute(`ALTER TABLE ${tbl} ADD COLUMN ${col}`); } catch { /* exists */ }
    }
  }
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
    })().catch((err) => { initPromise = null; throw err; });
  }
  return initPromise;
}

module.exports = { client, q, ready };
