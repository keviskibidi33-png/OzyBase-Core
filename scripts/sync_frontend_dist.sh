#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${ROOT_DIR}/frontend/dist"
DST_DIR="${ROOT_DIR}/internal/api/frontend_dist"

if [[ ! -d "${SRC_DIR}" ]]; then
  echo "frontend/dist does not exist. Run the frontend build first." >&2
  exit 1
fi

mkdir -p "${DST_DIR}"
find "${DST_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -R "${SRC_DIR}/." "${DST_DIR}/"
echo "Synced frontend assets into internal/api/frontend_dist"
