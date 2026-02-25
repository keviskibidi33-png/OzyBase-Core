#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8090}"
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-admin@ozybase.local}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-OzyBase123!}"
SMOKE_CURL_CONNECT_TIMEOUT="${SMOKE_CURL_CONNECT_TIMEOUT:-3}"
SMOKE_CURL_TIMEOUT="${SMOKE_CURL_TIMEOUT:-15}"
SMOKE_RATE_LIMIT_MAX_RETRIES="${SMOKE_RATE_LIMIT_MAX_RETRIES:-6}"
SMOKE_RATE_LIMIT_RETRY_BASE_SECONDS="${SMOKE_RATE_LIMIT_RETRY_BASE_SECONDS:-1}"

PYTHON_BIN=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" --version >/dev/null 2>&1; then
    PYTHON_BIN="$candidate"
    break
  fi
done
if [[ -z "$PYTHON_BIN" ]]; then
  echo "python3/python is required for smoke_api.sh" >&2
  exit 1
fi

TMP_BODY="$(mktemp)"
TMP_HEADERS="$(mktemp)"
cleanup() {
  rm -f "$TMP_BODY"
  rm -f "$TMP_HEADERS"
}
trap cleanup EXIT

call_api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local token="${4:-}"

  local attempt=1
  local max_retries="$SMOKE_RATE_LIMIT_MAX_RETRIES"
  if ! [[ "$max_retries" =~ ^[0-9]+$ ]] || [[ "$max_retries" -lt 1 ]]; then
    max_retries=1
  fi

  while true; do
    local args=(
      -sS
      -D "$TMP_HEADERS"
      -o "$TMP_BODY"
      -w "%{http_code}"
      --connect-timeout "$SMOKE_CURL_CONNECT_TIMEOUT"
      --max-time "$SMOKE_CURL_TIMEOUT"
      -X "$method"
      "${BASE_URL}${path}"
    )
    if [[ -n "$body" ]]; then
      args+=(-H "Content-Type: application/json" -d "$body")
    fi
    if [[ -n "$token" ]]; then
      args+=(-H "Authorization: Bearer ${token}")
    fi

    local status_code
    status_code="$(curl "${args[@]}")"
    if [[ "$status_code" != "429" || "$attempt" -ge "$max_retries" ]]; then
      echo "$status_code"
      return 0
    fi

    local retry_after
    retry_after="$(awk 'BEGIN{IGNORECASE=1} /^Retry-After:/ {gsub("\r","",$2); print $2; exit}' "$TMP_HEADERS" || true)"

    local sleep_seconds
    if [[ -n "$retry_after" && "$retry_after" =~ ^[0-9]+$ ]]; then
      sleep_seconds="$retry_after"
    else
      sleep_seconds=$(( SMOKE_RATE_LIMIT_RETRY_BASE_SECONDS * attempt ))
    fi

    echo "[smoke] rate limited (429) for ${method} ${path}; retry ${attempt}/${max_retries} in ${sleep_seconds}s" >&2
    sleep "$sleep_seconds"
    attempt=$(( attempt + 1 ))
  done
}

