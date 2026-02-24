# Disaster Recovery Drill Runbook

This runbook validates database recoverability using a repeatable backup+restore drill.

## Goal
- Prove backups can be restored.
- Capture objective evidence (`report.json`) per drill run.

## Prerequisites
- Docker Engine + Docker Compose v2
- Running stack with PostgreSQL service (`db` by default)
- Read access to your deployment `.env`

## Run (manual)
```bash
export COMPOSE_FILE=docker-compose.yml
export ENV_FILE=.env
export DB_SERVICE=db
bash scripts/disaster_drill.sh
```

Optional controls:
- `KEEP_BACKUP=false` removes dump file after verification.
- `VERIFY_API_HEALTH=true` enables `curl` check to `APP_HEALTH_URL`.
- `RESTORE_DB_NAME=drill_restore_manual` sets explicit restore DB name.
- `DRILL_RUN_ID=prod-2026-02-23` sets deterministic evidence folder.

## What Gets Verified
1. DB container is reachable and healthy.
2. Marker row is inserted into `_v_disaster_drill_markers`.
3. Backup is created via `pg_dump -Fc`.
4. Backup restores into isolated temp DB.
5. Marker row exists in restored DB (recovery proof).

## Evidence
Per run, the script writes:
- `artifacts/disaster-drill/<run_id>/database.dump` (if `KEEP_BACKUP=true`)
- `artifacts/disaster-drill/<run_id>/report.json`

Key report fields:
- `status`: `pass` or `failed`
- `failure_reason`
- `backup_sha256`
- `backup_size_bytes`
- `marker_restore_count`
- `duration_seconds`

## Automation
- GitHub Actions workflow: `.github/workflows/disaster-drill.yml`
- Trigger: `workflow_dispatch`
- Runner: `self-hosted`
- Artifact retention: 30 days

## Cadence
- Minimum: monthly
- Required: before high-risk schema/migration releases
- Required: after any restore-related incident
