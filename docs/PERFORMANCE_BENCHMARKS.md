# OzyBase Performance Benchmarks

This repo now includes a reproducible benchmark runner for large tables and real query paths:

- command: `go run ./cmd/ozybase-bench`
- PowerShell wrapper: `scripts/benchmark_data_plane.ps1`
- shell wrapper: `scripts/benchmark_data_plane.sh`

## What It Benchmarks

The runner authenticates, creates a temporary large table, seeds it with `generate_series`, and measures:

- `table_first_page`
- `table_deep_page_sorted`
- `table_search_tail`
- `sql_preview_cap`
- `sql_aggregate_grouped`

Each scenario reports:

- `successes / failures`
- `mean`
- `p50`
- `p95`
- `max`

## Example

```bash
go run ./cmd/ozybase-bench \
  -base-url http://127.0.0.1:8090 \
  -email admin@ozybase.local \
  -password OzyBase123! \
  -rows 100000 \
  -iterations 12 \
  -workers 4
```

## Interpretation

- `Table Editor` health is tied mainly to paginated table endpoints, not total raw row count in the database.
- `SQL Editor` should stay stable even on large result sets because previews are capped server-side by `OZY_SQL_EDITOR_MAX_ROWS`.
- If `table_deep_page_sorted` or `table_search_tail` degrade sharply, the next work should be indexing and query-plan tuning rather than frontend changes.

## Target Use

Use this runner before claiming production-readiness for:

- `self-host`
- `install-to-play`
- any private cloud deployment built from the same runtime
