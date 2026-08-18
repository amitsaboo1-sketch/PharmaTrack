const bcrypt = require('bcryptjs');

// East Africa pool demo. Fiscal year starts April. Sales history spans Apr 2025 – Jun 2026
// so the app can show last-FY, month-on-month and year-on-year comparisons. Kenya & Tanzania
// have two reps each to demonstrate account-wise ROI. All demo passwords: demo123.
// Async: builds one statement array and commits it as a single libSQL write batch.
async function seedIfEmpty(q) {
  const row = await q.get('SELECT COUNT(*) AS c FROM users');
  if (row && Number(row.c) > 0) return;

  const now = new Date().toISOString();
  const hash = bcrypt.hashSync('demo123', 10);

  const months = [];
  for (let i = 0; i < 15; i++) {
    const d = new Date(Date.UTC(2025, 3 + i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  const COUNTRIES = [
    ['KE', 'Kenya', 'KES', 'KSh', 'Nairobi', 130],
    ['UG', 'Uganda', 'UGX', 'USh', 'Kampala', 3700],
    ['TZ', 'Tanzania', 'TZS', 'TSh', 'Dar es Salaam', 2500],
    ['RW', 'Rwanda', 'RWF', 'FRw', 'Kigali', 1300],
    ['MU', 'Mauritius', 'MUR', 'Rs', 'Port Louis', 46],
    ['ZM', 'Zambia', 'ZMW', 'ZK', 'Lusaka', 27],
  ];
  const factorOf = Object.fromEntries(COUNTRIES.map((c) => [c[0], c[5]]));
  const BRANDS = [['BR01', 'Cardiozan', 'Cardiology', 3500, 300], ['BR02', 'Glucofine', 'Diabetology', 2500, 420], ['BR03', 'Oncovita', 'Oncology', 5000, 90]];
  const PRODUCT_OF = { BR01: 'PR01', BR02: 'PR03', BR03: 'PR04' };
  const baseUsdOf = Object.fromEntries(BRANDS.map((b) => [b[0], b[3]]));
  const baseUnitsOf = Object.fromEntries(BRANDS.map((b) => [b[0], b[4]]));

  const stmts = [];
  const add = (sql, rows) => rows.forEach((r) => stmts.push({ sql, args: r }));

  add(`INSERT INTO countries (code,name,currency_code,currency_symbol,region) VALUES (?,?,?,?, 'East Africa Pool')`,
    COUNTRIES.map((c) => [c[0], c[1], c[2], c[3]]));

  add(`INSERT INTO users (id,name,email,password_hash,role,sub_role,territory,region,country) VALUES (?,?,?,?,?,?,?,?,?)`, [
    ['EMP001', 'James Mwangi', 'kenya@pharmatrack.demo', hash, 'sales', 'Medical Representative', 'Kenya', 'East Africa Pool', 'KE'],
    ['EMP007', 'Alice Cherono', 'kenya2@pharmatrack.demo', hash, 'sales', 'Medical Representative', 'Kenya', 'East Africa Pool', 'KE'],
    ['EMP002', 'Sarah Nakato', 'uganda@pharmatrack.demo', hash, 'sales', 'Medical Representative', 'Uganda', 'East Africa Pool', 'UG'],
    ['EMP003', 'David Kimaro', 'tanzania@pharmatrack.demo', hash, 'sales', 'Medical Representative', 'Tanzania', 'East Africa Pool', 'TZ'],
    ['EMP008', 'Peter Mrema', 'tanzania2@pharmatrack.demo', hash, 'sales', 'Medical Representative', 'Tanzania', 'East Africa Pool', 'TZ'],
    ['EMP004', 'Grace Uwase', 'rwanda@pharmatrack.demo', hash, 'sales', 'Medical Representative', 'Rwanda', 'East Africa Pool', 'RW'],
    ['EMP005', 'Rajesh Ramgoolam', 'mauritius@pharmatrack.demo', hash, 'sales', 'Medical Representative', 'Mauritius', 'East Africa Pool', 'MU'],
    ['EMP006', 'Chanda Mulenga', 'zambia@pharmatrack.demo', hash, 'sales', 'Medical Representative', 'Zambia', 'East Africa Pool', 'ZM'],
    ['HO001', 'Amit Verma', 'amit@pharmatrack.demo', hash, 'ho', 'Product Manager', 'Head Office', 'East Africa Pool', null],
    ['HO002', 'Kavita Rao', 'kavita@pharmatrack.demo', hash, 'ho', 'Finance', 'Head Office', 'East Africa Pool', null],
    ['HO003', 'Suresh Nair', 'admin@pharmatrack.demo', hash, 'ho', 'Admin', 'Head Office', 'East Africa Pool', null],
  ]);

  add(`INSERT INTO brands (id,name,therapy_area) VALUES (?,?,?)`, BRANDS.map((b) => [b[0], b[1], b[2]]));
  add(`INSERT INTO products (id,brand_id,name,pack,sku,unit_price) VALUES (?,?,?,?,?,?)`, [
    ['PR01', 'BR01', 'Cardiozan 50mg', '10x10 Tab', 'CZ50', 12], ['PR02', 'BR01', 'Cardiozan 100mg', '10x10 Tab', 'CZ100', 20],
    ['PR03', 'BR02', 'Glucofine 500mg', '10x15 Tab', 'GF500', 8], ['PR04', 'BR03', 'Oncovita Inj', '1 Vial', 'OV1', 240],
    ['PR05', 'BR02', 'Glucofine XR', '10x10 Tab', 'GFXR', 11],
  ]);
  const productBase = { PR01: 12, PR02: 20, PR03: 8, PR04: 240, PR05: 11 };
  const prices = [];
  COUNTRIES.forEach((c) => Object.entries(productBase).forEach(([pid, base]) => prices.push([pid, c[0], Math.round(base * c[5])])));
  add(`INSERT OR IGNORE INTO product_prices (product_id,country_code,ptr,active) VALUES (?,?,?,1)`, prices);

  add(`INSERT INTO activity_types (id,name,default_budget_cap) VALUES (?,?,?)`, [
    ['CME', 'CME (Continuing Medical Education)', 0], ['RTM', 'Round Table Meeting', 0], ['GIFT', 'Doctor Gifting', 0],
    ['CAMP', 'Screening Camp', 0], ['LAUNCH', 'Product Launch Meeting', 0], ['CHEMPROMO', 'Chemist Promotion', 0],
    ['PERSONAL', 'Personalized Activity', 0], ['DIGITAL', 'Digital Campaign', 0], ['OTHER', 'Other Promotional Activity', 0],
  ]);

  add(`INSERT INTO hcps (id,name,qualification,speciality,clinic,city,territory,rep_id,class,category,country,verified,mkt_verified,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,1,'${now}')`, [
    ['HCP001', 'Dr. Otieno', 'MD', 'Cardiology', 'Otieno Heart Clinic', 'Nairobi', 'Kenya', 'EMP001', 'Diamond', 'A', 'KE'],
    ['HCP002', 'Dr. Wanjiku', 'MD', 'Oncology', 'Wanjiku Cancer Centre', 'Nairobi', 'Kenya', 'EMP007', 'Diamond', 'A', 'KE'],
    ['HCP003', 'Dr. Okello', 'MD', 'Cardiology', 'Okello Clinic', 'Kampala', 'Uganda', 'EMP002', 'Ruby', 'B', 'UG'],
    ['HCP004', 'Dr. Namutebi', 'MD', 'Diabetology', 'Namutebi Clinic', 'Kampala', 'Uganda', 'EMP002', 'Pearl', 'C', 'UG'],
    ['HCP005', 'Dr. Mushi', 'MD', 'Oncology', 'Mushi Oncology', 'Dar es Salaam', 'Tanzania', 'EMP003', 'Diamond', 'A', 'TZ'],
    ['HCP006', 'Dr. Kileo', 'MD', 'Diabetology', 'Kileo Clinic', 'Dar es Salaam', 'Tanzania', 'EMP008', 'Ruby', 'B', 'TZ'],
    ['HCP007', 'Dr. Habimana', 'MD', 'Cardiology', 'Habimana Clinic', 'Kigali', 'Rwanda', 'EMP004', 'Ruby', 'B', 'RW'],
    ['HCP008', 'Dr. Mukamana', 'MD', 'Oncology', 'Mukamana Clinic', 'Kigali', 'Rwanda', 'EMP004', 'Pearl', 'C', 'RW'],
    ['HCP009', 'Dr. Appadu', 'MD', 'Diabetology', 'Appadu Clinic', 'Port Louis', 'Mauritius', 'EMP005', 'Ruby', 'B', 'MU'],
    ['HCP010', 'Dr. Beeharry', 'MD', 'Cardiology', 'Beeharry Clinic', 'Port Louis', 'Mauritius', 'EMP005', 'Pearl', 'C', 'MU'],
    ['HCP011', 'Dr. Banda', 'MD', 'Oncology', 'Banda Clinic', 'Lusaka', 'Zambia', 'EMP006', 'Ruby', 'B', 'ZM'],
    ['HCP012', 'Dr. Phiri', 'MD', 'Diabetology', 'Phiri Clinic', 'Lusaka', 'Zambia', 'EMP006', 'Opal', 'C', 'ZM'],
  ]);

  const chemists = [
    ['CHEM001', 'Nairobi Central Pharmacy', 'Nairobi CBD', 'Nairobi', 'EMP001', 'Retail', 'KE'],
    ['CHEM002', 'Nairobi Westlands Wholesalers', 'Westlands', 'Nairobi', 'EMP001', 'Wholesaler', 'KE'],
    ['CHEM003', 'Nairobi Community Chemist', 'Kilimani', 'Nairobi', 'EMP007', 'Retail', 'KE'],
    ['CHEM004', 'Kampala Central Pharmacy', 'Kampala CBD', 'Kampala', 'EMP002', 'Retail', 'UG'],
    ['CHEM005', 'Kampala Distributors Ltd', 'Nakawa', 'Kampala', 'EMP002', 'Wholesaler', 'UG'],
    ['CHEM006', 'Dar Central Pharmacy', 'Dar CBD', 'Dar es Salaam', 'EMP003', 'Retail', 'TZ'],
    ['CHEM007', 'Dar Stockist & Supplies', 'Kariakoo', 'Dar es Salaam', 'EMP008', 'Stockist', 'TZ'],
    ['CHEM008', 'Kigali Central Pharmacy', 'Kigali CBD', 'Kigali', 'EMP004', 'Retail', 'RW'],
    ['CHEM009', 'Port Louis Central Pharmacy', 'Port Louis CBD', 'Port Louis', 'EMP005', 'Retail', 'MU'],
    ['CHEM010', 'Lusaka Central Pharmacy', 'Lusaka CBD', 'Lusaka', 'EMP006', 'Retail', 'ZM'],
  ];
  add(`INSERT INTO chemists (id,name,address,city,rep_id,is_hospital_in_house,type,country,verified,mkt_verified) VALUES (?,?,?,?,?,0,?,?,1,1)`, chemists);

  add(`INSERT INTO hcp_chemist_map (hcp_id,chemist_id) VALUES (?,?)`, [
    ['HCP001', 'CHEM001'], ['HCP001', 'CHEM002'], ['HCP002', 'CHEM003'],
    ['HCP003', 'CHEM004'], ['HCP003', 'CHEM005'], ['HCP004', 'CHEM004'],
    ['HCP005', 'CHEM006'], ['HCP006', 'CHEM007'],
    ['HCP007', 'CHEM008'], ['HCP008', 'CHEM008'],
    ['HCP009', 'CHEM009'], ['HCP010', 'CHEM009'],
    ['HCP011', 'CHEM010'], ['HCP012', 'CHEM010'],
  ]);

  const ctargets = [];
  COUNTRIES.forEach((c) => BRANDS.forEach((b) => months.forEach((m, mi) => {
    const growth = 1 + mi * 0.02;
    ctargets.push([c[0], m, b[0], Math.round(b[4] * growth), Math.round(b[3] * factorOf[c[0]] * growth)]);
  })));
  add(`INSERT INTO country_targets (country_code,month,brand_id,target_units,target_value) VALUES (?,?,?,?,?)`, ctargets);

  // committed sales at chemist level (batch id fixed to 1)
  const chemsByCountry = {};
  chemists.forEach((c) => { (chemsByCountry[c[6]] = chemsByCountry[c[6]] || []).push({ id: c[0], rep: c[4] }); });
  const lift = (code, chemId, brandId, mi) => {
    const m = months[mi];
    if (m < '2026-02') return 1;
    if (code === 'KE' && brandId === 'BR01' && (chemId === 'CHEM001' || chemId === 'CHEM002')) return 1.32;
    if (code === 'KE' && brandId === 'BR03' && chemId === 'CHEM003') return 1.28;
    if (code === 'TZ' && brandId === 'BR03' && chemId === 'CHEM006') return 1.30;
    if (code === 'UG' && brandId === 'BR02' && chemId === 'CHEM005') return 1.27;
    return 1;
  };
  const salesRows = [];
  COUNTRIES.forEach((c, ci) => {
    const code = c[0]; const factor = c[5];
    const chems = chemsByCountry[code];
    BRANDS.forEach((b) => {
      const bid = b[0];
      months.forEach((m, mi) => {
        const growth = 1 + mi * 0.02;
        const wobble = 0.9 + ((ci + mi + bid.length) % 5) * 0.035;
        const countryValue = baseUsdOf[bid] * factor * growth * wobble;
        const countryUnits = baseUnitsOf[bid] * growth * wobble;
        chems.forEach((ch) => {
          const f = lift(code, ch.id, bid, mi);
          const value = Math.round((countryValue / chems.length) * f);
          const units = Math.round((countryUnits / chems.length) * f);
          if (value <= 0) return;
          salesRows.push([m, ch.rep, ch.id, bid, PRODUCT_OF[bid], units, value, Math.round(units / 8)]);
        });
      });
    });
  });
  stmts.push({ sql: `INSERT INTO sales_batches (id,uploaded_by,uploaded_at,filename,month,row_count,status) VALUES (1,'HO003',?, 'seed_history_ea.csv', ?, ?, 'committed')`,
    args: [now, `${months[0]}..${months[months.length - 1]}`, salesRows.length] });
  add(`INSERT INTO sales_data (batch_id,month,employee_id,hcp_id,chemist_id,brand_id,product_id,quantity,sales_value,prescription_count,source)
       VALUES (1,?,?,NULL,?,?,?,?,?,?,'seed')`, salesRows);

  add(`INSERT INTO activities (id,title,objective,type_id,brand_id,product_id,proposed_by,territory,planned_date,venue,
        estimated_cost,expected_hcp_count,expected_sales,status,decided_by,decided_at,decision_remarks,
        actual_date,actual_venue,actual_cost,completion_remarks,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    ['ACT001', 'Nairobi Cardiology CME', 'Update cardiologists on Cardiozan data', 'CME', 'BR01', 'PR01',
      'EMP001', 'Kenya', '2026-01-15', 'Sarova Stanley, Nairobi', 220000, 1, 900000, 'executed',
      'HO001', '2026-01-03T10:00:00Z', 'Approved.', '2026-01-15', 'Sarova Stanley, Nairobi', 240000, 'Strong engagement.', '2025-12-20T09:00:00Z', '2026-01-16T09:00:00Z'],
    ['ACT002', 'Nairobi Oncology RTM', 'Position Oncovita with oncologists', 'RTM', 'BR03', 'PR04',
      'EMP007', 'Kenya', '2026-01-20', 'Villa Rosa, Nairobi', 300000, 1, 1200000, 'executed',
      'HO001', '2026-01-05T10:00:00Z', 'Approved.', '2026-01-20', 'Villa Rosa, Nairobi', 315000, 'Good case discussion.', '2025-12-22T09:00:00Z', '2026-01-21T09:00:00Z'],
    ['ACT003', 'Dar Oncology RTM', 'Position Oncovita in adjuvant therapy', 'RTM', 'BR03', 'PR04',
      'EMP003', 'Tanzania', '2026-01-22', 'Hyatt Regency, Dar', 6500000, 1, 24000000, 'executed',
      'HO001', '2026-01-06T10:00:00Z', 'Approved.', '2026-01-22', 'Hyatt Regency, Dar', 6900000, 'Led by Dr. Mushi.', '2025-12-28T09:00:00Z', '2026-01-23T09:00:00Z'],
    ['ACT004', 'Kampala Diabetes Awareness Camp', 'Screening drive for Glucofine', 'CAMP', 'BR02', 'PR03',
      'EMP002', 'Uganda', '2026-07-20', 'Kampala Community Hall', 9000000, 3, 30000000, 'submitted',
      null, null, null, null, null, null, null, '2026-06-30T09:00:00Z', '2026-06-30T09:00:00Z'],
    ['ACT005', 'Lusaka Chemist Promotion', 'Visibility for Oncovita', 'CHEMPROMO', 'BR03', 'PR04',
      'EMP006', 'Zambia', '2026-07-25', 'Lusaka CBD', 8000, 0, 40000, 'draft',
      null, null, null, null, null, null, null, '2026-07-02T09:00:00Z', '2026-07-02T09:00:00Z'],
    ['ACT006', 'Kampala Wholesaler Trade Meet', 'Trade activation & stocking with a key wholesaler', 'CHEMPROMO', 'BR02', 'PR03',
      'EMP002', 'Uganda', '2026-01-18', 'Kampala Serena', 4500000, 0, 12000000, 'executed',
      'HO001', '2026-01-06T10:00:00Z', 'Approved trade meet.', '2026-01-18', 'Kampala Serena', 4800000, 'Strong stocking commitment from Kampala Distributors.', '2025-12-30T09:00:00Z', '2026-01-19T09:00:00Z'],
  ]);
  add(`INSERT INTO activity_participants (activity_id,account_id,account_type,proposed,invited,attended,remarks) VALUES (?,?,?,?,?,?,?)`, [
    ['ACT001', 'HCP001', 'hcp', 1, 1, 1, ''], ['ACT001', 'CHEM001', 'chemist', 1, 1, 1, ''],
    ['ACT002', 'HCP002', 'hcp', 1, 1, 1, 'Speaker'], ['ACT002', 'CHEM003', 'chemist', 1, 1, 1, ''],
    ['ACT003', 'HCP005', 'hcp', 1, 1, 1, 'Speaker'], ['ACT003', 'CHEM006', 'chemist', 1, 1, 1, ''],
    ['ACT004', 'HCP003', 'hcp', 1, 0, 0, ''], ['ACT005', 'HCP011', 'hcp', 1, 0, 0, ''],
    ['ACT006', 'CHEM005', 'chemist', 1, 1, 1, 'Wholesaler trade partner'],
  ]);
  add(`INSERT INTO expense_lines (activity_id,category,amount,vendor,invoice_no) VALUES (?,?,?,?,?)`, [
    ['ACT001', 'Hall', 90000, 'Sarova Stanley', 'SS-8812'], ['ACT001', 'Food', 100000, 'Sarova Catering', 'SS-8813'],
    ['ACT001', 'Speaker', 40000, 'Dr. K. Mwangi', 'HON-102'], ['ACT001', 'Printing', 10000, 'PrintExpress', 'PE-441'],
    ['ACT002', 'Hall', 180000, 'Villa Rosa', 'VR-21'], ['ACT002', 'Food', 135000, 'Villa Rosa', 'VR-22'],
    ['ACT003', 'Hall', 3000000, 'Hyatt Regency', 'HY-3321'], ['ACT003', 'Food', 2500000, 'Hyatt Regency', 'HY-3322'], ['ACT003', 'Travel', 1400000, 'Local Transfers', 'LT-901'],
    ['ACT006', 'Hall', 2500000, 'Kampala Serena', 'KS-11'], ['ACT006', 'Food', 2000000, 'Kampala Serena', 'KS-12'], ['ACT006', 'Promotional Material', 300000, 'BrandWorks', 'BW-9'],
  ]);
  add(`INSERT INTO attachments (activity_id,kind,filename,uploaded_by,uploaded_at) VALUES (?,?,?,?, '${now}')`, [
    ['ACT001', 'invoice', 'nairobi_cme_invoice.pdf', 'EMP001'], ['ACT003', 'invoice', 'dar_rtm_receipt.pdf', 'EMP003'],
  ]);

  add(`INSERT INTO daily_allowances (id,user_id,country_code,currency_code,da_date,location,purpose,da_amount,status,created_at,decided_by,decided_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
    [1, 'EMP001', 'KE', 'KES', '2026-06-24', 'Nairobi', 'Doctor calls - CBD circuit', 3000, 'approved', now, 'HO002', now],
    [2, 'EMP001', 'KE', 'KES', '2026-06-25', 'Thika', 'Upcountry chemist visits', 3500, 'submitted', now, null, null],
    [3, 'EMP003', 'TZ', 'TZS', '2026-06-25', 'Dar es Salaam', 'RTM follow-up visits', 60000, 'submitted', now, null, null],
  ]);
  add(`INSERT INTO da_attachments (da_id,category,amount,filename,mime,uploaded_at) VALUES (?,?,?,?,?, '${now}')`, [
    [2, 'Fuel', 2000, 'fuel_receipt_thika.jpg', 'image/jpeg'], [2, 'Meals', 1200, 'lunch_receipt.jpg', 'image/jpeg'],
  ]);

  add(`INSERT INTO config (key,value) VALUES (?,?)`, [
    ['roi_window_months', '3'], ['gross_margin_pct', '70'], ['overrun_threshold_pct', '110'],
    ['da_daily_cap_usd', '30'], ['fiscal_start_month', '4'],
  ]);
  add(`INSERT INTO notifications (user_id,type,message,entity_type,entity_id,created_at) VALUES (?,?,?,?,?, '${now}')`, [
    ['HO001', 'submitted', 'Sarah Nakato submitted "Kampala Diabetes Awareness Camp" for approval', 'activity', 'ACT004'],
    ['HO002', 'da_submitted', 'James Mwangi submitted a daily allowance claim (Thika)', 'da', '2'],
  ]);

  await q.batch(stmts);
  console.log('Seeded East Africa pool (Apr 2025 – Jun 2026, fiscal April, 2 reps in KE & TZ).');
}

module.exports = { seedIfEmpty };
