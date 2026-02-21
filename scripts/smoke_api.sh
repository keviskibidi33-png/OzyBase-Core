#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8090}"
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-admin@ozybase.local}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-OzyBase123!}"

TMP_BODY="$(mktemp)"
cleanup() {
  rm -f "$TMP_BODY"
}
trap cleanup EXIT

call_api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local token="${4:-}"

  local args=(-sS -o "$TMP_BODY" -w "%{http_code}" -X "$method" "${BASE_URL}${path}")
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer ${token}")
  fi

  curl "${args[@]}"
}

json_read() {
  local key="$1"
  python3 - "$TMP_BODY" "$key" <<'PY'
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

echo "[smoke] checking system status"
status_code="$(call_api GET /api/system/status)"
require_status "$status_code" "200"
initialized="$(json_read initialized)"

if [[ "$initialized" != "True" && "$initialized" != "true" ]]; then
  echo "[smoke] system not initialized, running setup"
  setup_payload="$(printf '{"email":"%s","password":"%s","mode":"clean"}' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
  status_code="$(call_api POST /api/system/setup "$setup_payload")"
  require_status "$status_code" "200"
fi

echo "[smoke] validating global error envelope on unauthorized request"
status_code="$(call_api GET /api/collections)"
if [[ "$status_code" != "401" && "$status_code" != "403" ]]; then
  echo "Expected unauthorized status for /api/collections, got ${status_code}" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi
python3 - "$TMP_BODY" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    obj = json.load(f)
for key in ("error", "error_code", "request_id"):
    if key not in obj or not obj[key]:
        raise SystemExit(f"missing {key} in error envelope")
PY

echo "[smoke] login"
login_payload="$(printf '{"email":"%s","password":"%s"}' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
status_code="$(call_api POST /api/auth/login "$login_payload")"
require_status "$status_code" "200"
TOKEN="$(json_read token)"
USER_ID="$(json_read user.id)"
if [[ -z "$TOKEN" || -z "$USER_ID" ]]; then
  echo "Login response missing token or user.id" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

echo "[smoke] workspace flow"
status_code="$(call_api GET /api/workspaces "" "$TOKEN")"
require_status "$status_code" "200"

workspace_name="ci_smoke_ws_$(date +%s)"
workspace_payload="$(printf '{"name":"%s"}' "$workspace_name")"
status_code="$(call_api POST /api/workspaces "$workspace_payload" "$TOKEN")"
if [[ "$status_code" != "201" && "$status_code" != "409" ]]; then
  echo "Workspace create failed with status ${status_code}" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

echo "[smoke] table editor + SQL + security flow"
table_name="ci_smoke_$(date +%s)"
create_table_payload="$(printf '{"name":"%s","schema":[{"name":"owner_id","type":"uuid"},{"name":"title","type":"text"}],"list_rule":"auth","create_rule":"admin","rls_enabled":true,"rls_policies":{"select":"owner_id = auth.uid()","insert":"owner_id = auth.uid()","update":"owner_id = auth.uid()","delete":"owner_id = auth.uid()"}}' "$table_name")"
status_code="$(call_api POST /api/collections "$create_table_payload" "$TOKEN")"
if [[ "$status_code" != "201" ]]; then
  echo "Collection create failed with status ${status_code}" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

insert_payload="$(printf '{"owner_id":"%s","title":"smoke-row"}' "$USER_ID")"
status_code="$(call_api POST "/api/tables/${table_name}/rows" "$insert_payload" "$TOKEN")"
if [[ "$status_code" != "200" && "$status_code" != "201" ]]; then
  echo "Row insert failed with status ${status_code}" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

status_code="$(call_api GET "/api/tables/${table_name}?limit=5" "" "$TOKEN")"
require_status "$status_code" "200"

sql_payload="$(printf '{"query":"SELECT COUNT(*)::int AS total FROM %s"}' "$table_name")"
status_code="$(call_api POST /api/sql "$sql_payload" "$TOKEN")"
require_status "$status_code" "200"

status_code="$(call_api GET /api/project/security/stats "" "$TOKEN")"
require_status "$status_code" "200"

status_code="$(call_api GET /api/project/security/rls/coverage "" "$TOKEN")"
require_status "$status_code" "200"

status_code="$(call_api GET /api/project/security/rls/coverage/history "" "$TOKEN")"
require_status "$status_code" "200"

echo "[smoke] cleanup"
status_code="$(call_api DELETE "/api/collections/${table_name}" "" "$TOKEN")"
if [[ "$status_code" != "204" && "$status_code" != "200" ]]; then
  echo "Collection cleanup failed with status ${status_code}" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

echo "[smoke] success"
