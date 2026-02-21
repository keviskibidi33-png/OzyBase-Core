# Release Rollback Checklist

Use this checklist whenever a production release shows regressions.

## 1. Detect and Triage
- Confirm incident scope: API errors, auth failures, storage failures, migration failures.
- Capture `request_id` samples from failing requests.
- Freeze further deploys until rollback decision is made.

## 2. Rollback Decision Gate
- Rollback immediately if any of these are true:
  - Health endpoint reports degraded on DB or migrations.
  - Login/setup critical path is failing.
  - Data writes fail for core tables.
- Continue forward-fix only if impact is minor and isolated.

## 3. Execute Rollback
- Re-deploy previous stable tag from releases.
- Confirm runtime env vars still match previous release expectations.
- If schema migration is backward-incompatible, apply pre-created rollback migration.

## 4. Verify Recovery
- Run smoke checks:
  - `GET /api/health`
  - `GET /api/system/status`
  - login flow
  - basic CRUD on a user table
- Confirm error envelope still includes `error`, `error_code`, and `request_id`.

## 5. Post-Rollback Actions
- Open incident with timeline and root cause hypothesis.
- Create corrective tasks before next release:
  - add/adjust tests
  - improve migration safety
  - improve feature flag/guardrail
- Publish user-facing status update.
