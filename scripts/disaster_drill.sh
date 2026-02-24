#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_PROJECT_NAME_OVERRIDE="${COMPOSE_PROJECT_NAME_OVERRIDE:-${COMPOSE_PROJECT_NAME:-}}"
DB_SERVICE="${DB_SERVICE:-db}"
AUTO_START_STACK="${AUTO_START_STACK:-true}"

DRILL_OUTPUT_DIR="${DRILL_OUTPUT_DIR:-artifacts/disaster-drill}"
DRILL_RUN_ID="${DRILL_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
DRILL_MARKER_TABLE="${DRILL_MARKER_TABLE:-_v_disaster_drill_markers}"
DRILL_MARKER_ID="${DRILL_MARKER_ID:-drill-${DRILL_RUN_ID}}"
DRILL_MARKER_NOTES="${DRILL_MARKER_NOTES:-automated backup+restore validation}"
RESTORE_DB_NAME="${RESTORE_DB_NAME:-}"
KEEP_BACKUP="${KEEP_BACKUP:-true}"
VERIFY_API_HEALTH="${VERIFY_API_HEALTH:-false}"
APP_HEALTH_URL="${APP_HEALTH_URL:-http://127.0.0.1:8090/api/health}"
DRILL_POINTER_FILE="${DRILL_POINTER_FILE:-}"

RUN_DIR="${DRILL_OUTPUT_DIR%/}/${DRILL_RUN_ID}"
BACKUP_FILE="${RUN_DIR}/database.dump"
REPORT_FILE="${RUN_DIR}/report.json"

START_EPOCH="$(date +%s)"
STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

DRILL_STATUS="failed"
FAILURE_REASON=""
BACKUP_SHA256=""
BACKUP_SIZE_BYTES="0"
BACKUP_RETAINED="false"
MARKER_RESTORE_COUNT="0"

db_user=""
db_password=""
db_name=""
restore_db=""

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

json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

read_db_env() {
  local var_name="$1"
  compose_cmd exec -T "$DB_SERVICE" sh -lc "printf '%s' \"\${$var_name:-}\"" | tr -d '\r'
}

db_exec_sql() {
  local target_db="$1"
  shift || true
  compose_cmd exec -T -e PGPASSWORD="$db_password" "$DB_SERVICE" \
    psql -v ON_ERROR_STOP=1 -U "$db_user" -d "$target_db" "$@"
}

compute_sha256() {
  local file_path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file_path" | awk '{print $1}'
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file_path" | awk '{print $1}'
    return 0
  fi
  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file_path" | awk '{print $NF}'
    return 0
  fi
  printf ''
}

fail() {
  FAILURE_REASON="$1"
  echo "[drill] $FAILURE_REASON" >&2
  return 1
}

write_report() {
  local finished_at="$1"
  local duration_seconds="$2"
  mkdir -p "$RUN_DIR"
  cat >"$REPORT_FILE" <<EOF
{
  "run_id": "$(json_escape "$DRILL_RUN_ID")",
  "status": "$(json_escape "$DRILL_STATUS")",
  "failure_reason": "$(json_escape "$FAILURE_REASON")",
  "started_at": "$(json_escape "$STARTED_AT")",
  "finished_at": "$(json_escape "$finished_at")",
  "duration_seconds": ${duration_seconds},
  "compose_file": "$(json_escape "$COMPOSE_FILE")",
  "env_file": "$(json_escape "$ENV_FILE")",
  "db_service": "$(json_escape "$DB_SERVICE")",
  "primary_db": "$(json_escape "$db_name")",
  "restore_db": "$(json_escape "$restore_db")",
  "marker_table": "$(json_escape "$DRILL_MARKER_TABLE")",
  "marker_id": "$(json_escape "$DRILL_MARKER_ID")",
  "marker_restore_count": ${MARKER_RESTORE_COUNT},
  "backup_file": "$(json_escape "$BACKUP_FILE")",
  "backup_sha256": "$(json_escape "$BACKUP_SHA256")",
  "backup_size_bytes": ${BACKUP_SIZE_BYTES},
  "backup_retained": ${BACKUP_RETAINED}
}
EOF
}

on_error() {
  local exit_code=$?
  if [[ -z "$FAILURE_REASON" ]]; then
    FAILURE_REASON="Command failed at line ${BASH_LINENO[0]}"
  fi
  return "$exit_code"
}

cleanup() {
  local exit_code=$?
  set +e

  if [[ -n "$restore_db" && -n "$db_user" && -n "$db_password" ]]; then
    db_exec_sql postgres -c "DROP DATABASE IF EXISTS \"$restore_db\" WITH (FORCE);" >/dev/null 2>&1 || true
  fi

  local finished_epoch finished_at duration_seconds
  finished_epoch="$(date +%s)"
  finished_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  duration_seconds=$((finished_epoch - START_EPOCH))

  write_report "$finished_at" "$duration_seconds"

  if [[ -n "$DRILL_POINTER_FILE" ]]; then
    mkdir -p "$(dirname "$DRILL_POINTER_FILE")"
    {
      echo "DRILL_RUN_DIR=$RUN_DIR"
      echo "DRILL_REPORT_FILE=$REPORT_FILE"
    } >"$DRILL_POINTER_FILE"
  fi

  echo "[drill] report: $REPORT_FILE"
  echo "[drill] status: $DRILL_STATUS"
  if [[ -n "$FAILURE_REASON" ]]; then
    echo "[drill] failure_reason: $FAILURE_REASON"
  fi

  if [[ "$exit_code" -ne 0 ]]; then
    exit "$exit_code"
  fi
}

trap on_error ERR
trap cleanup EXIT

