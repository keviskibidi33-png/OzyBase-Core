#!/bin/sh
set -eu

seed_dir="/app/migrations_seed"
target_dir="/app/migrations"
skip_seed="${OZY_SKIP_MIGRATIONS_SEED:-false}"

if [ "$skip_seed" = "true" ] || [ "$skip_seed" = "1" ]; then
  exec "$@"
fi

if [ -d "$seed_dir" ]; then
  if [ ! -d "$target_dir" ]; then
    mkdir -p "$target_dir"
  fi

  if [ -z "$(ls -A "$target_dir" 2>/dev/null)" ]; then
    cp -a "$seed_dir/." "$target_dir/"
  fi
fi

exec "$@"
