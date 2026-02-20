# OzyBase Production Deployment Guide

This guide covers a secure production deployment with Docker, domain, HTTPS, and auth safety.

## 1. Prerequisites
- PostgreSQL 14+
- Docker + Docker Compose v2
- Nginx (or equivalent reverse proxy)
- A public domain (example: `api.example.com`)

## 2. Required environment variables
Create a local `.env` file (do not commit it):

```env
# App
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

# Optional SMTP
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@example.com
```

`docker-compose.yml` now requires `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `SITE_URL`, `APP_DOMAIN`, and `ALLOWED_ORIGINS`.

## 3. Deploy with Docker Compose

```bash
docker compose up -d --build
```

Notes:
- PostgreSQL is intentionally not exposed publicly in compose.
- App health check uses `GET /api/health` inside the container.

## 4. Domain and HTTPS
1. Point `api.example.com` to your server IP.
2. Install Nginx config from `deploy/nginx/ozybase.conf`.
3. Issue TLS certificates (Let's Encrypt/Certbot).
4. Replace `server_name` and cert paths in nginx config.

## 5. Security checklist
1. Keep `DEBUG=false`.
2. Rotate `JWT_SECRET` if exposed.
3. Never expose `POST /api/sql` to non-admin users.
4. Keep reset/verification tokens out of logs and browser URL history.
5. Restrict inbound firewall to `80/443` (and SSH management port only).

## 6. Monitoring
- Liveness: `GET /api/health`
- Log shipping recommended: Loki, Elasticsearch, Datadog.
- Add DB backups and restore drills to operations.
