# API Specification (REST, JSON)

Base: `/api` · Auth: `Authorization: Bearer <JWT>` on everything except `/auth/login` and `/health`.
Errors: `{ "error": "message" }` with 400/401/403/404/409/500. All list endpoints honor role/territory scoping server-side.

## Auth
| Method & path | Role | Body / params | Returns |
|---|---|---|---|
| POST /auth/login | public | { email, password } | { token, user } |
| GET /auth/me | any | – | current user |
| POST /auth/change-password | any | { oldPassword, newPassword } | ok |

## Masters
| Method & path | Role | Notes |
|---|---|---|
| GET /hcps | any | sales → own territory; `?q=&speciality=&verified=` |
| POST /hcps | ho | create master HCP |
| POST /hcps/adhoc | sales | creates `verified=0` HCP in own territory |
| PUT /hcps/:id | ho | update |
| GET /hcps/:id/profile | any(scoped) | Doctor-360: profile + activities + spend + sales trend + ROI |
| GET /chemists · POST /chemists · POST /chemists/adhoc | as above | |
| GET /brands · POST /brands · GET /products · POST /products | GET any, POST ho | |
| GET /users · POST /users · PUT /users/:id | admin | password auto-generated on create |
| GET /activity-types | any | |

## Mappings & Verification
| Method & path | Role | Notes |
|---|---|---|
| GET /mappings | any(scoped) | doctor↔chemist pairs |
| POST /mappings · DELETE /mappings | sales(own), ho | { hcpId, chemistId } |
| GET /verification/pending | ho | unverified HCPs + chemists |
| POST /verification/decide | ho | { type, id, action: approve\|merge, mergeTargetId? } — merge re-points participants, mappings, sales rows |

## Activities
| Method & path | Role | Notes |
|---|---|---|
| GET /activities | any(scoped) | `?status=&type=&brand=&from=&to=&repId=` |
| GET /activities/:id | any(scoped) | full detail incl. participants, expenses, attachments, roi |
| POST /activities | sales | create draft (or `submit:true`) |
| PUT /activities/:id | owner | only draft/returned |
| POST /activities/:id/submit | owner | draft/returned → submitted |
| POST /activities/:id/decision | ho | { decision: approved\|rejected\|returned, remarks } |
| POST /activities/:id/execute | owner | { actualDate, actualVenue, actualCost, expenses:[{category,amount,vendor,invoiceNo}], attendees:[{accountId,accountType,attended,remarks}], attachments:[…], completionRemarks } — validates breakup sum |
| POST /activities/:id/reopen | ho | executed → approved (audited) |

## Sales Import
| Method & path | Role | Notes |
|---|---|---|
| GET /sales/template | ho | text/csv template download |
| POST /sales/validate | ho | { csvText } → { validRows, errors:[{row,reason}], warnings, duplicateBatch? } |
| POST /sales/commit | ho | { csvText, filename } → batch id (re-validates atomically) |
| GET /sales/batches | ho | upload history |
| POST /sales/batches/:id/rollback | ho | deletes batch rows, audited |
| GET /sales/summary | any(scoped) | monthly totals for charts |

## ROI & Analytics
| Method & path | Role | Notes |
|---|---|---|
| GET /roi/activity/:id | any(scoped) | { cost, baseline, post, incremental, roiPct, costPerDoctor, perDoctor:[…], model, window } |
| GET /roi/leaderboard?scope=hcp\|employee\|brand | ho / scoped | ranked ROI table |
| GET /dashboards/executive | ho | KPI cards + chart series |
| GET /dashboards/sales | sales | personal KPIs, targets, top doctors |
| GET /audit/discrepancies | ho | attendee diffs, cost overruns, unverified-in-executed |

## Reports / Notifications / Audit / Config
| Method & path | Role | Notes |
|---|---|---|
| GET /reports/:name.csv | scoped | name ∈ activities, expenses, attendance, doctor-roi, employee-roi, brand-roi, sales, audit |
| GET /notifications · POST /notifications/read | any | own only |
| GET /audit | ho(finance/admin) | `?entityType=&entityId=&user=` |
| GET /config · PUT /config | GET ho, PUT admin | roi window, margin, thresholds |
| GET /health | public | { status } |

**Versioning:** path-versioning (`/api/v1`) reserved for Phase 2; MVP is v1 implicit.
**Pagination:** `?limit=&offset=` on list endpoints (default 100).
