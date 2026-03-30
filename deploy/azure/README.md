# Azure Cloud Deployment

This folder contains the Azure-first deployment artifacts for OzyBase.

## Included

- `main.bicep`: provisions the app-facing Azure resources
- `main.parameters.example.json`: example parameters file

## Target Architecture

- Azure Container Apps for the OzyBase service
- Azure Database for PostgreSQL Flexible Server
- Built-in PgBouncer on the Flexible Server at port `6432`
- Azure Key Vault for runtime secrets
- Log Analytics + Container Apps managed environment

## Deployment Notes

1. Build and push an OzyBase image to a registry available to Azure Container Apps.
2. Create secrets in Key Vault for `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DATABASE_URL`, `DB_POOLER_URL`, and SMTP credentials.
3. Grant the container app managed identity `Key Vault Secrets User`.
4. Deploy the Bicep template with your image tag, domain values, and scaling limits.
5. Enable PgBouncer on the PostgreSQL Flexible Server and use the same host with port `6432` for `DB_POOLER_URL`.

See `docs/AZURE_PRODUCTION.md` for the operational checklist.
