# OzyBase Core 🛡️🚀

<div align="center">
  <img src="https://raw.githubusercontent.com/Xangel0s/OzyBase/main/docs/banner.jpg" alt="OzyBase Banner" width="100%" />
  <br/>
  <b>The high-performance, open-source Backend-as-a-Service (BaaS) for the next generation of apps.</b>
  <br/><br/>
  <p>
    <a href="https://goreportcard.com/report/github.com/Xangel0s/OzyBase"><img src="https://img.shields.io/badge/Go%20Report-A%2B-brightgreen.svg" alt="Go Report Card"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License MIT"></a>
    <a href="#"><img src="https://img.shields.io/badge/Single-Binary-blueviolet.svg" alt="Single Binary"></a>
    <a href="https://github.com/Xangel0s/OzyBase/releases/tag/v1.1.0-Enterprise"><img src="https://img.shields.io/badge/Latest%20Tag-v1.1.0--Enterprise-blue.svg" alt="Latest Tag"></a>
    <a href="./docs/DEPLOYMENT.md"><img src="https://img.shields.io/badge/Production%20Smoke-Validated-success.svg" alt="Production Smoke Validated"></a>
  </p>
</div>

---

## ⚡ PocketBase Simplicity, Supabase Power

OzyBase is a high-performance, single-binary BaaS for authentication, dynamic collections, realtime subscriptions, and file storage with zero-friction deployment.

## ✅ Production Hardening Status (2026-02-20)

- JWT subject validated against `_v_users` on authenticated requests.
- Role/email sourced from DB (not only JWT claims).
- Tokens signed with non-existent user are rejected (`401`).
- API keys remain valid for protected routes.
- URL query token sanitization active in frontend flows.
- Security headers and CSRF secure cookie enabled.
- Docker compose requires critical env vars and includes health checks.
- Rate limiter tuning exposed via env (`RATE_LIMIT_RPS`, `RATE_LIMIT_BURST`).

## 🚀 Quick Start

### Install (latest release)
```bash
curl -fsSL https://raw.githubusercontent.com/Xangel0s/OzyBase/main/scripts/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/Xangel0s/OzyBase/main/scripts/install.ps1 | iex
```

### Local
```bash
git clone https://github.com/Xangel0s/OzyBase.git
cd OzyBase-Core
go run ./cmd/OzyBase
```

### Docker
```bash
docker compose up -d --build
```

### Coolify (managed Postgres)
Use `docker-compose.coolify.yml` and set `DATABASE_URL` + required auth/domain env vars in Coolify.

Install-to-play defaults:
- If `JWT_SECRET` is missing, OzyBase auto-generates it into `.ozy_secret`.
- If `ALLOWED_ORIGINS` is missing, OzyBase derives safe defaults from `SITE_URL` and `APP_DOMAIN`.
- Set `OZY_STRICT_SECURITY=true` in production to fail fast on insecure config.

### CLI utility commands
```bash
ozybase init
ozybase version
ozybase upgrade
ozybase functions init hello
```

## 🔐 Required Environment Variables

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

## 📚 Documentation

- Deployment Runbook: `docs/DEPLOYMENT.md`
- Security Suite: `docs/SECURITY_SUITE.md`
- Security Notifications: `docs/SECURITY_NOTIFICATIONS.md`
- Project Status: `docs/PROJECT_STATUS_MASTER.md`
- Roadmap: `docs/ROADMAP.md`
- Changelog: `CHANGELOG.md`

Developed by **Xangel0s**.
