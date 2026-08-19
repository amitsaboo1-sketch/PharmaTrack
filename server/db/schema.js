// Full schema as one SQL script (portable SQLite / libSQL). Run once via executeMultiple.
// A fresh Turso/libSQL database gets the complete, final schema directly.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('sales','ho','clm','cm')), sub_role TEXT NOT NULL,
  territory TEXT, region TEXT, country TEXT, manager_id TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS hcps (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, qualification TEXT, speciality TEXT, clinic TEXT, address TEXT,
  city TEXT, territory TEXT, rep_id TEXT, class TEXT DEFAULT 'Ruby', category TEXT DEFAULT 'B',
  potential_score INTEGER DEFAULT 5, registration_no TEXT, contact TEXT, country TEXT,
  verified INTEGER DEFAULT 1, mkt_verified INTEGER DEFAULT 0, active INTEGER DEFAULT 1, created_by TEXT, created_at TEXT,
  add_reason TEXT, mkt_note TEXT, pending_removal INTEGER DEFAULT 0, removal_reason TEXT, removal_mkt_note TEXT, removal_mkt_ok INTEGER DEFAULT 0,
  clm_ok INTEGER DEFAULT 0, cm_ok INTEGER DEFAULT 0, removal_clm_ok INTEGER DEFAULT 0, removal_cm_ok INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chemists (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT, city TEXT, rep_id TEXT,
  is_hospital_in_house INTEGER DEFAULT 0, type TEXT DEFAULT 'Retail', country TEXT,
  verified INTEGER DEFAULT 1, mkt_verified INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
  add_reason TEXT, mkt_note TEXT, pending_removal INTEGER DEFAULT 0, removal_reason TEXT, removal_mkt_note TEXT, removal_mkt_ok INTEGER DEFAULT 0,
  clm_ok INTEGER DEFAULT 0, cm_ok INTEGER DEFAULT 0, removal_clm_ok INTEGER DEFAULT 0, removal_cm_ok INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS hcp_chemist_map (
  hcp_id TEXT NOT NULL, chemist_id TEXT NOT NULL, weight REAL DEFAULT 1.0, PRIMARY KEY (hcp_id, chemist_id)
);
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, therapy_area TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, name TEXT NOT NULL, pack TEXT, sku TEXT,
  unit_price REAL DEFAULT 0, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS product_prices (
  product_id TEXT NOT NULL, country_code TEXT NOT NULL, ptr REAL DEFAULT 0, active INTEGER DEFAULT 1,
  PRIMARY KEY (product_id, country_code)
);
CREATE TABLE IF NOT EXISTS activity_types (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, default_budget_cap REAL DEFAULT 0, requires_attendance INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, objective TEXT, remarks TEXT, type_id TEXT NOT NULL,
  brand_id TEXT, product_id TEXT, proposed_by TEXT NOT NULL, territory TEXT, planned_date TEXT, venue TEXT,
  estimated_cost REAL DEFAULT 0, expected_hcp_count INTEGER DEFAULT 0, expected_sales REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','returned','rejected','executed','closed')),
  decided_by TEXT, decided_at TEXT, decision_remarks TEXT, actual_date TEXT, actual_venue TEXT,
  actual_cost REAL, completion_remarks TEXT, created_at TEXT, updated_at TEXT,
  approval_stage TEXT, country TEXT
);
CREATE TABLE IF NOT EXISTS activity_participants (
  activity_id TEXT NOT NULL, account_id TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('hcp','chemist')),
  proposed INTEGER DEFAULT 0, invited INTEGER DEFAULT 0, attended INTEGER DEFAULT 0, remarks TEXT,
  PRIMARY KEY (activity_id, account_id, account_type)
);
CREATE TABLE IF NOT EXISTS expense_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, activity_id TEXT NOT NULL, category TEXT NOT NULL,
  amount REAL NOT NULL, vendor TEXT, invoice_no TEXT
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, activity_id TEXT NOT NULL, kind TEXT DEFAULT 'other',
  filename TEXT NOT NULL, mime TEXT, data_url TEXT, uploaded_by TEXT, uploaded_at TEXT
);
CREATE TABLE IF NOT EXISTS activity_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, activity_id TEXT NOT NULL, author_id TEXT, author_name TEXT,
  author_role TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actcomment ON activity_comments(activity_id);
CREATE TABLE IF NOT EXISTS sales_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uploaded_by TEXT NOT NULL, uploaded_at TEXT NOT NULL, filename TEXT,
  month TEXT, row_count INTEGER DEFAULT 0, status TEXT DEFAULT 'committed' CHECK (status IN ('committed','rolled_back'))
);
CREATE TABLE IF NOT EXISTS sales_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, month TEXT NOT NULL, employee_id TEXT,
  hcp_id TEXT, chemist_id TEXT, brand_id TEXT, product_id TEXT, quantity REAL DEFAULT 0, sales_value REAL NOT NULL,
  prescription_count INTEGER DEFAULT 0, source TEXT, remarks TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_month ON sales_data(month);
CREATE INDEX IF NOT EXISTS idx_sales_hcp ON sales_data(hcp_id, month);
CREATE INDEX IF NOT EXISTS idx_sales_chemist ON sales_data(chemist_id, month);
CREATE INDEX IF NOT EXISTS idx_sales_batch ON sales_data(batch_id);
CREATE TABLE IF NOT EXISTS rep_targets (
  rep_id TEXT NOT NULL, month TEXT NOT NULL, target REAL DEFAULT 0, achieved REAL DEFAULT 0, PRIMARY KEY (rep_id, month)
);
CREATE TABLE IF NOT EXISTS roi_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, scope_id TEXT NOT NULL, model TEXT NOT NULL,
  window_months INTEGER NOT NULL, computed_at TEXT NOT NULL, cost REAL, baseline_sales REAL, post_sales REAL,
  incremental REAL, roi_pct REAL, details TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, type TEXT NOT NULL, message TEXT NOT NULL,
  entity_type TEXT, entity_id TEXT, read INTEGER DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL,
  entity_type TEXT, entity_id TEXT, before_json TEXT, after_json TEXT, ip TEXT
);
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS countries (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, currency_code TEXT NOT NULL, currency_symbol TEXT NOT NULL,
  region TEXT DEFAULT 'East Africa Pool', active INTEGER DEFAULT 1,
  usd_rate REAL DEFAULT 1   -- local-currency units per 1 US$, for cross-country roll-ups
);
CREATE TABLE IF NOT EXISTS country_targets (
  country_code TEXT NOT NULL, month TEXT NOT NULL, brand_id TEXT NOT NULL,
  target_units REAL DEFAULT 0, target_value REAL DEFAULT 0, PRIMARY KEY (country_code, month, brand_id)
);
CREATE TABLE IF NOT EXISTS daily_allowances (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, country_code TEXT, currency_code TEXT,
  da_date TEXT NOT NULL, location TEXT, purpose TEXT, da_amount REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft','submitted','approved','rejected')),
  remarks TEXT, decided_by TEXT, decided_at TEXT, created_at TEXT NOT NULL, approval_stage TEXT
);
CREATE TABLE IF NOT EXISTS da_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, da_id INTEGER NOT NULL, category TEXT, amount REAL DEFAULT 0,
  filename TEXT, mime TEXT, data_url TEXT, uploaded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_da_user ON daily_allowances(user_id);
CREATE INDEX IF NOT EXISTS idx_da_att ON da_attachments(da_id);
CREATE INDEX IF NOT EXISTS idx_ctarget ON country_targets(country_code, month);
`;

module.exports = { SCHEMA_SQL };
