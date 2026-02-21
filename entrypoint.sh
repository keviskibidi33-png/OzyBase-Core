#!/bin/sh
set -eu

seed_dir="/app/migrations_seed"
target_dir="/app/migrations"

if [ -d "$seed_dir" ]; then
  if [ ! -d "$target_dir" ]; then
    mkdir -p "$target_dir"
  fi

  if [ -z "$(ls -A "$target_dir" 2>/dev/null)" ]; then
    cp -a "$seed_dir/." "$target_dir/"
  fi
fi

exec "$@"
