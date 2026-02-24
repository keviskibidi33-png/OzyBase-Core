# 🗺️ OzyBase Roadmap: The Path to Enterprise & Beyond

OzyBase is a high-performance, single-binary Backend-as-a-Service designed for developers who value simplicity, speed, and standard PostgreSQL power.

---

## 🟢 PHASE 1: The "Círculo Perfecto" (v1.0.0) 🏆
Focus: **Developer Experience (DX) & Zero Config**

- [x] **Zero Config Engine**: Added Embedded PostgreSQL support.
- [x] **Professional SDK**: Official JS/TS SDK released.
- [x] **Automatic Type Safety**: `gen-types` command for TS interfaces.
- [x] **Single Binary**: Backend + Frontend + DB in one executable.

---

## 🔵 PHASE 1.5: Enterprise Readiness (v1.1.0) 🛡️
Focus: **Security, Scaling & Observability**

- [x] **Row Level Security (RLS)**: Native Postgres isolation via JWT context.
- [x] **Hybrid Storage**: S3-Compatible & Local storage providers.
- [x] **Distributed Realtime**: Redis Pub/Sub for multi-node deployments.
- [x] **Observability**: Prometheus metrics & Structured Logging.
- [x] **Social Login**: OAuth2 (GitHub/Google) integration.

---

## 🟡 PHASE 2: Management & Intelligence (Current Focus) 🧠
Focus: **Schema Management & AI**

- [x] **Ozy-Migrations**: Visual schema editor that generates versioned SQL migrations automatically with CLI applier.
- [x] **Frontend TypeScript Migration**: Frontend migrated to strict TypeScript (`@ts-nocheck=0`, `typecheck/build/lint` green).
- [x] **Natural Language Querying (NLQ)**: Native deterministic NLQ implemented (`/api/project/nlq/translate` + `/api/project/nlq/query`) with safe table/column validation and smoke coverage.
- [x] **Vector Support**: Native integration with `pgvector` for RAG applications (status/setup/upsert/search endpoints + smoke validation).
- [x] **MCP Implementation**: Native MCP tool catalog + invoke endpoint (`/api/project/mcp/tools` + `/api/project/mcp/invoke`) wired to health/collections/vector/NLQ tools.

---

## 🔴 PHASE 3: Future Scale & Extensions ⚡
Focus: **Global Infrastructure**

- [x] **WASM Edge Functions**: Native `wasm` runtime for functions with WASI execution (`wazero`), timeout controls, and smoke validation.
- [x] **Extensions Marketplace**: Native catalog + sync + install/uninstall lifecycle with installation state and audit trail.
- [x] **Global SSE Scaling**: Distributed realtime fan-out through Redis PubSub bridge with node-aware deduplication and realtime status endpoint.

---
**Vision**: "PocketBase simplicity, Supabase power, Go performance." 🛡️🚀