fetch_headers() {
  local path="$1"
  local token="${2:-}"

  local args=(
    -sS
    -D "$TMP_HEADERS"
    -o /dev/null
    --connect-timeout "$SMOKE_CURL_CONNECT_TIMEOUT"
    --max-time "$SMOKE_CURL_TIMEOUT"
    "${BASE_URL}${path}"
  )
  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer ${token}")
  fi

  curl "${args[@]}" >/dev/null
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
"$PYTHON_BIN" - "$TMP_BODY" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    obj = json.load(f)
for key in ("error", "error_code", "request_id"):
    if key not in obj or not obj[key]:
        raise SystemExit(f"missing {key} in error envelope")
PY

echo "[smoke] validating CSP header"
fetch_headers /api/health
if ! grep -qi '^Content-Security-Policy:' "$TMP_HEADERS"; then
  echo "Missing Content-Security-Policy header" >&2
  cat "$TMP_HEADERS" >&2
  exit 1
fi
if ! grep -qi '^Content-Security-Policy:.*default-src' "$TMP_HEADERS"; then
  echo "CSP header present but missing default-src directive" >&2
  cat "$TMP_HEADERS" >&2
  exit 1
fi

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

echo "[smoke] realtime distributed status"
status_code="$(call_api GET /api/project/realtime/status "" "$TOKEN")"
require_status "$status_code" "200"
"$PYTHON_BIN" - "$TMP_BODY" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
mode = str(data.get("mode", "")).strip().lower()
if mode not in {"local", "redis"}:
    raise SystemExit(f"unexpected realtime mode: {mode}")
node_id = str(data.get("node_id", "")).strip()
if not node_id:
    raise SystemExit("realtime status missing node_id")
PY

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

status_code="$(call_api GET /api/project/observability/slo "" "$TOKEN")"
require_status "$status_code" "200"

status_code="$(call_api GET /api/project/security/alert-routing "" "$TOKEN")"
require_status "$status_code" "200"

alert_routing_payload="$(printf '{"enabled":true,"primary_contact":"%s","secondary_contact":"","escalation_minutes":15,"runbook_url":"https://example.com/runbook","timezone":"UTC"}' "$ADMIN_EMAIL")"
status_code="$(call_api POST /api/project/security/alert-routing "$alert_routing_payload" "$TOKEN")"
require_status "$status_code" "200"

status_code="$(call_api POST /api/project/security/rls/closeout '{"auto_enforce":true}' "$TOKEN")"
require_status "$status_code" "200"
"$PYTHON_BIN" - "$TMP_BODY" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
status = str(data.get("status", "")).lower()
if status not in {"pass", "preview"}:
    raise SystemExit(f"unexpected closeout status: {status}")
summary = data.get("summary") or {}
ratio = float(summary.get("kpi_full_action_coverage_ratio", 0))
if ratio < 1.0:
    raise SystemExit(f"kpi_full_action_coverage_ratio below 1.0: {ratio}")
evidence = data.get("evidence") or {}
snapshot_id = str(evidence.get("snapshot_id", "")).strip()
if not snapshot_id:
    raise SystemExit("closeout evidence missing snapshot_id")
PY

status_code="$(call_api GET /api/project/integrations/metrics "" "$TOKEN")"
require_status "$status_code" "200"

status_code="$(call_api GET /api/project/integrations/dlq "" "$TOKEN")"
require_status "$status_code" "200"

status_code="$(call_api GET /api/project/performance/advisor "" "$TOKEN")"
require_status "$status_code" "200"

status_code="$(call_api GET /api/project/performance/advisor/history "" "$TOKEN")"
require_status "$status_code" "200"

echo "[smoke] pgvector status + similarity flow"
status_code="$(call_api GET /api/project/vector/status "" "$TOKEN")"
require_status "$status_code" "200"
vector_available="$(json_read available)"

if [[ "$vector_available" == "True" || "$vector_available" == "true" ]]; then
  vector_setup_payload='{"dimension":4,"metric":"cosine","index_lists":8}'
  status_code="$(call_api POST /api/project/vector/setup "$vector_setup_payload" "$TOKEN")"
  require_status "$status_code" "200"

  vector_upsert_payload='{"namespace":"ci_smoke_vectors","items":[{"external_id":"doc_1","content":"alpha sample","embedding":[0.10,0.20,0.30,0.40],"metadata":{"source":"smoke"}},{"external_id":"doc_2","content":"beta sample","embedding":[0.90,0.10,0.20,0.30],"metadata":{"source":"smoke"}}]}'
  status_code="$(call_api POST /api/project/vector/upsert "$vector_upsert_payload" "$TOKEN")"
  require_status "$status_code" "200"

  vector_search_payload='{"namespace":"ci_smoke_vectors","query_embedding":[0.11,0.19,0.31,0.39],"limit":2}'
  status_code="$(call_api POST /api/project/vector/search "$vector_search_payload" "$TOKEN")"
  require_status "$status_code" "200"
  "$PYTHON_BIN" - "$TMP_BODY" <<'PY'
import json, math, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
hits = data.get("hits")
if not isinstance(hits, list) or not hits:
    raise SystemExit("vector search returned no hits")
score = float(hits[0].get("score", 0.0))
if math.isnan(score) or math.isinf(score):
    raise SystemExit("vector search returned invalid score")
if str(hits[0].get("external_id", "")).strip() == "":
    raise SystemExit("vector search returned empty external_id")
PY
else
  echo "[smoke] pgvector not available in this runtime, skipping vector similarity checks"
fi

echo "[smoke] extensions marketplace flow"
status_code="$(call_api POST /api/extensions/marketplace/sync '{}' "$TOKEN")"
require_status "$status_code" "200"

status_code="$(call_api GET /api/extensions/marketplace "" "$TOKEN")"
require_status "$status_code" "200"
"$PYTHON_BIN" - "$TMP_BODY" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
items = data.get("items")
if not isinstance(items, list) or not items:
    raise SystemExit("marketplace items response is empty")
slugs = {str(item.get("slug", "")).strip() for item in items if isinstance(item, dict)}
if "wasm-core-runtime" not in slugs:
    raise SystemExit("marketplace missing wasm-core-runtime seed")
PY

status_code="$(call_api POST /api/extensions/marketplace/wasm-core-runtime/install '{}' "$TOKEN")"
require_status "$status_code" "200"
status_code="$(call_api DELETE /api/extensions/marketplace/wasm-core-runtime/install "" "$TOKEN")"
require_status "$status_code" "200"

echo "[smoke] wasm edge function flow"
wasm_fn_name="ci_smoke_wasm_$(date +%s)"
wasm_create_payload="$(printf '{"name":"%s","runtime":"wasm","wasm_base64":"AGFzbQEAAAA=","timeout_ms":1000,"entrypoint":"_start"}' "$wasm_fn_name")"
status_code="$(call_api POST /api/functions "$wasm_create_payload" "$TOKEN")"
require_status "$status_code" "200"

status_code="$(call_api POST "/api/functions/${wasm_fn_name}/invoke" '{}' "$TOKEN")"
require_status "$status_code" "200"
"$PYTHON_BIN" - "$TMP_BODY" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
if str(data.get("runtime", "")).strip().lower() != "wasm":
    raise SystemExit("wasm invoke response missing runtime=wasm")
result = data.get("result")
if not isinstance(result, dict):
    raise SystemExit("wasm invoke response missing result object")
PY

status_code="$(call_api DELETE "/api/functions/${wasm_fn_name}" "" "$TOKEN")"
require_status "$status_code" "200"

echo "[smoke] native NLQ + MCP flow"
nlq_translate_payload="$(printf '{"query":"count rows in %s","table":"%s"}' "$table_name" "$table_name")"
status_code="$(call_api POST /api/project/nlq/translate "$nlq_translate_payload" "$TOKEN")"
require_status "$status_code" "200"
"$PYTHON_BIN" - "$TMP_BODY" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
sql = str(data.get("sql", "")).strip().lower()
if not sql.startswith("select"):
    raise SystemExit("nlq translate did not return SQL")
if str(data.get("intent", "")).strip().lower() != "count":
    raise SystemExit("nlq translate intent mismatch")
PY

nlq_query_payload="$(printf '{"query":"list %s limit 1","table":"%s","limit":1}' "$table_name" "$table_name")"
status_code="$(call_api POST /api/project/nlq/query "$nlq_query_payload" "$TOKEN")"
require_status "$status_code" "200"
"$PYTHON_BIN" - "$TMP_BODY" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
rows = data.get("rows")
if not isinstance(rows, list):
    raise SystemExit("nlq query rows payload is not a list")
columns = data.get("columns")
if not isinstance(columns, list) or not columns:
    raise SystemExit("nlq query missing columns")
PY

status_code="$(call_api GET /api/project/mcp/tools "" "$TOKEN")"
require_status "$status_code" "200"
"$PYTHON_BIN" - "$TMP_BODY" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
tools = data.get("tools")
if not isinstance(tools, list) or len(tools) < 3:
    raise SystemExit("mcp tools catalog is too small")
names = {str(item.get("name", "")).strip() for item in tools if isinstance(item, dict)}
required = {"collections.create", "nlq.translate", "nlq.query"}
missing = sorted(required - names)
if missing:
    raise SystemExit(f"mcp tools catalog missing required tools: {missing}")
PY

status_code="$(call_api POST /api/project/mcp/invoke '{"tool":"vector.status","arguments":{}}' "$TOKEN")"
require_status "$status_code" "200"

mcp_collection_name="ci_smoke_mcp_$(date +%s)"
mcp_create_payload="$(printf '{"tool":"collections.create","arguments":{"name":"%s","schema":[{"name":"owner_id","type":"uuid"},{"name":"title","type":"text"}],"list_rule":"auth","create_rule":"admin"}}' "$mcp_collection_name")"
status_code="$(call_api POST /api/project/mcp/invoke "$mcp_create_payload" "$TOKEN")"
require_status "$status_code" "200"
"$PYTHON_BIN" - "$TMP_BODY" "$mcp_collection_name" <<'PY'
import json, sys
path, table_name = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
result = data.get("result") if isinstance(data, dict) else None
if not isinstance(result, dict):
    raise SystemExit("mcp collections.create missing result")
if str(result.get("name", "")).strip() != table_name:
    raise SystemExit("mcp collections.create returned unexpected table name")
status = str(result.get("status", "")).strip().lower()
if status not in {"created", "updated"}:
    raise SystemExit(f"unexpected collections.create status: {status}")
PY

mcp_insert_payload="$(printf '{"owner_id":"%s","title":"mcp-created-row"}' "$USER_ID")"
status_code="$(call_api POST "/api/tables/${mcp_collection_name}/rows" "$mcp_insert_payload" "$TOKEN")"
if [[ "$status_code" != "200" && "$status_code" != "201" ]]; then
  echo "MCP-created table row insert failed with status ${status_code}" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

mcp_nlq_payload="$(printf '{"tool":"nlq.translate","arguments":{"query":"count rows in %s","table":"%s"}}' "$table_name" "$table_name")"
status_code="$(call_api POST /api/project/mcp/invoke "$mcp_nlq_payload" "$TOKEN")"
require_status "$status_code" "200"
"$PYTHON_BIN" - "$TMP_BODY" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
result = data.get("result") if isinstance(data, dict) else None
if not isinstance(result, dict):
    raise SystemExit("mcp invoke response missing result")
if str(result.get("mode", "")).strip().lower() != "deterministic":
    raise SystemExit("mcp nlq tool did not return deterministic mode")
PY

echo "[smoke] api key lifecycle (create + rotate + events)"
key_name="ci_smoke_key_$(date +%s)"
create_key_payload="$(printf '{"name":"%s","role":"service_role","expires_in_days":30}' "$key_name")"
status_code="$(call_api POST /api/project/keys "$create_key_payload" "$TOKEN")"
require_status "$status_code" "201"
API_KEY_ID="$(json_read id)"
if [[ -z "$API_KEY_ID" ]]; then
  echo "API key creation response missing id" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

status_code="$(call_api POST "/api/project/keys/${API_KEY_ID}/rotate" '{"grace_minutes":1,"reason":"ci smoke validation"}' "$TOKEN")"
require_status "$status_code" "200"
ROTATED_KEY_ID="$(json_read new_id)"
if [[ -z "$ROTATED_KEY_ID" ]]; then
  echo "API key rotation response missing new_id" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

status_code="$(call_api GET "/api/project/keys/events?limit=100" "" "$TOKEN")"
require_status "$status_code" "200"
"$PYTHON_BIN" - "$TMP_BODY" "$ROTATED_KEY_ID" <<'PY'
import json, sys
path, rotated_id = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
if not isinstance(data, list):
    raise SystemExit("events payload is not a list")
if not any((item.get("action") == "rotate" and item.get("api_key_id") == rotated_id) for item in data):
    raise SystemExit("rotate event not found for rotated key")
PY

status_code="$(call_api GET "/api/project/security/admin-audit?limit=200" "" "$TOKEN")"
require_status "$status_code" "200"
"$PYTHON_BIN" - "$TMP_BODY" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
items = data.get("items") if isinstance(data, dict) else None
if not isinstance(items, list) or not items:
    raise SystemExit("admin audit events payload missing items")
actions = {str(item.get("action", "")).strip() for item in items if isinstance(item, dict)}
required = {"api_key_rotate", "security_rls_closeout"}
missing = sorted(required - actions)
if missing:
    raise SystemExit(f"missing expected admin audit actions: {missing}")
PY

echo "[smoke] cleanup"
status_code="$(call_api DELETE "/api/collections/${table_name}" "" "$TOKEN")"
if [[ "$status_code" != "204" && "$status_code" != "200" ]]; then
  echo "Collection cleanup failed with status ${status_code}" >&2
  cat "$TMP_BODY" >&2
  exit 1
fi

if [[ -n "${mcp_collection_name:-}" ]]; then
  status_code="$(call_api DELETE "/api/collections/${mcp_collection_name}" "" "$TOKEN")"
  if [[ "$status_code" != "204" && "$status_code" != "200" && "$status_code" != "404" ]]; then
    echo "MCP collection cleanup failed with status ${status_code}" >&2
    cat "$TMP_BODY" >&2
    exit 1
  fi
fi

if [[ -n "${ROTATED_KEY_ID:-}" ]]; then
  status_code="$(call_api DELETE "/api/project/keys/${ROTATED_KEY_ID}" "" "$TOKEN")"
  if [[ "$status_code" != "200" && "$status_code" != "204" && "$status_code" != "404" ]]; then
    echo "Rotated API key cleanup failed with status ${status_code}" >&2
    cat "$TMP_BODY" >&2
    exit 1
  fi
fi

if [[ -n "${API_KEY_ID:-}" ]]; then
  status_code="$(call_api DELETE "/api/project/keys/${API_KEY_ID}" "" "$TOKEN")"
  if [[ "$status_code" != "200" && "$status_code" != "204" && "$status_code" != "404" ]]; then
    echo "Original API key cleanup failed with status ${status_code}" >&2
    cat "$TMP_BODY" >&2
    exit 1
  fi
fi

echo "[smoke] revoke all sessions"
status_code="$(call_api POST /api/auth/sessions/revoke-all '{}' "$TOKEN")"
require_status "$status_code" "200"

echo "[smoke] success"
