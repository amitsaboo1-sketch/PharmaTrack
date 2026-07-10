# Functional Requirement Specification (FRS)

**Modules:** Auth · Masters · Activities · Attendance · Expenses · Mappings · Verification · Sales Import · ROI · Dashboards · Reports · Notifications · Audit

---

## FR-1 Authentication & Access
- FR-1.1 Login with email + password; server issues JWT (8 h expiry). Passwords bcrypt-hashed (cost 10).
- FR-1.2 Change password (old password required). Forgot/reset: admin resets in MVP; email token in Phase 2.
- FR-1.3 Every login (success/failure) recorded in audit log with IP.
- FR-1.4 RBAC enforced server-side on every route; UI menus are role-filtered as convenience only.
- FR-1.5 Sales users see only rows in their territory scope (`repId` scoping); HO users see all.

## FR-2 Master Data
- FR-2.1 HCP master: id, name, qualification, speciality, clinic, city, territory, assigned rep, class (A/B/C/Hospital), potential score, registration no., active & verified flags.
- FR-2.2 Chemist master: id, name, address, assigned rep, hospital-in-house flag, verified flag.
- FR-2.3 Brand master; Product master (product → brand FK, pack/SKU).
- FR-2.4 Users: role, territory, region, manager. Admin-only CRUD.
- FR-2.5 Doctor↔Chemist mapping: many-to-many; maintained by the rep for own territory; used by ROI attribution.
- FR-2.6 Ad-hoc creation: sales user may create an *unverified* HCP/chemist with minimal fields; usable immediately in own activities; excluded from official ROI reports until verified.
- FR-2.7 Verification queue (HO): **Approve to master** (sets verified) or **Merge** into an existing record (re-points attendance rows, mappings, sales rows; deletes duplicate; fully audited).

## FR-3 Activity Lifecycle

```
DRAFT → SUBMITTED → APPROVED → EXECUTED → CLOSED
            │            ↑
            ├→ RETURNED ─┘  (rep edits & resubmits)
            └→ REJECTED  (terminal)
```

- FR-3.1 Proposal fields: name, type (CME/RTM/Gifting/Camp/Launch/Chemist Promotion/Personalized/Digital/Other), brand, product, objective, planned date, venue, estimated cost, expected HCP count, expected incremental sales, proposed HCP list, proposed chemist list, remarks.
- FR-3.2 Draft editable/deletable by owner only. Submit locks it for review.
- FR-3.3 HO decision: approve / reject / return — remarks mandatory for reject & return; decision + decider + timestamp stored.
- FR-3.4 Execution (owner, only when APPROVED): actual date, actual venue, actual total cost, expense breakup by category (must sum to total), attendee tick-list (from proposed + any master/adhoc addition), invoice refs, photo refs, completion remarks.
- FR-3.5 Per-attendee record: invited y/n, attended y/n, remarks. Actual list may differ from proposed — this is expected and reported, never blocked.
- FR-3.6 Executed activities immutable to sales; HO may reopen (audited).
- FR-3.7 Every status change writes an audit row and an in-app notification to the counterparty.

## FR-4 Expense Rules
- FR-4.1 Categories: Food, Hall, Speaker, Travel, Stay, Printing, Promotional Material, Gift, Miscellaneous.
- FR-4.2 Breakup lines: category, amount, vendor, invoice number. Sum must equal actual cost (validated).
- FR-4.3 Overrun flag when actual > 110% of estimate (threshold configurable) — surfaces in discrepancy audit.

## FR-5 Monthly Sales Import (HO)
- FR-5.1 Downloadable CSV template with header row + one example row.
- FR-5.2 Columns: month(YYYY-MM), employee_code, hcp_id, chemist_id, brand, product, quantity, sales_value, prescription_count, source, remarks. (hcp_id or chemist_id — at least one.)
- FR-5.3 Validation: mandatory fields, month format, month not in future, non-negative numbers, known employee/HCP/chemist/brand/product, duplicate rows inside file, duplicate month+scope vs earlier batches. Errors reported per row with reason; valid rows importable, invalid rows rejected (all-or-nothing toggle).
- FR-5.4 Import wizard: upload → validation report → preview (first 50 rows + totals) → commit. Each commit = a batch with id, user, timestamp, row count.
- FR-5.5 Rollback: deleting a batch removes exactly its rows; audited.
- FR-5.6 Upload history screen (batch list, status, counts, rollback button).

