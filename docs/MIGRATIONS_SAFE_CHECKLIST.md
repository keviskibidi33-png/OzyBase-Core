# Safe Migration Checklist

Use this before any schema change in production.

## Design
- Prefer additive changes first (`ADD COLUMN`, new tables, new indexes).
- Avoid destructive operations in same release (`DROP COLUMN`, type shrink).
- Ensure code is backward-compatible with old and new schema during rollout.

## SQL Safety
- Use `IF EXISTS` / `IF NOT EXISTS` where possible.
- Add indexes concurrently in large datasets when supported operationally.
- Validate long-running operations impact (locks, rewrite risks).

## Rollout Plan
- Stage: run on staging with production-like volume.
- Measure migration time and lock footprint.
- Prepare rollback SQL before deployment.

## Verification
- Validate `/api/health` SLO block after migration.
- Validate critical queries with `EXPLAIN` where needed.
- Confirm RLS coverage remains complete for user tables.

## Release Gate Requirements
- `go test ./...`
- `npm run lint`
- `npm run build`
- API smoke checks
- Release dry-run in PR
