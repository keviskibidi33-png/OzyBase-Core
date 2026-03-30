# OzyBase on Azure: Production Guide

This guide is the shortest safe path to run OzyBase in Azure for a real application workload.

## Recommended Azure Architecture
- Azure Container Apps for the OzyBase API + embedded frontend.
- Azure Database for PostgreSQL Flexible Server for the primary database.
- PgBouncer connection pooling for app bursts and multi-instance scaling.
- Azure Key Vault for `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, SMTP credentials, and database secrets.
- Azure Front Door Standard/Premium in front of Container Apps when you want global edge routing, WAF, and custom-domain TLS at the edge.
- Azure Monitor / Log Analytics for request, container, and platform telemetry.

## Required OzyBase Runtime Variables
Set these as Azure Container Apps secrets/environment variables:

```env
PORT=8090
DATABASE_URL=postgres://USER:PASSWORD@SERVER.postgres.database.azure.com:5432/ozybase?sslmode=require
DB_POOLER_URL=postgres://USER:PASSWORD@SERVER.postgres.database.azure.com:6432/ozybase?sslmode=require
SITE_URL=https://api.your-domain.com
APP_DOMAIN=your-domain.com
ALLOWED_ORIGINS=https://your-domain.com,https://app.your-domain.com
JWT_SECRET=<64-byte-random-secret>
ANON_KEY=<stable-publishable-key>
SERVICE_ROLE_KEY=<stable-secret-key>
SMTP_HOST=<your-smtp-host>
SMTP_PORT=587
SMTP_USER=<smtp-user>
SMTP_PASSWORD=<smtp-password>
SMTP_FROM=noreply@your-domain.com
OZY_STRICT_SECURITY=true
DEBUG=false
```

## Production Rules
- Do not rely on OzyBase auto-generated secrets in Azure. Container Apps revisions are effectively stateless unless you deliberately persist and mount storage.
- Do not launch with the embedded PostgreSQL runtime in Azure. Use Azure Database for PostgreSQL Flexible Server.
- Do not leave `DB_POOLER_URL` empty for serious workloads. Direct database connections are fine for low traffic, but poolers are the safer default once you scale replicas or concurrent serverless bursts.
- Do not keep placeholder `example.com` domains in `SITE_URL` or `APP_DOMAIN`.
- Do not leave SMTP unconfigured if your product uses invite, reset-password, or verification flows.

## Launch Checklist
1. Provision Azure Database for PostgreSQL Flexible Server with TLS enabled.
2. Enable PgBouncer on Azure Database for PostgreSQL Flexible Server and wire the same host over port `6432` into `DB_POOLER_URL`.
3. Store OzyBase secrets in Azure Key Vault and reference them from Azure Container Apps.
4. Deploy the container into Azure Container Apps with health probe on `/api/health`.
5. Set the custom domain and TLS.
6. Validate `Settings > General > Production Readiness` until it shows `Launch Ready`.
7. Run `go test ./...`, `npm run build`, and a smoke login/create-table/query flow before public cutover.

## Why Pooler URI Can Be Empty
`Pooler URI` stays empty when OzyBase does not receive `DB_POOLER_URL` (or the legacy `POOLER_URL`) at runtime. That means the app only knows the direct PostgreSQL connection. In Azure Flexible Server, the recommended value is usually the same PostgreSQL host over port `6432` after PgBouncer is enabled.

## Official Azure References
- Azure Container Apps secrets: https://learn.microsoft.com/azure/container-apps/manage-secrets
- Azure Container Apps managed identity: https://learn.microsoft.com/azure/container-apps/managed-identity
- Azure Container Apps custom domains and managed certificates: https://learn.microsoft.com/azure/container-apps/custom-domains-managed-certificates
- Azure Database for PostgreSQL Flexible Server connection pooling best practices: https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-connection-pooling-best-practices
- Azure Key Vault security best practices: https://learn.microsoft.com/azure/key-vault/general/secure-key-vault
- Azure Front Door custom domains: https://learn.microsoft.com/azure/frontdoor/front-door-custom-domain
