#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8090}"
EMAIL="${BENCH_ADMIN_EMAIL:-admin@ozybase.local}"
PASSWORD="${BENCH_ADMIN_PASSWORD:-OzyBase123!}"
ROWS="${BENCH_ROWS:-100000}"
ITERATIONS="${BENCH_ITERATIONS:-12}"
WORKERS="${BENCH_WORKERS:-4}"

go run ./cmd/ozybase-bench \
  -base-url "$BASE_URL" \
  -email "$EMAIL" \
  -password "$PASSWORD" \
  -rows "$ROWS" \
  -iterations "$ITERATIONS" \
  -workers "$WORKERS"
