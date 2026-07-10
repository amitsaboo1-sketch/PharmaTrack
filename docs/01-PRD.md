# Product Requirement Document (PRD)
## Pharma Marketing Activity Management & ROI Intelligence Platform ("PharmaTrack")

**Version:** 1.0 · **Date:** 2026-07-06 · **Status:** Approved for build
**Origin:** Evolves the Antigravity prototype (`pharma-roi-portal`) into an enterprise-grade platform.

---

## 1. Vision

A single source of truth for every rupee/dollar of pharma marketing spend — from proposal to approval to execution to the prescription growth it generated — with doctor-level ROI attribution.

## 2. Problem Statement

Pharma companies run CMEs, RTMs, gifting, camps and launches through Excel, email and WhatsApp. Consequences:

| Problem | Business impact |
|---|---|
| No structured approval workflow | Unauthorized / duplicate spend |
| Activity proposed for Dr. A, conducted for Dr. B | Budget leakage, compliance risk |
| Actual attendees never captured | No engagement history, audit failures |
| Spend not mapped to individual doctors | ROI unmeasurable |
| No spend ↔ prescription linkage | Marketing budget allocated on gut feel |
| No central reporting | Management flies blind |

## 3. Goals & Success Metrics

| Goal | KPI | Target (Year 1) |
|---|---|---|
| Digitize activity lifecycle | % activities managed in platform | > 95% |
| Approval discipline | Median proposal → decision time | < 48 h |
| Attendance integrity | % completed activities with actual HCP list | > 98% |
| ROI visibility | % spend with doctor-level attribution | > 90% |
| Audit readiness | Time to produce audit trail for any activity | < 5 min |

## 4. User Personas

### P1 — Rohan, Medical Representative (field)
- 28, covers Mumbai West, 120 doctors, 40 chemists. Mobile-first, 10 minutes between calls.
- **Needs:** propose an activity in < 3 minutes, see approval status, log execution + attendance fast, see his own ROI.
- **Pain:** re-typing doctor lists, chasing approvals on WhatsApp, month-end expense scrambles.

### P2 — Meera, Area/Regional Manager
- Oversees 8–25 reps. Approves first-line, monitors territory performance.
- **Needs:** pending-approval queue, team dashboards, discrepancy alerts (proposed vs actual attendees).

### P3 — Dr. Amit, Product/Marketing Manager (Head Office)
- Owns brand budgets. Approves high-value activities, plans campaigns.
- **Needs:** brand ROI, spend vs budget, which activity types work, doctor segmentation.

### P4 — Kavita, Finance Controller
- **Needs:** invoice-level expense data, budget locks, exportable reports, immutable audit trail.

### P5 — Suresh, Commercial Excellence / Admin
- **Needs:** master data governance (HCP/hospital/brand/product), user management, monthly sales CSV import, data-quality dashboards.

## 5. User Journey Maps (condensed)

**MR journey — run a CME:**
Plan (pick doctors from territory list) → Propose (form + budget + expected attendees) → Track (status timeline, notifications) → Execute (actual date/venue/cost, tick attendees, upload invoice + photos) → Close (completion report) → Learn (activity ROI visible after next sales import).

**HO journey — monthly cycle:**
Review approval queue (approve / reject / return) → mid-month: monitor execution & discrepancy audit → month-end: import sales CSV (validate → preview → commit) → dashboards refresh → review brand/territory/doctor ROI → reallocate budgets.

**Field edge case (from prototype, retained):** MR meets an unregistered doctor → creates *ad-hoc unverified* HCP inline → activity proceeds → HO later **approves to master** or **merges into existing profile** (all links re-pointed automatically).

## 6. Scope

### MVP (this build — Phase 1)
1. JWT authentication, role-based access (Sales roles + HO roles), change password, login audit.
2. Master data: HCPs, Chemists/Pharmacies, Hospitals (as HCP class), Brands, Products, Users/Territories.
3. Activity lifecycle: Draft → Submitted → Approved / Rejected / Returned → Executed → Closed, with full field set (type, brand, product, venue, budget, expected vs actual).
4. Actual HCP mapping: many-to-many attendance with invitation/attendance status.
5. Expense capture with category breakup (Food, Hall, Speaker, Travel, Stay, Printing, Promo Material, Gift, Misc) + invoice reference.
6. Doctor ↔ Chemist sales-attribution mapping (prototype concept, retained).
7. Ad-hoc account creation + HO verification / merge queue (prototype concept, retained).
8. Monthly sales CSV import: template generator, validation report, preview, commit, upload history, rollback.
9. ROI engine: Before-vs-After with configurable window (3/6-month average), computed at Activity, Doctor, Chemist, Employee, Brand levels.
10. Dashboards: Executive (HO), Sales (personal), Doctor 360.
11. Discrepancy audit (proposed vs executed attendees, cost overruns).
12. In-app notifications; CSV report exports; append-only audit trail.

### Phase 2
Multi-level approval chains (AM → RM → PM by budget slab), budget locks per brand/quarter, email/WhatsApp notifications, file-object storage (S3), PDF/Excel report rendering, hospital master as first-class entity with departments, prescription-count data, MFA, mobile PWA offline mode, multi-currency.

### Phase 3
Multi-tenant SaaS (company-level isolation), AI attribution & ROI prediction, doctor recommendation engine, budget optimizer, anomaly detection, NL dashboard queries, CRM/ERP integrations (Veeva, SAP), data warehouse + BI connector.

### Out of scope (all phases)
Payroll, order booking/secondary sales capture, e-detailing content management.

## 7. Documented Assumptions (enterprise defaults chosen where the brief was silent)

| # | Assumption |
|---|---|
| A1 | Sales attribution flows **doctor → mapped chemist(s) → chemist monthly sales**, because Rx-level data is rarely available in India; direct doctor-level sales rows in the CSV are also supported and take precedence when present. |
| A2 | When an activity has N attending doctors, cost is allocated **equally per attending doctor** in MVP (weighted-by-potential in Phase 2). |
| A3 | Incremental sales = (avg monthly sales in the W months **after** activity month) − (avg in W months **before**), W configurable (default 3). ROI% = (incremental × gross-margin% − allocated cost) / allocated cost. Default gross margin 70% (configurable). |
| A4 | One level of approval in MVP; any HO role may decide. Multi-level chains are Phase 2. |
| A5 | A month's sales upload replaces nothing silently: re-uploading the same month/scope is flagged as duplicate; user must roll back the earlier batch first. |
| A6 | "Hospital" is modeled in MVP as an HCP of class *Hospital* plus an `isHospitalInHouse` flag on chemists (prototype approach); a dedicated hospital master arrives in Phase 2. |
| A7 | Completed/executed activities are immutable except via HO "reopen" (audited). Nobody deletes completed activities. |
| A8 | Currency: INR display defaults; stored as numeric, currency-agnostic. |
| A9 | Timezone: server stores UTC ISO dates; month keys are `YYYY-MM` strings. |
| A10 | Compliance: gift/hospitality caps per doctor category are configuration values enforced as warnings in MVP, hard blocks in Phase 2 (UCPMP/Sunshine-style rules vary by country). |

## 8. Competitive/Context Note
Veeva CRM Events, IQVIA OCE and Salesforce Life Sciences cover event management but are heavyweight, seat-expensive, and weak on chemist-level Indian-market attribution. This platform's differentiator is the **closed loop: spend → actual attendee → mapped chemist sales → ROI**.
