# OzyBase Deployment Profiles

This document maps the public release tracks to the runtime profile, branch, and deployment surface.

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

### 3. Private Cloud
- Branch: not published in this repo
- Runtime profile: `OZY_DEPLOYMENT_PROFILE=custom`
- Primary path: private IaC/ops repository
- Best for: managed cloud production that is maintained separately from the public codebase

## Files Per Profile

| Profile | Main files |
| --- | --- |
| `self-host` | `docker-compose.yml`, `deploy/profiles/self-host/.env.example` |
| `install-to-play` | `docker-compose.install.yml`, `docker-compose.coolify.yml`, `deploy/profiles/install-to-play/.env.example` |
| `private-cloud` | maintained outside this public repository |

## Branch Discipline

- `main` remains the integration trunk.
- `self-host` and `install-to-play` are public release tracks that fast-forward from `main`.
- Cloud-specific IaC, secrets strategy, and managed-runtime notes should live in a private ops repository.

## Runtime Signal

The dashboard surfaces the active profile in `Settings > General > Production Readiness`. This comes from `OZY_DEPLOYMENT_PROFILE`, with safe fallback inference when the variable is absent.
