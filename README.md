# OzyBase Core 🛡️🚀

<div align="center">
  <img src="https://raw.githubusercontent.com/Xangel0s/OzyBase/main/docs/banner.jpg" alt="OzyBase Banner" width="100%" />
  <br/>
  <b>The high-performance, open-source Backend-as-a-Service (BaaS) for the next generation of apps.</b>
  <br/><br/>
  <p>
    <a href="https://goreportcard.com/report/github.com/Xangel0s/OzyBase"><img src="https://img.shields.io/badge/Go%20Report-A%2B-brightgreen.svg" alt="Go Report Card A+"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
    <a href="#"><img src="https://img.shields.io/badge/Single-Binary-blueviolet.svg" alt="Single Binary"></a>
    <a href="#"><img src="https://img.shields.io/badge/v1.2.0-Enterprise-brightgreen.svg" alt="Version"></a>
  </p>
</div>

---

## ⚡ PocketBase Simplicity, Supabase Power

OzyBase is a high-performance, single-binary BaaS that allows you to manage authentication, dynamic collections, real-time subscriptions, and file storage with **zero configuration**. It is designed to run perfectly on a $5/mo VPS while providing enterprise-grade security and scalability.

### 📊 Comparative Performance

| Metric          | Supabase (Docker) |  PocketBase   |     **OzyBase-Core**     |
| :-------------- | :---------------: | :-----------: | :----------------------: |
| **Language**    |   Elixir/JS/Go    |      Go       |        **Go 🚀**         |
| **RAM at rest** |      ~1.5 GB      |   ~20-50 MB   |      **< 30 MB ✅**      |
| **Binary size** |  ~2 GB (Images)   |    ~40 MB     |      **< 15 MB 💎**      |
| **Database**    |     Postgres      |    SQLite     | **Postgres (Native) 🐘** |
| **Deployment**  |      Complex      | Single Binary |   **Single Binary 📦**   |

---

## ✨ Enterprise Features (v1.1.0) 🛡️

OzyBase Core has evolved. The **v1.1.0-Enterprise** update brings mission-critical capabilities to your pocket backend:

- **🔐 Native RLS Engine**: Real PostgreSQL **Row-Level Security** with `auth.uid()` integration. Enforce security policies directly in the database.
- **🏢 Multi-Tenancy (Workspaces)**: Complete isolation for projects with scoped collections, API keys, and configurations.
- **🛡️ Security Depth**: Multi-Factor Authentication (MFA), Persistent Session Tracking, and Remote Revocation.
- **📊 Advanced Observability**: Log Explorer with Trace ID tracking, Geolocation, and Donut charts for success rates.
- **📂 Hybrid Storage**: Seamlessly switch between **Local Storage** and **S3-Compatible** backends (Minio, AWS, DigitalOcean).
- **⚡ Distributed Realtime**: Real-time events synchronized across nodes via **Redis Pub/Sub** for horizontal scaling.
- **🧙 Table Creator 2.0**: UI-driven Foreign Keys, Custom Primary Keys, and Per-Table Realtime toggles.
- **📈 Prometheus Observability**: Built-in `/metrics` endpoint (Go Stats + Custom Metrics) for real-time monitoring.
- **🤝 OAuth & Social Sync**: Multi-provider support (GitHub & Google) out of the box with `goth`.

---

## 🧙 The Perfect Circle (DX-First Workflow)

1. **Auto-Config Backend**: Embedded PostgreSQL starts automatically. No Docker needed for local development.
2. **Dynamic Dashboard**: Create tables and fields via UI; Ozy-Migrations handles the SQL records for you.
3. **Type-Safe Frontend**: Use the **JS/TS SDK** and run `gen-types` to get full TypeScript autocomplete instantly.

---

## 🚀 Quick Start (Production & Local)

### 1. Requirements

OzyBase is **Install to Play**. You only need [Go 1.23+](https://go.dev/) if running from source, or download the binary for your platform.

### 2. Local Installation

```bash
git clone https://github.com/Xangel0s/OzyBase
cd OzyBase
go run ./cmd/ozybase
```

_The first run downloads the Embedded PostgreSQL engine (~20MB) and starts the Setup Wizard at `http://localhost:8090`._

### 3. Docker Deployment (Recommended)

```bash
docker pull xangel0s/ozybase:latest
docker run -p 8090:8090 -v ozy_data:/app/data xangel0s/ozybase
```

_Check our [Dockerfile](./Dockerfile) and [Deployment Guide](./docs/DEPLOYMENT.md) for advanced multi-node configurations._

### 4. CLI Commands

- `ozybase.exe reset-admin "newpassword"`: Reset access to the dashboard.
- `ozybase.exe migrate-apply`: Sync pending SQL migrations from `./migrations`.
- `ozybase.exe gen-types`: Export TypeScript interfaces from your DB.

---

## 💎 OzyBase SDK

Manage your data with a clean, Supabase-style interface:

```typescript
import { createClient } from "@ozybase/sdk";

const ozy = createClient("http://localhost:8090");

// Realtime & Security in 3 lines
ozy
  .from("orders")
  .select("*")
  .on("INSERT", (payload) => console.log(payload))
  .subscribe();
```

---

## 🗺️ Roadmap & Community

We are currently in **Fase 2: Management & Intelligence**.

- [x] v1.2.0 Enterprise Readiness (Multi-Tenancy, MFA, Sessions, RLS).
- [x] Advanced Observability & Audit Logs.
- [x] Table Creator 2.0 (Relational Integrity).
- [ ] **Ozy-AI**: Natural Language Querying (NLX) for SQL.
- [ ] **Vector Support**: Native `pgvector` integration.
- [ ] **MCP Implementation**: Context server for AI coding assistants.

---

## 📚 Detailed Documentation

- [🏗️ Full Roadmap & Status](./docs/ROADMAP.md)
- [🛡️ Security Audit & Hardening](./docs/SECURITY_AUDIT.md)
- [📦 Deployment & Multi-Arch Build](./docs/DEPLOYMENT.md)
- [🎨 Branding & Design System](./docs/branding.md)
- [📜 Changelog](./CHANGELOG.md)

Developed with ❤️ by **Xangel0s**.  
**OzyBase: Power in a single binary.** 🛡️🚀
