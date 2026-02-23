#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
SERVICE_NAME="${SERVICE_NAME:-ozybase}"
COMPOSE_PROJECT_NAME_OVERRIDE="${COMPOSE_PROJECT_NAME_OVERRIDE:-${COMPOSE_PROJECT_NAME:-}}"

CANDIDATE_IMAGE="${CANDIDATE_IMAGE:-}"
CANARY_CONTAINER="${CANARY_CONTAINER:-ozybase-canary}"
CANARY_PORT="${CANARY_PORT:-18090}"
PRODUCTION_PORT="${PRODUCTION_PORT:-8090}"
HEALTH_PATH="${HEALTH_PATH:-/api/health}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-120}"
VERIFY_SCRIPT="${VERIFY_SCRIPT:-scripts/canary_verify.sh}"
SKIP_VERIFY="${SKIP_VERIFY:-false}"
POST_DEPLOY_SMOKE_SCRIPT="${POST_DEPLOY_SMOKE_SCRIPT:-scripts/smoke_post_deploy.sh}"
SKIP_POST_DEPLOY_SMOKE="${SKIP_POST_DEPLOY_SMOKE:-false}"
ROLLBACK_ON_VERIFY_FAILURE="${ROLLBACK_ON_VERIFY_FAILURE:-true}"
ROLLBACK_ON_SMOKE_FAILURE="${ROLLBACK_ON_SMOKE_FAILURE:-true}"

is_true() {
  case "${1,,}" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd" >&2
    exit 1
  fi
}

compose_cmd() {
  local args=()
  if [[ -n "$COMPOSE_PROJECT_NAME_OVERRIDE" ]]; then
    args+=(-p "$COMPOSE_PROJECT_NAME_OVERRIDE")
  fi
  if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
    args+=(--env-file "$ENV_FILE")
  fi
  args+=(-f "$COMPOSE_FILE")
  docker compose "${args[@]}" "$@"
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local timeout="$3"
  local started elapsed
  started="$(date +%s)"

  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[canary-deploy] ${label} healthy: ${url}"
      return 0
    fi
    elapsed=$(( $(date +%s) - started ))
    if (( elapsed >= timeout )); then
      echo "[canary-deploy] timeout waiting for ${label} health: ${url}" >&2
      return 1
    fi
    sleep 2
  done
}

cleanup_canary() {
  docker rm -f "$CANARY_CONTAINER" >/dev/null 2>&1 || true
}

run_verify() {
  local target_url="$1"
  if is_true "$SKIP_VERIFY"; then
    echo "[canary-deploy] verification skipped by SKIP_VERIFY=true"
    return 0
  fi
  if [[ ! -x "$VERIFY_SCRIPT" ]]; then
    if [[ ! -f "$VERIFY_SCRIPT" ]]; then
      echo "verification script not found: $VERIFY_SCRIPT" >&2
      return 1
    fi
  fi
  echo "[canary-deploy] running verification on ${target_url}"
  BASE_URL="$target_url" bash "$VERIFY_SCRIPT"
}

run_post_deploy_smoke() {
  local target_url="$1"
  if is_true "$SKIP_POST_DEPLOY_SMOKE"; then
    echo "[canary-deploy] post-deploy smoke skipped by SKIP_POST_DEPLOY_SMOKE=true"
    return 0
  fi
  if [[ ! -x "$POST_DEPLOY_SMOKE_SCRIPT" ]]; then
    if [[ ! -f "$POST_DEPLOY_SMOKE_SCRIPT" ]]; then
      echo "post-deploy smoke script not found: $POST_DEPLOY_SMOKE_SCRIPT" >&2
      return 1
    fi
  fi

  local smoke_email="${SMOKE_ADMIN_EMAIL:-${CANARY_ADMIN_EMAIL:-}}"
  local smoke_password="${SMOKE_ADMIN_PASSWORD:-${CANARY_ADMIN_PASSWORD:-}}"
  echo "[canary-deploy] running post-deploy smoke on ${target_url}"
  BASE_URL="$target_url" \
    SMOKE_ADMIN_EMAIL="$smoke_email" \
    SMOKE_ADMIN_PASSWORD="$smoke_password" \
    SMOKE_CURL_CONNECT_TIMEOUT="${SMOKE_CURL_CONNECT_TIMEOUT:-3}" \
    SMOKE_CURL_TIMEOUT="${SMOKE_CURL_TIMEOUT:-15}" \
    bash "$POST_DEPLOY_SMOKE_SCRIPT"
}

require_command docker
require_command curl
require_command bash

