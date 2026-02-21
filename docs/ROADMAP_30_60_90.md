# OzyBase 30/60/90 Roadmap (Production Scale)

## Scope
This roadmap focuses on enterprise readiness for self-hosted and Coolify deployments:
- Security hardening
- Release reliability
- Runtime resilience
- Frontend and API quality gates

## Day 0 Baseline (Current)
- Single-binary backend with PostgreSQL
- Setup wizard-first initialization flow
- API keys, RLS tools, security headers, rate limits
- GitHub Actions + GoReleaser pipelines in place

### Recent Progress (Security/Enterprise)
- RLS policy builder now supports per-action rules (`select/insert/update/delete`).
- Formal RLS expression validation runs before policy creation and returns stable `error_code` values.
- API key lifecycle is now auditable with `_v_api_key_events` (create/rotate/toggle/delete).
- API keys now persist ownership metadata (`created_by_user_id`) for accountability.

---

## 0-30 Days (Stabilize Core)

### 1. Release and CI Reliability
- Standardize CI gates: `go test ./...`, `npm run build`, lint, and security checks.
- Add release dry-run on PR and signed release on tags.
- Define rollback checklist for failed production deployments.

Done when:
- No release can be published without passing CI gates.
- Tag-to-release flow is reproducible in under 10 minutes.

### 2. Security Baseline v1
- Enforce strict key policy: `ANON_KEY`, `SERVICE_ROLE_KEY`, rotation cadence.
- Keep CSP allowlist minimal and explicit.
- Add session revocation drill and incident response runbook.

Done when:
- Secrets rotate without downtime.
- CSP violations are zero on main dashboard paths.

### 3. Install-to-Play DX
- Document required env vars by deployment type:
  - Internal DB stack
  - External managed Postgres
- Add startup diagnostics that point to misconfigured env quickly.

Done when:
- Fresh install reaches healthy state in one deploy cycle.
- First admin setup works without manual DB shell operations.

---

## 31-60 Days (Scale Safely)

### 1. Database and RLS Maturity
- Audit all user-facing tables for RLS policies.
- Add query tuning pass for heavy endpoints (`/api/project/info`, logs, table browsing).
- Add index verification checklist and migration safety checks.

Done when:
- P95 API latency improves and stays within target.
- RLS coverage is complete for app tables in production.

### 2. Runtime Resilience
- Add graceful degradation for external dependencies.
- Improve structured error envelope with stable error codes.
- Add health endpoint depth checks (DB, migrations, storage).

Done when:
- On dependency partial failure, core API still serves critical routes.
- Operators can identify startup failures in <5 minutes from logs.

### 3. Frontend Quality and E2E
- Stabilize E2E for setup/login/workspaces/SQL editor/security panels.
- Add smoke suite for deploy validation.
- Add bundle checks to prevent uncontrolled growth.

Done when:
- Smoke suite passes after each production deploy.
- No critical dashboard workflow lacks an E2E test.

---

## 61-90 Days (Enterprise Operations)

### 1. Observability and SLOs
- Define service SLOs (availability, latency, error budget).
- Add dashboards for auth, DB, storage, and rate-limit impact.
- Add alert routing and on-call response templates.

Done when:
- SLOs are measurable and alert thresholds are actionable.

### 2. Security Program v2
- Formal key lifecycle with owner, TTL, rotation, and revocation logs.
- Harden admin-only operations with auditable trails.
- Add quarterly hardening checklist (CSP, headers, RLS, secret rotation).

Done when:
- Security controls are auditable and repeatable per environment.

### 3. Deployment Maturity
- Blue/green or canary strategy for zero-downtime updates.
- Automated rollback conditions.
- Disaster recovery test (backup + restore drill).

Done when:
- Deployment and recovery are both validated by drills.

---

## Validation Plan (How to Put This Roadmap to Test)

Run this sequence in CI and before production deploy:

```bash
go test ./...
cd frontend && npm ci && npm run build
```

Operational checks after deploy:
1. `GET /api/health` returns healthy.
2. Setup wizard / login flow works as expected.
3. SQL editor loads with no CSP console violations.
4. Dashboard geolocation flags render without CSP blocks.
5. Key operations (`rotate`, `revoke-all-sessions`) succeed with audit trail.

## KPIs
- Failed release rate
- Mean time to recovery (MTTR)
- P95 API latency
- CSP violation count
- Percentage of app tables with enforced RLS
- Secret rotation compliance rate
