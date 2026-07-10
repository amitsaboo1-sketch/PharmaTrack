# Technology Stack & Folder Structure

## Recommended production stack vs. what the MVP implements

| Layer | Production recommendation | MVP (this repo) — why |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite, TanStack Query, Tailwind | Vanilla ES-modules SPA — zero build step, runs by double-click on any machine (capstone-friendly); page modules map 1:1 to future React routes |
| Charts | Recharts / ECharts | Chart.js (CDN) |
| Backend | Node.js 24 + Express (or NestJS for larger teams) | Node.js 24 + Express — same as production choice |
| Database | PostgreSQL 16 (RDS multi-AZ), monthly partitions | SQLite via built-in `node:sqlite` — zero native deps on Windows; ANSI-portable schema |
| Auth | JWT access + refresh, TOTP MFA, SSO (SAML/OIDC) via Keycloak/Entra | JWT (HS256) + bcryptjs |
| Storage | S3 + presigned URLs | attachment metadata in DB |
| Cache | Redis (dashboards, sessions) | in-process |
| Search | OpenSearch (HCP fuzzy search) | SQL LIKE |
| Queue | SQS + worker pods (CSV, ROI recompute, notifications) | synchronous |
| Notifications | SES email + WhatsApp Business API + FCM push | in-app table |
| Logging/Monitoring | OTel → Grafana/Loki/Tempo; Sentry | console request log |
| CI/CD | GitHub Actions → ECR → ECS blue/green | `npm test` smoke suite |
| Security | WAF, rate limits, Vault/KMS secrets | env-var secrets, parameterized SQL, RBAC middleware |

The MVP intentionally mirrors production shapes (routes/services/middleware split, config table, batch imports, ROI cache table) so the Postgres/React migration is a port, not a rewrite.

## Folder structure

```
pharma-roi-platform/
├── package.json              # deps: express, bcryptjs, jsonwebtoken
├── README.md                 # run instructions
├── .gitignore
├── docs/                     # deliverables 1–20 (this documentation set)
├── server/
│   ├── index.js              # bootstrap: express app, static hosting, route mounting
│   ├── config.js             # env + defaults (PORT, JWT_SECRET, DB_PATH)
│   ├── db/
│   │   ├── connection.js     # node:sqlite DatabaseSync + helpers
│   │   ├── schema.js         # CREATE TABLE statements (portable SQL)
│   │   └── seed.js           # demo org: users, HCPs, chemists, brands, sales history
│   ├── middleware/
│   │   ├── auth.js           # JWT verify, requireRole, territory scoping helpers
│   │   └── audit.js          # audit(), notify() helpers
│   ├── services/
│   │   ├── roi.js            # attribution engine (before/after windows, allocations)
│   │   └── csv.js            # template, parse, validate
│   └── routes/
│       ├── auth.routes.js
│       ├── masters.routes.js     # hcps, chemists, brands, products, users, mappings, verification
│       ├── activities.routes.js  # lifecycle + participants + expenses
│       ├── sales.routes.js       # import wizard endpoints + batches
│       ├── analytics.routes.js   # dashboards, roi, discrepancies, reports
│       └── misc.routes.js        # notifications, audit, config, health
├── public/                   # SPA served by express.static
│   ├── index.html
│   ├── css/styles.css        # design tokens + components (clean light enterprise theme)
│   └── js/
│       ├── main.js           # hash router + shell (sidebar/topbar, role-based menu)
│       ├── api.js            # fetch wrapper with JWT + error toasts
│       ├── ui.js             # reusable: cards, tables, modals, badges, charts, toasts
│       └── pages/            # one module per screen
│           ├── login.js  dashboard.js  activities.js  activity-detail.js
│           ├── approvals.js  masters.js  mappings.js  verification.js
│           ├── sales-import.js  roi.js  reports.js  audit.js  settings.js
└── test/
    └── smoke.test.js         # end-to-end critical path (node:test)
```