if [[ -z "$CANDIDATE_IMAGE" ]]; then
  echo "CANDIDATE_IMAGE is required (example: ghcr.io/org/ozybase:v1.2.3)" >&2
  exit 1
fi
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

echo "[canary-deploy] compose file: $COMPOSE_FILE"
compose_cmd config >/dev/null

current_container="$(compose_cmd ps -q "$SERVICE_NAME" | head -n1 | tr -d '\r')"
if [[ -z "$current_container" ]]; then
  echo "No running container found for service '$SERVICE_NAME'" >&2
  exit 1
fi

current_image="$(docker inspect -f '{{.Config.Image}}' "$current_container" | tr -d '\r')"
if [[ -z "$current_image" ]]; then
  echo "Unable to resolve current image for container $current_container" >&2
  exit 1
fi

active_network="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{printf "%s\n" $k}}{{end}}' "$current_container" | head -n1 | tr -d '\r')"
if [[ -z "$active_network" ]]; then
  echo "Unable to resolve active Docker network for container $current_container" >&2
  exit 1
fi

if ! docker image inspect "$CANDIDATE_IMAGE" >/dev/null 2>&1; then
  echo "[canary-deploy] pulling candidate image: $CANDIDATE_IMAGE"
  docker pull "$CANDIDATE_IMAGE"
fi

echo "[canary-deploy] current image:   $current_image"
echo "[canary-deploy] candidate image: $CANDIDATE_IMAGE"
echo "[canary-deploy] active network:  $active_network"

trap cleanup_canary EXIT
cleanup_canary

canary_run_cmd=(
  docker run -d
  --name "$CANARY_CONTAINER"
  --network "$active_network"
  -e PORT=8090
  -e OZY_DEPLOY_MODE=canary
  -p "${CANARY_PORT}:8090"
)
if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  canary_run_cmd+=(--env-file "$ENV_FILE")
fi
canary_run_cmd+=("$CANDIDATE_IMAGE")

echo "[canary-deploy] starting canary container: $CANARY_CONTAINER"
"${canary_run_cmd[@]}" >/dev/null

canary_url="http://127.0.0.1:${CANARY_PORT}"
prod_url="http://127.0.0.1:${PRODUCTION_PORT}"

if ! wait_for_http "${canary_url}${HEALTH_PATH}" "canary" "$HEALTH_TIMEOUT_SECONDS"; then
  echo "[canary-deploy] canary health failed. Aborting deploy." >&2
  exit 1
fi
if ! run_verify "$canary_url"; then
  echo "[canary-deploy] canary verification failed. Aborting deploy." >&2
  exit 1
fi
if ! run_post_deploy_smoke "$canary_url"; then
  echo "[canary-deploy] canary post-deploy smoke failed. Aborting deploy." >&2
  exit 1
fi

rollback() {
  echo "[canary-deploy] rolling back to previous image: $current_image"
  OZYBASE_IMAGE="$current_image" compose_cmd up -d --no-build "$SERVICE_NAME"
  if ! wait_for_http "${prod_url}${HEALTH_PATH}" "production (rollback)" "$HEALTH_TIMEOUT_SECONDS"; then
    echo "[canary-deploy] rollback failed to recover production health" >&2
    return 1
  fi
  if ! run_verify "$prod_url"; then
    echo "[canary-deploy] rollback completed but verification failed" >&2
    return 1
  fi
  echo "[canary-deploy] rollback successful"
  return 0
}

echo "[canary-deploy] promoting candidate to production"
if ! OZYBASE_IMAGE="$CANDIDATE_IMAGE" compose_cmd up -d --no-build "$SERVICE_NAME"; then
  echo "[canary-deploy] promotion command failed" >&2
  rollback || true
  exit 1
fi

if ! wait_for_http "${prod_url}${HEALTH_PATH}" "production (candidate)" "$HEALTH_TIMEOUT_SECONDS"; then
  echo "[canary-deploy] production health failed after promotion" >&2
  rollback || true
  exit 1
fi

if ! run_verify "$prod_url"; then
  echo "[canary-deploy] production verification failed after promotion" >&2
  if is_true "$ROLLBACK_ON_VERIFY_FAILURE"; then
    rollback || true
  fi
  exit 1
fi
if ! run_post_deploy_smoke "$prod_url"; then
  echo "[canary-deploy] production post-deploy smoke failed after promotion" >&2
  if is_true "$ROLLBACK_ON_SMOKE_FAILURE"; then
    rollback || true
  fi
  exit 1
fi

echo "[canary-deploy] deployment successful. promoted image: $CANDIDATE_IMAGE"