## FR-6 ROI Engine
- FR-6.1 Per activity: allocated cost per attending doctor = actual cost / attendee count (A2).
- FR-6.2 Doctor sales stream = direct HCP sales rows ∪ mapped chemists' sales rows (A1).
- FR-6.3 Incremental = avg(after-window) − avg(before-window); window W ∈ {3, 6} months, default 3, excludes activity month.
- FR-6.4 Activity ROI% = (Σ attendees' incremental × margin − actual cost) / actual cost. Also: cost/doctor, cost/prescription, payback months.
- FR-6.5 Rollups: doctor, chemist, employee, brand, territory = aggregation of activity-level allocations.
- FR-6.6 Attribution model field is stored per computation so future models (weighted, multi-touch, decay, AI) plug in without schema change.
- FR-6.7 ROI shows "insufficient data" (not zero) when after-window has no sales rows yet.

## FR-7 Dashboards
- FR-7.1 Executive (HO): cards — total spend, activities, pending approvals, completed, budget utilization, monthly sales, blended ROI; charts — monthly spend vs incremental sales, spend by activity type, ROI by brand, top/bottom reps; pending approvals panel.
- FR-7.2 Sales (personal): target-vs-achieved rings (month/YTD), my activities by status, my ROI, my top doctors, expense summary.
- FR-7.3 Doctor 360: profile, engagement timeline, spend history, sales trend, ROI, mapped chemists.
- FR-7.4 Discrepancy audit: proposed-but-absent doctors, attended-but-never-proposed, cost overruns, unverified accounts in executed activities.

## FR-8 Reports (CSV export in MVP)
Activity report, expense report, attendance report, doctor ROI, employee ROI, brand ROI, sales report, audit report — all honoring the caller's role scope.

## FR-9 Notifications (in-app MVP)
Events: submitted (→ HO), approved/rejected/returned (→ owner), executed (→ HO), CSV committed/rolled back (→ HO), account verified/merged (→ owner). Unread badge, mark-read.

## FR-10 Audit Trail
Append-only: timestamp, user, action, entity type+id, before/after JSON, IP. No update/delete API exists for audit rows.

---

# Role & Permission Matrix

| Capability | MR / TM (sales) | AM / RM (sales mgr)* | Product / Mktg Mgr (HO) | Finance (HO) | Admin (HO) |
|---|---|---|---|---|---|
| Login / change own password | ✔ | ✔ | ✔ | ✔ | ✔ |
| View own dashboard | ✔ | ✔ | ✔ | ✔ | ✔ |
| Create / edit / submit own proposal | ✔ | ✔ | – | – | – |
| Execute own approved activity | ✔ | ✔ | – | – | – |
| Add ad-hoc HCP/chemist (unverified) | ✔ | ✔ | – | – | – |
| Maintain own doctor↔chemist mappings | ✔ | ✔ | – | – | – |
| View other territories | ✖ | own team | ✔ all | ✔ all | ✔ all |
| Approve / reject / return activities | ✖ | Phase 2 | ✔ | ✖ | ✔ |
| Verify / merge ad-hoc accounts | ✖ | ✖ | ✔ | ✖ | ✔ |
| Upload / rollback sales CSV | ✖ | ✖ | ✔ | ✔ | ✔ |
| Manage masters (HCP/brand/product) | ✖ | ✖ | ✔ | ✖ | ✔ |
| Manage users & roles | ✖ | ✖ | ✖ | ✖ | ✔ |
| View enterprise dashboards & all reports | ✖ | team | ✔ | ✔ | ✔ |
| View audit log | ✖ | ✖ | ✖ | ✔ | ✔ |
| Delete completed activities | ✖ | ✖ | ✖ | ✖ | ✖ (nobody) |

\* MVP ships two effective role groups (`sales`, `ho`) with the sub-role stored on the user record; manager-scoped views and multi-level approval activate in Phase 2 without schema change.
