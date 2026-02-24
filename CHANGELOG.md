# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0-XL] - 2026-02-24

### Added

- Native WASM Edge Functions runtime (`runtime=wasm`) with WASI execution (`wazero`), timeout controls, and invoke support.
- Extensions Marketplace API with catalog sync and install/uninstall lifecycle:
  - `GET /api/extensions/marketplace`
  - `POST /api/extensions/marketplace/sync`
  - `POST/DELETE /api/extensions/marketplace/:slug/install`
- Global SSE scaling via distributed Redis PubSub bridge with node-aware deduplication and realtime status endpoint:
  - `GET /api/project/realtime/status`

### Changed

- Enterprise smoke suite now validates realtime status, marketplace flows, and wasm edge-function invoke path.
- Roadmap tracking updated to mark XL closure (`pgvector + NLQ + MCP + WASM + marketplace + global SSE`) as completed.
- README updated with AI-editor readiness summary and final roadmap snapshot (`0` pending items).

## [1.2.1] - 2026-02-20

### Added

- Production deployment runbook expanded with domain, TLS, rate-limit, and auth-hardening validation steps (`docs/DEPLOYMENT.md`).
- Production hardening summary and operational validation commands documented in `README.md`.

### Changed

- `AuthMiddleware` now validates JWT `user_id` against `_v_users` and sources `role/email` from database.
- Docker Compose now exposes rate limiter knobs: `RATE_LIMIT_RPS`, `RATE_LIMIT_BURST`.
- API key creation now safely handles empty `workspace_id` as `NULL` (no UUID cast failure).

### Fixed

- Rejected signed JWTs that reference non-existent users (returns `401` instead of authorizing access).
- Stabilized Create Table flow and updated E2E token fixture to a real admin user.
- Audit logging now ignores non-UUID identities for `user_id` persistence, avoiding runtime insert errors.

## [1.2.0-Enterprise] - 2026-02-16

### Added

- **Multi-Tenancy (Workspaces)**: Complete isolation for projects with scoped collections, API keys, and configurations.
- **MFA (Multi-Factor Authentication)**: Integrated TOTP support with multi-step login flow in the Dashboard.
- **Session Management**: Persistent tracking of active logins with metadata (IP, UserAgent) and remote revocation dashboard.
- **Table Creator 2.0**: Support for Custom Primary Keys, Foreign Key UI, and per-table Realtime toggles.
- **Advanced Observability**:
  - Interactive Log Explorer with Trace ID tracking and Geolocation.
  - Status distribution (Success Rate) and Latency trend visualization.
  - Canonical CSV Export for audit logs and traffic data.
- **Enterprise Security Hardening**:
  - Native Postgres RLS with integrated `auth.uid()` helper.
  - X-Workspace-Id header support for automatic API scoping.
  - Go 1.24 performance baseline and dependency cleanup.

### Fixed

- Resolved multiple React Hook warnings and cascading state updates in `Layout` and `WorkspaceSwitcher`.
- Fixed unused variables and lint errors in `Login` and `AuthManager`.
- Optimized bulk record ingestion via `pgx.CopyFrom` in `internal/data`.

## [1.1.0-Enterprise] - 2026-02-05

### Added

- **Ozy-Migrations**: Automatic migration generation from Dashboard UI changes.
- **Ozy-Apply**: CLI tool (`migrate-apply`) to apply pending SQL migrations from the local `./migrations` directory.
- **Native Row Level Security (RLS)**: Context injection into Postgres transactions via JWT claims (`request.jwt.claim.sub`).
- **Hybrid Storage**: Support for S3-Compatible backends (Minio, AWS, etc.) and Local storage.
- **Distributed Realtime**: Redis Pub/Sub integration for multi-node event broadcasting.
- **Prometheus Observability**: `/metrics` endpoint with counters for HTTP and DB operations.
- **OAuth Social Login**: Built-in support for GitHub and Google authentication.
- **Advanced Migrations**: Included mission-critical tables for OAuth identities, reset tokens, and verification tokens.

### Changed

- Refactored `internal/data/records.go` to use `WithTransactionAndRLS` for all CRUD operations, enabling native Postgres security policies.
- Enhanced API Handler with dependency injection for Storage, PubSub, and Migrator providers.

## [1.0.0] - 2026-02-04

### Added

- **Embedded PostgreSQL**: Zero-config "Install to Play" engine.
- **JS/TS SDK**: Official library for Supabase-style interaction.
- **Type Generator**: CLI command `gen-types` to export TypeScript interfaces.
- **Embedded Frontend**: React/Vite dashboard baked into the Go binary.
- **Internal Analytics**: Real-time traffic and geolocation monitoring.

---

**OzyBase: Power in a single binary.** 🛡️🚀
