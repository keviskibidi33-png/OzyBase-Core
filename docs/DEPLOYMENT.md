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

# Auth
JWT_SECRET=<64-byte-random-secret>

# Database
DB_USER=ozyuser
DB_PASSWORD=<strong-password>
DB_NAME=Ozydb
DB_SSLMODE=verify-full

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
- Keep DB backups automated and test restore.
- Monitor 4xx/5xx trends and auth failures.

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
- `JWT_SECRET` (required, 64+ random bytes)
- `SITE_URL` (required, e.g. `https://api.example.com`)
- `APP_DOMAIN` (required, e.g. `example.com`)
- `ALLOWED_ORIGINS` (required, comma-separated URLs)
- `DEBUG=false`
- `OZY_STRICT_SECURITY=true` (recommended in production)
- `RATE_LIMIT_RPS`, `RATE_LIMIT_BURST`
- SMTP vars if email flows are needed

### Notes
- Keep PostgreSQL private and use TLS in `DATABASE_URL` (`sslmode=require` or stronger).
- With `OZY_STRICT_SECURITY=true`, startup fails on insecure public DB URLs or wildcard origins.
- Persist volumes:
  - `/app/data`
  - `/app/migrations`
  - `/app/functions`
- Expose internal port `8090` in Coolify and attach your domain.
- Health check endpoint: `/api/health`.

## 10. Rollback Strategy
- Keep image tags immutable per release.
- Roll back by redeploying previous image + validated `.env`.
- If DB schema changed, ensure backward-compatible migrations or restore snapshot.
