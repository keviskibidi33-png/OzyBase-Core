#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8090}"
CANARY_ADMIN_EMAIL="${CANARY_ADMIN_EMAIL:-${SMOKE_ADMIN_EMAIL:-}}"
CANARY_ADMIN_PASSWORD="${CANARY_ADMIN_PASSWORD:-${SMOKE_ADMIN_PASSWORD:-}}"
CANARY_SERVICE_ROLE_KEY="${CANARY_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-}}"
CANARY_CURL_CONNECT_TIMEOUT="${CANARY_CURL_CONNECT_TIMEOUT:-3}"
CANARY_CURL_TIMEOUT="${CANARY_CURL_TIMEOUT:-15}"

PYTHON_BIN=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" --version >/dev/null 2>&1; then
    PYTHON_BIN="$candidate"
    break
  fi
done
if [[ -z "$PYTHON_BIN" ]]; then
  echo "python3/python is required for canary_verify.sh" >&2
  exit 1
fi

TMP_BODY="$(mktemp)"
TMP_HEADERS="$(mktemp)"
cleanup() {
  rm -f "$TMP_BODY" "$TMP_HEADERS"
}
trap cleanup EXIT

call_api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local token="${4:-}"
  local api_key="${5:-}"

  local args=(
    -sS
    -o "$TMP_BODY"
    -w "%{http_code}"
    --connect-timeout "$CANARY_CURL_CONNECT_TIMEOUT"
    --max-time "$CANARY_CURL_TIMEOUT"
    -X "$method"
    "${BASE_URL}${path}"
  )
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer ${token}")
  fi
  if [[ -n "$api_key" ]]; then
    args+=(-H "apikey: ${api_key}" -H "X-Ozy-Key: ${api_key}")
  fi

  curl "${args[@]}"
}

fetch_headers() {
  local path="$1"

  local args=(
    -sS
    -D "$TMP_HEADERS"
    -o /dev/null
    --connect-timeout "$CANARY_CURL_CONNECT_TIMEOUT"
    --max-time "$CANARY_CURL_TIMEOUT"
    "${BASE_URL}${path}"
  )
  curl "${args[@]}" >/dev/null
}

require_status() {
  local got="$1"
  local expected="$2"
  if [[ "$got" != "$expected" ]]; then
    echo "Unexpected status: got=${got} expected=${expected}" >&2
    echo "Response body:" >&2
    cat "$TMP_BODY" >&2
    exit 1
  fi
}

json_read() {
  local key="$1"
  "$PYTHON_BIN" - "$TMP_BODY" "$key" <<'PY'
import json, sys
path, key = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8') as f:
    obj = json.load(f)
parts = key.split('.')
cur = obj
for p in parts:
    if isinstance(cur, dict):
        cur = cur.get(p)
    else:
        cur = None
        break
if cur is None:
    print("")
elif isinstance(cur, (dict, list)):
    print(json.dumps(cur))
else:
    print(cur)
PY
}

echo "[canary] validating health endpoint"
status_code="$(call_api GET /api/health)"
require_status "$status_code" "200"
health_status="$(json_read status)"
if [[ "${health_status}" == "degraded" ]]; then
  echo "Health status is degraded during canary verification" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

echo "[canary] validating security headers"
fetch_headers /api/health
if ! grep -qi '^Content-Security-Policy:' "$TMP_HEADERS"; then
  echo "Missing Content-Security-Policy header on canary" >&2
  cat "$TMP_HEADERS" >&2
  exit 1
fi

echo "[canary] validating system status endpoint"
status_code="$(call_api GET /api/system/status)"
require_status "$status_code" "200"

auth_mode="none"
token=""
api_key=""
if [[ -n "$CANARY_SERVICE_ROLE_KEY" ]]; then
  auth_mode="api_key"
  api_key="$CANARY_SERVICE_ROLE_KEY"
elif [[ -n "$CANARY_ADMIN_EMAIL" && -n "$CANARY_ADMIN_PASSWORD" ]]; then
  auth_mode="jwt"
fi

if [[ "$auth_mode" == "jwt" ]]; then
  echo "[canary] authenticating admin session"
  login_payload="$(printf '{"email":"%s","password":"%s"}' "$CANARY_ADMIN_EMAIL" "$CANARY_ADMIN_PASSWORD")"
  status_code="$(call_api POST /api/auth/login "$login_payload")"
  require_status "$status_code" "200"
  token="$(json_read token)"
  if [[ -z "$token" ]]; then
    echo "Login succeeded but token is missing" >&2
    cat "$TMP_BODY" >&2
    exit 1
  fi
fi

if [[ "$auth_mode" != "none" ]]; then
  echo "[canary] validating privileged observability endpoints"
  status_code="$(call_api GET /api/project/observability/slo "" "$token" "$api_key")"
  require_status "$status_code" "200"

  status_code="$(call_api GET "/api/project/security/admin-audit?limit=5" "" "$token" "$api_key")"
  require_status "$status_code" "200"
else
  echo "[canary] skipping privileged endpoint checks (missing canary credentials)"
fi

echo "[canary] verification success"
