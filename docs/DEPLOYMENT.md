# OzyBase Production Deployment Guide

This guide is the canonical runbook to deploy OzyBase in production with Docker, domain, TLS, and hardened auth behavior.

## 1. Architecture
- `ozybase` container serves API + embedded frontend on port `8090`.
- `ozybase-db` container runs PostgreSQL 15.
- Reverse proxy (Nginx/Caddy/Traefik) terminates TLS and forwards to OzyBase.
- PostgreSQL should remain private (no public host port exposure in production).

## 2. Prerequisites
- Docker Engine + Docker Compose v2
- Public domain (example: `api.example.com`)
- DNS control (A/AAAA records)
- TLS certificates (Let's Encrypt recommended)
- Backup strategy for PostgreSQL data volume

## 3. Required Environment Variables
Create a local `.env` beside `docker-compose.yml` and never commit it.

```env
# Core
PORT=8090
SITE_URL=https://api.example.com
APP_DOMAIN=example.com
ALLOWED_ORIGINS=https://app.example.com,https://api.example.com
DEBUG=false
OZYBASE_IMAGE=ghcr.io/xangel0s/ozybase:v1.2.3

# Auth
JWT_SECRET=<64-byte-random-secret>
ANON_KEY=<optional-static-anon-key>
SERVICE_ROLE_KEY=<optional-static-service-key>
ANON_KEY_PREVIOUS=<optional-previous-anon-key>
SERVICE_ROLE_KEY_PREVIOUS=<optional-previous-service-key>
STATIC_KEY_GRACE_UNTIL=2026-12-31T23:59:59Z
API_KEY_ROTATION_GRACE_MINUTES=15

# Database
DB_USER=ozyuser
DB_PASSWORD=<strong-password>
DB_NAME=Ozydb
DB_SSLMODE=verify-full
DB_POOLER_URL=<recommended-pgbouncer-or-supavisor-url>

# Rate limiter
RATE_LIMIT_RPS=20
RATE_LIMIT_BURST=20

# Optional SMTP
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@example.com
```

Required by compose:
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `JWT_SECRET`
- `SITE_URL`
- `APP_DOMAIN`

Recommended for production:
- `DB_POOLER_URL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`
- `ALLOWED_ORIGINS`

## 4. Deploy
```bash
docker compose up -d --build
```

Verify:
```bash
docker ps
curl -i http://localhost:8090/api/health
```

Expected:
- Both containers healthy.
- `/api/health` returns `200`.
- Security headers are present.

Canary/rollback-capable mode (immutable image tag, no local build):
```bash
OZYBASE_IMAGE=ghcr.io/xangel0s/ozybase:v1.2.3 docker compose up -d --no-build
```

### 4.1 Canary Deploy With Automatic Rollback
Use this for production rollouts to avoid direct cutover:

```bash
export CANDIDATE_IMAGE=ghcr.io/xangel0s/ozybase:v1.2.4
export ENV_FILE=.env
export COMPOSE_FILE=docker-compose.yml
export PRODUCTION_PORT=8090
export CANARY_PORT=18090
bash scripts/deploy_canary.sh
```

What the script does:
1. Launches candidate image in a temporary canary container on `CANARY_PORT`.
2. Waits for `GET /api/health` and runs `scripts/canary_verify.sh` (non-destructive checks).
3. Runs mandatory post-deploy smoke gate (`scripts/smoke_post_deploy.sh`) on canary:
   `health + setup/login + CSP + API key rotation`.
4. Promotes candidate with `docker compose up -d --no-build`.
5. Runs verify + post-deploy smoke gate on production target.
6. If post-promotion health/verify/smoke fails, rolls back automatically to previous image.

Optional verification credentials:
- `CANARY_SERVICE_ROLE_KEY` (recommended)
- or `CANARY_ADMIN_EMAIL` + `CANARY_ADMIN_PASSWORD`

Required for post-deploy smoke gate:
- `SMOKE_ADMIN_EMAIL`
- `SMOKE_ADMIN_PASSWORD`

### 4.2 Disaster Recovery Drill (Backup + Restore)
Run this drill regularly (for example weekly/monthly) and before risky migrations:

```bash
export COMPOSE_FILE=docker-compose.yml
export ENV_FILE=.env
export DB_SERVICE=db
bash scripts/disaster_drill.sh
```

What the script does:
1. Ensures DB service is running and healthy.
2. Inserts a recovery marker into `_v_disaster_drill_markers`.
3. Creates a PostgreSQL backup (`pg_dump -Fc`) with checksum evidence.
4. Restores into an isolated temporary database.
5. Verifies the marker exists after restore and writes evidence JSON.

Evidence output:
- Folder: `artifacts/disaster-drill/<run_id>/`
- Report: `artifacts/disaster-drill/<run_id>/report.json`

Useful flags:
- `KEEP_BACKUP=false` to avoid storing large dump files after verification.
- `VERIFY_API_HEALTH=true` and `APP_HEALTH_URL=http://127.0.0.1:8090/api/health` to add app health check.
- `RESTORE_DB_NAME=<custom_name>` for controlled restore DB naming.

GitHub Actions manual drill:
- Workflow: `.github/workflows/disaster-drill.yml`
- Trigger with `workflow_dispatch` on your deployment runner (`self-hosted`).

## 5. Domain and TLS
1. Point `api.example.com` to your server IP.
2. Configure reverse proxy to upstream `http://127.0.0.1:8090`.
3. Issue TLS certs and enforce HTTPS redirect.
4. Keep HSTS enabled only after cert is stable.

Minimal Nginx upstream example:
```nginx
server {
  listen 443 ssl http2;
  server_name api.example.com;

  ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8090;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

## 6. Security Behavior to Expect
- JWT subject is validated in DB on each authenticated request.
- Tokens with non-existent users are rejected (`401`).
- Role/email are loaded from DB (claims are not trusted as final source).
- API keys continue to access protected endpoints when valid and active.
- URL query tokens are sanitized in frontend auth flows (`verify-email`, `reset-password`, invalid `?token=`).
- SQL execution endpoint is admin-only.

## 7. Production Validation Checklist
Run this before going live:

1. Backend and frontend tests
```bash
go test ./...
cd frontend && npx playwright test --reporter=line
```

2. Header and cookie checks
```bash
curl -i https://api.example.com/api/health
```
Confirm:
- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- CSRF cookie includes `HttpOnly; Secure; SameSite=Strict`

3. Auth rejection check (invalid subject)
- Send a JWT signed with your secret but pointing to non-existent `user_id`.
- Expected response: `401`.

4. Admin/role gate check
- Validate non-admin token receives `403` on `/api/sql`.

5. Rate limiting sanity
- Confirm `RATE_LIMIT_RPS` / `RATE_LIMIT_BURST` match expected traffic profile.

## 8. Observability and Operations
- Liveness endpoint: `/api/health`
- Keep structured logs shipped to a central sink.
- Keep DB backups automated and run `bash scripts/disaster_drill.sh` regularly.
- Monitor 4xx/5xx trends and auth failures.

## 8.1 Azure Production Path
For Azure Container Apps or another stateless cloud runtime:
- Use external PostgreSQL, not the embedded database.
- Set `JWT_SECRET`, `ANON_KEY`, and `SERVICE_ROLE_KEY` explicitly from a secret manager.
- Set `DB_POOLER_URL` when fronting PostgreSQL with PgBouncer/Supavisor.
- Use real `SITE_URL` and `APP_DOMAIN` values over HTTPS.
- Configure SMTP for verification, reset, and workspace invites.
- See [Azure Production Guide](./AZURE_PRODUCTION.md).

## 9. Common Production Mistakes
- Committing `.env` or secrets files.
- Leaving default/weak `JWT_SECRET`.
- Exposing PostgreSQL to public internet.
- Overly strict `ALLOWED_ORIGINS` mismatch causing frontend auth failures.
- Running with `DEBUG=true` in production.

## 11. Coolify Deployment (Recommended)
Use `docker-compose.coolify.yml` with a managed PostgreSQL service.

### Variables to set in Coolify
- `DATABASE_URL` (required)
- `DB_POOLER_URL` (recommended)
- `DEBUG=false`
- `OZY_STRICT_SECURITY=true` (recommended in production)
- `OZY_STORAGE_FALLBACK_LOCAL=true` (recommended, fail-open to local storage if S3 init fails)
- `API_KEY_ROTATION_GRACE_MINUTES=15` (default grace for DB API key rotation)
- `ANON_KEY_PREVIOUS` / `SERVICE_ROLE_KEY_PREVIOUS` (optional for static key cutover)
- `STATIC_KEY_GRACE_UNTIL` (RFC3339 timestamp for previous static keys)
- `RATE_LIMIT_RPS`, `RATE_LIMIT_BURST`
- SMTP vars if email flows are needed

Auto defaults in Coolify compose:
- `JWT_SECRET`: not set in compose. OzyBase auto-generates and stores it in `.ozy_secret`.
- `ALLOWED_ORIGINS`: not set in compose. OzyBase derives safe origins from `SITE_URL` and `APP_DOMAIN`.
- `SITE_URL`: defaults to `https://api.example.com` if unset.
- `APP_DOMAIN`: defaults to `example.com` if unset.
- `INITIAL_ADMIN_EMAIL`: optional. If empty, defaults to `admin@<APP_DOMAIN>`.
- `INITIAL_ADMIN_PASSWORD`: optional. If empty, generated once and printed in startup logs.

### Notes
- Keep PostgreSQL private and use TLS in `DATABASE_URL` (`sslmode=require` or stronger).
- Set `DB_POOLER_URL` when your managed PostgreSQL provider exposes a pooler endpoint.
- With `OZY_STRICT_SECURITY=true`, startup fails on insecure public DB URLs or wildcard origins.
- With `OZY_STORAGE_FALLBACK_LOCAL=true`, startup falls back to local storage if S3 is unavailable.
- During static key rotation, previous keys are accepted only until `STATIC_KEY_GRACE_UNTIL`.
- `OZY_SKIP_MIGRATIONS_SEED=true` skips copying `/app/migrations` from the image into the mounted volume.
- Persist volumes:
  - `/app/data`
  - `/app/migrations`
  - `/app/functions`
- Expose internal port `8090` in Coolify and attach your domain.
- Health check endpoint: `/api/health`.

## 12. Install-to-Play Deployment (DB + App Together)
Use `docker-compose.install.yml` when you want OzyBase + Postgres in one stack.

Required variables:
- `SITE_URL`
- `APP_DOMAIN`
- `DB_PASSWORD`

Everything else has safe defaults.

Visible DB variables in Coolify (install stack):
- `DB_USER` (default: `ozybase`)
- `DB_PASSWORD` (required)
- `DB_NAME` (default: `ozybase`)
- `DB_SSLMODE` (default: `disable`)
- `API_KEY_ROTATION_GRACE_MINUTES` (default: `15`)
- `ANON_KEY_PREVIOUS` / `SERVICE_ROLE_KEY_PREVIOUS` (optional)
- `STATIC_KEY_GRACE_UNTIL` (optional RFC3339)
- `INITIAL_ADMIN_EMAIL` (optional)
- `INITIAL_ADMIN_PASSWORD` (optional)

`DATABASE_URL` is built automatically in compose from DB vars:
`postgres://${DB_USER:-ozybase}:${DB_PASSWORD}@db:5432/${DB_NAME:-ozybase}?sslmode=${DB_SSLMODE:-disable}`

Start:
```bash
SITE_URL=https://api.example.com APP_DOMAIN=example.com DB_PASSWORD='<strong-password>' docker compose -f docker-compose.install.yml up -d --build
```

You can generate the env file automatically:
```bash
ozybase init --output .env
```
This command creates:
- `JWT_SECRET` (strong random)
- `DB_PASSWORD` (strong random)
- sensible default domains (`SITE_URL=https://api.example.com`, `APP_DOMAIN=example.com`)

## 13. Integration Delivery Queue (Retry + DLQ)
- Webhook/SIEM deliveries are queued in `_v_integration_deliveries`.
- Automatic retries use exponential backoff.
- Failed deliveries that exhaust retries move to DLQ.
- Admin endpoints:
  - `GET /api/project/integrations/metrics`
  - `GET /api/project/integrations/dlq`
  - `POST /api/project/integrations/dlq/:id/retry`

## 14. Performance Advisor (EXPLAIN Sampling)
- Endpoint: `GET /api/project/performance/advisor`
- Uses hot-paths from `_v_audit_logs`, runs EXPLAIN samples, returns index recommendations.
- History endpoint: `GET /api/project/performance/advisor/history`

## 10. Rollback Strategy
- Keep image tags immutable per release.
- Roll back by redeploying previous image + validated `.env`.
- If DB schema changed, ensure backward-compatible migrations or restore snapshot.
- Preferred automated path: `bash scripts/deploy_canary.sh` (handles rollback automatically on failed health/verify).
