# OzyBase Core

OzyBase Core is a Go + PostgreSQL Backend-as-a-Service focused on low operational cost, fast deployment, and strong production security defaults.

## What You Get
- Authentication (email/password, OAuth, sessions, 2FA)
- Dynamic collections and table management from UI
- Realtime events and webhooks
- File storage (local and S3-compatible)
- Workspaces (multi-tenant isolation)
- SQL terminal with admin-only enforcement
- Integrated security dashboard and audit trails

## Production Hardening Status (2026-02-20)
This repository includes the following production hardening changes already applied and validated:

- JWT hardening:
  - JWT subject (`user_id`) is validated against `_v_users` on every authenticated request.
  - Role and email are sourced from DB (not trusted only from JWT claims).
  - Tokens signed with valid secret but non-existent `user_id` are rejected with `401`.
- API key compatibility:
  - API keys continue working for protected routes.
  - `workspace_id` handling is safe when empty (`NULL`, no UUID cast errors).
- URL token safety in frontend:
  - Invalid `?token=` is removed from URL and not persisted.
  - `verify-email` and `reset-password` flows sanitize query tokens from URL.
- Security headers and cookies:
  - CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
  - CSRF cookie with `HttpOnly`, `Secure`, `SameSite=Strict`.
- Docker/deploy hardening:
  - Required env vars enforced in `docker-compose.yml`.
  - Health checks enabled for app and DB.
  - Rate limiting env exposed and configurable.
- Reliability fixes:
  - `CreateTableModal` flow stabilized.
  - Audit log insertion handles non-UUID identities safely.

## Install to Play
### Local
```bash
git clone https://github.com/Xangel0s/OzyBase.git
cd OzyBase-Core
go run ./cmd/OzyBase
```

### Docker (recommended)
```bash
docker compose up -d --build
```

See `docs/DEPLOYMENT.md` for full production setup with domain and TLS.

## Required Environment Variables
Use `.env` (never commit it):

```env
PORT=8090
SITE_URL=https://api.example.com
APP_DOMAIN=example.com
ALLOWED_ORIGINS=https://app.example.com,https://api.example.com
JWT_SECRET=<64-byte-random-secret>

DB_USER=ozyuser
DB_PASSWORD=<strong-password>
DB_NAME=Ozydb
DB_SSLMODE=verify-full

RATE_LIMIT_RPS=20
RATE_LIMIT_BURST=20
DEBUG=false
```

## Production Validation Commands
```bash
# build/test backend
go test ./...

# frontend e2e
cd frontend
npx playwright test --reporter=line

# health and security headers
curl -i http://localhost:8090/api/health
```

## Main Docs
- Deployment runbook: `docs/DEPLOYMENT.md`
- Security suite: `docs/SECURITY_SUITE.md`
- Notifications and alerting: `docs/SECURITY_NOTIFICATIONS.md`
- Project status: `docs/PROJECT_STATUS_MASTER.md`
- Roadmap: `docs/ROADMAP.md`
- Changelog: `CHANGELOG.md`
