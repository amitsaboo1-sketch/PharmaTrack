# Pharos — Pharma Marketing Activity Management & Marketing Effectiveness Intelligence Platform

_Illuminate every move in the field._

Single source of truth for pharma marketing spend: **propose → approve → execute → track attendance → import sales → measure doctor-level Marketing Effectiveness**.

Clean rebuild of the Antigravity prototype (`pharma-roi-portal`), keeping its best ideas — doctor↔chemist sales attribution, field-account verification/merge, discrepancy audit — on an enterprise-shaped architecture (JWT auth, RBAC, audit trail, modular API, import batches with rollback).

## Run it

Requires Node.js ≥ 22.5 (uses the built-in `node:sqlite` — no native builds).

```bash
npm install
npm start          # http://localhost:3000
npm test           # end-to-end smoke suite
```

The database (`pharmatrack.db`) is created and seeded on first start.

### Always-on local server

The app is set to run continuously at **http://localhost:5050**, independent of any editor
session. A hidden launcher (`serve.cmd` → `start-hidden.vbs`) is registered in the Windows
Startup folder (`PharmaTrackServer.vbs`), so the server auto-starts at every logon. To open it
any time, double-click **`Start PharmaTrack.bat`** (it opens the browser and starts the server
only if it isn't already running). Port 5050 is dedicated to this always-on instance.

## East Africa pool

Sales run across 6 pooled-territory countries, each in its own currency: Kenya (KES),
Uganda (UGX), Tanzania (TZS), Rwanda (RWF), Mauritius (MUR), Zambia (ZMW). Targets and
achievement consolidate **at country level** — brand-wise and overall, in units and value,
in the local currency. Field reps view all reports on-portal (no data downloads); Head
Office / Finance retain export access. Reps log **Daily Allowance** claims with attached
expense proofs, routed to HO for approval.

## Demo accounts (password: `demo123`)

| Email | Role |
|---|---|
| kenya@pharmatrack.demo | Sales — Medical Rep, Kenya (KES) |
| uganda@pharmatrack.demo | Sales — Medical Rep, Uganda (UGX) |
| tanzania@pharmatrack.demo | Sales — Medical Rep, Tanzania (TZS) |
| rwanda@ / mauritius@ / zambia@ | Sales — Medical Rep (RWF / MUR / ZMW) |
| amit@pharmatrack.demo | HO — Product Manager (approvals) |
| kavita@pharmatrack.demo | HO — Finance (DA approvals, exports) |
| admin@pharmatrack.demo | HO — Admin (users, config) |

## Try the full loop

1. Sign in as **rohan** → *Activities* → **Propose Activity** (pick doctors, submit).
2. Sign in as **amit** → *Approvals* → open it → **Approve**.
3. Back as **rohan** → open the activity → **Record Execution** (tick attendees, expense breakup).
4. As **amit** → *Sales Import* → download template, upload a CSV for the following months → **Commit**.
5. Open the activity again → the **Marketing Effectiveness panel** shows before/after attribution per doctor. *Marketing Effectiveness Analytics* ranks doctors/reps/brands; *Audit Trail* shows every step.

## Documentation

All pre-build deliverables (PRD, FRS, role matrix, NFR/security, ER design, API spec, wireframes, roadmap) live in [`docs/`](docs/).

## Layout

```
server/   Express API — routes / services (Marketing Effectiveness, CSV) / middleware (auth, audit) / db (schema, seed)
public/   Zero-build SPA — hash router, page modules, Chart.js
docs/     Deliverables 1–20
test/     Critical-path smoke suite (node:test)
```
