# Development Roadmap & Sprint Plan

## Roadmap

| Phase | Duration | Outcome |
|---|---|---|
| **Phase 1 — MVP** (this build) | Sprints 1–6 (12 wks) | Single-BU deployment: full activity lifecycle, attendance, expenses, CSV sales import, ROI engine, dashboards, audit |
| **Phase 2 — Enterprise hardening** | Sprints 7–12 | Postgres + S3 + Redis, multi-level approvals & budget locks, email/WhatsApp notifications, PDF/Excel reports, hospital master, MFA/SSO, PWA offline, React frontend |
| **Phase 3 — SaaS + Intelligence** | Sprints 13–20 | Multi-tenant RLS, AI attribution & ROI prediction, doctor recommendation, budget optimizer, anomaly detection, NL queries, Veeva/SAP connectors |

## Sprint plan (2-week sprints, MVP)

| Sprint | Deliverable | Exit criteria |
|---|---|---|
| S1 | Auth + RBAC + user/master schemas + seed | login works; every route guarded; matrix tests green |
| S2 | Masters UI + mappings + ad-hoc/verification/merge | rep can add unverified HCP; HO merge re-points links |
| S3 | Activity lifecycle (propose→decide→execute) + participants + expenses | full happy path + audit rows + notifications |
| S4 | Sales CSV wizard (template/validate/preview/commit/rollback/history) | 100k-row file < 10 s; duplicate-month guard |
| S5 | ROI engine + Doctor 360 + leaderboards | before/after windows correct on fixture data |
| S6 | Dashboards, discrepancy audit, reports, polish, smoke tests, UAT | personas complete scripted flows unaided |

## Team shape (recommended)
1 PM · 1 designer · 2 backend · 2 frontend · 1 QA · 0.5 DevOps. MVP demo build is deliberately runnable by a single developer (`npm install && npm start`).

## Risks & mitigations
| Risk | Mitigation |
|---|---|
| Sales data arrives doctor-less (distributor-level) | chemist-mapping attribution path (already core design) |
| Field adoption resistance | < 3-min proposal flow, mobile-responsive, demo chips |
| ROI disputes ("model is wrong") | model + window stored per computation; multiple models Phase 2; always show underlying rows |
| Master-data chaos (duplicate doctors) | verification/merge queue from day 1 |
| Compliance variance by country | config-table driven caps & rules |
