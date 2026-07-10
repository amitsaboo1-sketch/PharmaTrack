# Non-Functional Requirements, Security, Deployment & Test Strategy

## 1. Non-Functional Requirements

| Category | Requirement (MVP) | Target (production/Phase 2+) |
|---|---|---|
| Performance | Dashboard API < 500 ms on 100k sales rows | p95 < 300 ms, 1M+ rows via Postgres + matviews |
| Scalability | Single node, SQLite | Stateless API pods behind LB; Postgres + read replicas; Redis cache |
| Availability | Dev/demo | 99.9%, multi-AZ, automated failover |
| Concurrency | 50 users | 5,000+ concurrent (thousands of field users) |
| Data volume | 10k HCPs, 100k sales rows | 1M HCPs, 100M sales rows (partition by month) |
| Auditability | Append-only audit table | WORM/object-lock archive, 7-year retention |
| Localization | en, INR formatting | i18n bundles, multi-currency, per-country compliance config |
| Backup | Copy SQLite file | PITR (WAL archiving), daily snapshots, tested restores |
| Observability | Console + morgan-style request log | Structured logs → ELK; metrics → Prometheus/Grafana; tracing → OTel |

## 2. Security Checklist

- [x] Passwords bcrypt-hashed, never logged or returned
- [x] JWT signed (HS256, strong secret via env), 8 h expiry; auth middleware on every non-public route
- [x] RBAC enforced server-side (role + territory scoping), never trusted from client
- [x] Parameterized SQL everywhere (no string concatenation)
- [x] Input validation on all write endpoints; CSV values validated before insert
- [x] Audit log append-only; login attempts recorded with IP
- [x] Completed activities cannot be deleted by anyone
- [x] Secrets via environment variables (`JWT_SECRET`, `PORT`)
- [x] No PII in URLs; ids are opaque codes
- [ ] Phase 2: HTTPS termination + HSTS (reverse proxy), rate limiting, account lockout, MFA (TOTP), password policy + rotation, CSRF tokens for cookie mode, file-upload AV scanning, field-level encryption for HCP PII, security headers (CSP), dependency scanning (SCA), pen test before go-live, GDPR/DPDP data-subject workflows

## 3. Deployment Architecture

**MVP/demo:** one Node process serves API + static frontend; SQLite file alongside; run `npm start`.

**Production reference (Phase 2):**
```
Route53/DNS → CloudFront (static SPA) ┐
                                       ├→ ALB → ECS/EKS Node API pods (stateless, HPA)
Users (web/PWA) ──────────────────────┘            │
                                    ┌──────────────┼───────────────┐
                                RDS Postgres   ElastiCache      S3 (invoices,
                                (multi-AZ)     Redis (cache,    photos, CSVs)
                                    │           sessions)
                              Read replica → BI/warehouse (Athena/Redshift)
        SQS (async: notifications, ROI recompute, CSV jobs) → worker pods
        SES/WhatsApp Business API for outbound notifications
        CloudWatch + OTel collector → Grafana; WAF in front of ALB
```
CI/CD: GitHub Actions — lint → unit tests → integration tests → build image → push ECR → deploy staging → smoke tests → manual gate → prod (blue/green). DB migrations via `node-pg-migrate`/Prisma migrate, run as pre-deploy job.

**Multi-tenant (Phase 3):** `tenant_id` column on every table + Postgres RLS policies; per-tenant S3 prefixes and KMS keys; tenant-scoped JWT claims; shared-schema pooled tenancy with option to silo large clients.

## 4. Test Strategy

| Layer | Approach | Tooling |
|---|---|---|
| Unit | ROI math (windows, attribution, edge months), CSV validators, RBAC guards | node:test |
| API integration | Spin app against temp SQLite; full lifecycle: login → propose → approve → execute → import CSV → assert ROI | node:test + fetch |
| E2E (Phase 2) | Browser flows per persona | Playwright |
| Performance (Phase 2) | 100k-row CSV import; dashboard under load | k6 |
| Security | authz matrix tests (every route × every role), SQLi/XSS payloads on inputs | node:test + ZAP baseline |
| UAT | Persona scripts (MR day-in-life, HO month-end) | manual checklist |

**Definition of done per module:** unit + integration tests green, RBAC test for every new route, audit row asserted for every state change, docs updated.

Included MVP smoke test: `npm test` boots the server on a scratch DB and exercises the critical path (login as sales → propose → login as HO → approve → execute → CSV import → ROI endpoint returns finite number).