require_command docker
if is_true "$VERIFY_API_HEALTH"; then
  require_command curl
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  fail "Compose file not found: $COMPOSE_FILE"
fi

if [[ ! "$DRILL_MARKER_TABLE" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  fail "DRILL_MARKER_TABLE must be a simple SQL identifier (letters/numbers/underscore)."
fi

mkdir -p "$RUN_DIR"

echo "[drill] compose file: $COMPOSE_FILE"
compose_cmd config >/dev/null

if is_true "$AUTO_START_STACK"; then
  echo "[drill] ensuring DB service is running"
  compose_cmd up -d "$DB_SERVICE" >/dev/null
fi

db_container_id="$(compose_cmd ps -q "$DB_SERVICE" | head -n1 | tr -d '\r')"
if [[ -z "$db_container_id" ]]; then
  fail "No running container found for DB service '$DB_SERVICE'."
fi

db_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_container_id" | tr -d '\r')"
if [[ "$db_health" != "healthy" && "$db_health" != "running" ]]; then
  fail "DB container is not healthy/running (status=$db_health)."
fi

db_user="$(read_db_env POSTGRES_USER)"
if [[ -z "$db_user" ]]; then
  db_user="$(read_db_env DB_USER)"
fi
db_password="$(read_db_env POSTGRES_PASSWORD)"
if [[ -z "$db_password" ]]; then
  db_password="$(read_db_env DB_PASSWORD)"
fi
db_name="$(read_db_env POSTGRES_DB)"
if [[ -z "$db_name" ]]; then
  db_name="$(read_db_env DB_NAME)"
fi

if [[ -z "$db_user" || -z "$db_password" || -z "$db_name" ]]; then
  fail "Unable to resolve DB credentials from container environment (POSTGRES_*/DB_*)."
fi

echo "[drill] validating DB readiness"
compose_cmd exec -T -e PGPASSWORD="$db_password" "$DB_SERVICE" \
  pg_isready -U "$db_user" -d "$db_name" >/dev/null

echo "[drill] creating marker in primary DB"
db_exec_sql "$db_name" -v marker_id="$DRILL_MARKER_ID" -v marker_notes="$DRILL_MARKER_NOTES" <<SQL
CREATE TABLE IF NOT EXISTS ${DRILL_MARKER_TABLE} (
  marker_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT NOT NULL DEFAULT ''
);
INSERT INTO ${DRILL_MARKER_TABLE} (marker_id, notes)
VALUES (:'marker_id', :'marker_notes')
ON CONFLICT (marker_id)
DO UPDATE SET created_at = NOW(), notes = EXCLUDED.notes;
SQL

echo "[drill] creating backup: $BACKUP_FILE"
compose_cmd exec -T -e PGPASSWORD="$db_password" "$DB_SERVICE" \
  pg_dump -U "$db_user" -d "$db_name" -Fc --no-owner --no-privileges >"$BACKUP_FILE"
BACKUP_RETAINED="true"

if [[ ! -s "$BACKUP_FILE" ]]; then
  fail "Backup file is empty: $BACKUP_FILE"
fi
BACKUP_SHA256="$(compute_sha256 "$BACKUP_FILE")"
BACKUP_SIZE_BYTES="$(wc -c <"$BACKUP_FILE" | tr -d '[:space:]')"

if [[ -n "$RESTORE_DB_NAME" ]]; then
  restore_db="$RESTORE_DB_NAME"
else
  restore_db="drill_restore_${DRILL_RUN_ID//[^A-Za-z0-9_]/_}"
fi
if [[ ${#restore_db} -gt 63 ]]; then
  restore_db="${restore_db:0:63}"
fi
if [[ ! "$restore_db" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  fail "RESTORE_DB_NAME is invalid after normalization: $restore_db"
fi
if [[ "$restore_db" == "$db_name" ]]; then
  fail "RESTORE_DB_NAME resolves to primary DB ($db_name), refusing destructive restore."
fi

echo "[drill] restoring backup into isolated DB: $restore_db"
db_exec_sql postgres -c "DROP DATABASE IF EXISTS \"$restore_db\" WITH (FORCE);"
db_exec_sql postgres -c "CREATE DATABASE \"$restore_db\";"
compose_cmd exec -T -e PGPASSWORD="$db_password" "$DB_SERVICE" \
  pg_restore -U "$db_user" -d "$restore_db" --clean --if-exists --no-owner --no-privileges <"$BACKUP_FILE"

marker_lookup_id="$(printf '%s' "$DRILL_MARKER_ID" | sed "s/'/''/g")"
marker_count_raw="$(
  db_exec_sql "$restore_db" -tA \
    -c "SELECT COUNT(*)::int FROM ${DRILL_MARKER_TABLE} WHERE marker_id = '${marker_lookup_id}';"
)"
MARKER_RESTORE_COUNT="$(echo "$marker_count_raw" | tr -d '[:space:]')"
if [[ "$MARKER_RESTORE_COUNT" -lt 1 ]]; then
  fail "Marker row was not restored correctly (count=$MARKER_RESTORE_COUNT)."
fi

if is_true "$VERIFY_API_HEALTH"; then
  echo "[drill] verifying API health: $APP_HEALTH_URL"
  curl -fsS "$APP_HEALTH_URL" >/dev/null
fi

if ! is_true "$KEEP_BACKUP"; then
  rm -f "$BACKUP_FILE"
  BACKUP_RETAINED="false"
  BACKUP_SHA256=""
  BACKUP_SIZE_BYTES="0"
fi

DRILL_STATUS="pass"
FAILURE_REASON=""
echo "[drill] success: backup+restore validated with marker '$DRILL_MARKER_ID'"
