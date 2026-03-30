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

## ✅ Production Hardening Status (2026-02-24)

- JWT subject validated against `_v_users` on authenticated requests.
- Role/email sourced from DB (not only JWT claims).
- Tokens signed with non-existent user are rejected (`401`).
- URL query token sanitization active in frontend flows.
- Security headers and CSRF secure cookie enabled.
- Docker compose requires critical env vars and includes health checks.
- Rate limiter tuning exposed via env (`RATE_LIMIT_RPS`, `RATE_LIMIT_BURST`).
- Enterprise smoke gate validated in production (`health + system status/setup + CSP + login + API key rotate`).
- Native-only local validation suite validated (`scripts/validate_enterprise.ps1`: backend tests + frontend lint/typecheck/build/bundle + embedded Postgres smoke API + smoke E2E).
- Frontend fully migrated to TypeScript strict (`@ts-nocheck=0`, `npm run typecheck=PASS`, `npm run build=PASS`, `npm run lint=PASS`).
- Native pgvector foundation validated for production flow (`/api/project/vector/status|setup|upsert|search`, smoke with graceful skip when extension is unavailable).
- Native NLQ + MCP layer validated (`/api/project/nlq/translate|query`, `/api/project/mcp/tools|invoke`) with deterministic SQL planning and smoke coverage.
- WASM edge functions validated (`runtime=wasm`, WASI execution, timeout controls, smoke invoke path).
- Extensions marketplace validated (`/api/extensions/marketplace`, sync/install/uninstall lifecycle).
- Global SSE scaling validated (Redis PubSub bridge, node-aware deduplication, `/api/project/realtime/status`).
- Enterprise gates implemented for SLO thresholds, alert routing/on-call, and RLS closeout evidence.

## AI Editor Ready (MCP + NLQ)

Current runtime is ready to integrate with AI editors/agents through native MCP endpoints.
MCP in OzyBase is implemented as a native HTTP runtime inside the API service (shared auth, audit, and DB pool), not as a separate stdio daemon process.

- Standard MCP JSON-RPC endpoint: `POST /api/project/mcp`
- MCP tools catalog: `GET /api/project/mcp/tools`
- MCP tool invoke: `POST /api/project/mcp/invoke`
- MCP collection creation tool: `collections.create` (via `/api/project/mcp/invoke`)
- Direct NLQ translate: `POST /api/project/nlq/translate`
- Direct NLQ query: `POST /api/project/nlq/query`
- Vector runtime status: `GET /api/project/vector/status`

Requirements:
- Admin auth token (Bearer) for project endpoints.
- Production smoke gate in green (`scripts/validate_enterprise.ps1`).

Enterprise release gate:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate_enterprise.ps1
```

VS Code setup:
- Open `Settings > API Keys > MCP Gateway` in OzyBase and reveal the active secret key.
- Copy the generated `.vscode/mcp.json` snippet or see `docs/MCP_VSCODE.md`.
- Use the secret key in the `apikey` header.

Quick verification:

```bash
# 1) Login (replace values)
curl -sS -X POST "https://YOUR_DOMAIN/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@YOUR_DOMAIN","password":"YOUR_PASSWORD"}'

# 2) MCP tools
curl -sS "https://YOUR_DOMAIN/api/project/mcp/tools" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 3) Invoke NLQ via MCP
curl -sS -X POST "https://YOUR_DOMAIN/api/project/mcp/invoke" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool":"nlq.translate","arguments":{"query":"count rows in users","table":"users"}}'
```

## Roadmap Snapshot (2026-02-24)

- Enterprise core (through `L`): completed.
- XL native progress: `pgvector + NLQ + MCP + WASM edge/functions + extensions marketplace + global SSE scaling` completed.
- Roadmap closure status: `100% complete` for the tracked phases in `docs/ROADMAP.md`.
- Source of truth: `docs/ROADMAP.md` and `docs/ROADMAP_EXECUTION_STATUS_2026-02-23.md`.

## Pending Work (Current)

- Roadmap phases tracked in `docs/ROADMAP.md`: `0` pending items.
- Operational recommendation (optional, non-blocking): keep running `scripts/validate_enterprise.ps1` as release gate.

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
go run ./cmd/ozybase
```

### Docker
```bash
docker compose up -d --build
```

### Install-to-play (Postgres incluido)
Use `docker-compose.install.yml`.
Required vars only:
- `SITE_URL`
- `APP_DOMAIN`
- `DB_PASSWORD`
Visible DB vars in Coolify:
- `DB_USER` (default `ozybase`)
- `DB_NAME` (default `ozybase`)
- `DB_SSLMODE` (default `disable`)

### Coolify (managed Postgres)
Use `docker-compose.coolify.yml`.
Only required in Coolify:
- `DATABASE_URL`
- `SITE_URL`
- `APP_DOMAIN`

Install-to-play defaults:
- If `JWT_SECRET` is missing, OzyBase auto-generates it into `.ozy_secret`.
- If `ALLOWED_ORIGINS` is missing, OzyBase derives safe defaults from `SITE_URL` and `APP_DOMAIN`.
- Set `OZY_STRICT_SECURITY=true` in production to fail fast on insecure config.
- `OZY_SKIP_MIGRATIONS_SEED=true` disables seeding `/app/migrations` from the image (advanced).
- `ozybase init` generates strong random secrets for `JWT_SECRET` and `DB_PASSWORD`.
- `ozybase init` auto-adjusts DB TLS mode:
  - local DB host (`db`/`localhost`) -> `sslmode=disable`
  - external DB host -> `sslmode=require`

First admin login:
- `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` can be provided as env vars.
- If `INITIAL_ADMIN_EMAIL` is empty, default is `admin@<APP_DOMAIN>` (or `system@ozybase.local` on localhost).
- If `INITIAL_ADMIN_PASSWORD` is empty, OzyBase generates one and prints it in startup logs once.

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
OZY_REALTIME_BROKER=redis
REDIS_ADDR=127.0.0.1:6379
REDIS_PASSWORD=
REDIS_DB=0
OZY_REALTIME_CHANNEL=ozy_events_cluster
OZY_REALTIME_NODE_ID=node-a
DEBUG=false
```

## 📚 Documentation

- Deployment Runbook: `docs/DEPLOYMENT.md`
- Deployment Profiles: `docs/DEPLOYMENT_PROFILES.md`
- Performance Benchmarks: `docs/PERFORMANCE_BENCHMARKS.md`
- Security Suite: `docs/SECURITY_SUITE.md`
- Security Notifications: `docs/SECURITY_NOTIFICATIONS.md`
- Project Status: `docs/PROJECT_STATUS_MASTER.md`
- Roadmap: `docs/ROADMAP.md`
- Changelog: `CHANGELOG.md`

Developed by **Xangel0s**.
