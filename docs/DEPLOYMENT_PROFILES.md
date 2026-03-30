# OzyBase Deployment Profiles

This document maps the three supported release tracks to the runtime profile, branch, and deployment surface.

## Profiles

### 1. `self-host`
- Branch: `self-host`
- Runtime profile: `OZY_DEPLOYMENT_PROFILE=self_host`
- Primary path: local binary, `docker-compose.yml`, or `docker-compose.install.yml`
- Best for: local development, labs, and self-managed servers that want a Supabase-like self-hosted flow

### 2. `install-to-play`
- Branch: `install-to-play`
- Runtime profile: `OZY_DEPLOYMENT_PROFILE=install_to_play`
- Primary path: `docker-compose.install.yml` or `docker-compose.coolify.yml`
- Best for: Coolify, simple VPS deployments, and low-friction installs

### 3. `azure-cloud`
- Branch: `azure-cloud`
- Runtime profile: `OZY_DEPLOYMENT_PROFILE=azure_cloud`
- Primary path: Azure Container Apps + Azure Database for PostgreSQL Flexible Server + Key Vault
- Best for: managed cloud production with secret rotation, pooled connections, and platform telemetry

## Files Per Profile

| Profile | Main files |
| --- | --- |
| `self-host` | `docker-compose.yml`, `deploy/profiles/self-host/.env.example` |
| `install-to-play` | `docker-compose.install.yml`, `docker-compose.coolify.yml`, `deploy/profiles/install-to-play/.env.example` |
| `azure-cloud` | `deploy/azure/main.bicep`, `deploy/azure/main.parameters.example.json`, `deploy/profiles/azure-cloud/.env.example` |

## Branch Discipline

- `main` remains the integration trunk.
- `self-host`, `install-to-play`, and `azure-cloud` are release tracks that fast-forward from `main`.
- Profile-specific docs, examples, and IaC live on all tracks, but each branch can pin its own defaults, examples, and release notes.

## Runtime Signal

The dashboard surfaces the active profile in `Settings > General > Production Readiness`. This comes from `OZY_DEPLOYMENT_PROFILE`, with safe fallback inference when the variable is absent.
