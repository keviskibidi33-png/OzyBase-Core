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

The runner also:

- refreshes PostgreSQL planner statistics with `ANALYZE` after the bulk seed
- warms each scenario once before timing to reduce cold-start spikes
- creates representative indexes for default ordering and deep sorting
- attempts a `pg_trgm` search index for text search when the database allows that extension

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
- `table_first_page` uses the same paginated records path the Table Editor uses by default, so poor numbers there usually mean database sort/count overhead rather than React rendering.
- `table_search_tail` uses the same `q=` path as the Table Editor search box. It now searches `id` plus searchable text columns, so its p95 is highly sensitive to CPU, storage latency, planner stats, and whether the table has the right indexes.
- If `table_deep_page_sorted` or `table_search_tail` degrade sharply, the next work should be indexing and query-plan tuning rather than frontend changes.
- If the runner cannot enable `pg_trgm`, expect `table_search_tail` to reflect the slower unindexed `ILIKE` path instead of the tuned search path you would want for real apps.

## Reading a "Bad" Run

If one machine reports much worse p95 than another, treat the result as an environment signal first:

- local Windows filesystem and container overhead can add noticeable latency
- cold planner statistics make early runs noisier
- embedded or single-node Postgres behaves differently from external Postgres plus pooler
- free-text `ILIKE` search will degrade faster than ordered pagination unless the workload has search-oriented indexing such as `pg_trgm`

For serious production claims, rerun on the same runtime you intend to ship: external Postgres, realistic CPU limits, warm cache, and the same security settings as production.

## Target Use

Use this runner before claiming production-readiness for:

- `self-host`
- `install-to-play`
- any private cloud deployment built from the same runtime

Before claiming SaaS-grade readiness, extend the run to:

- `100k` and `1M+` rows
- sustained concurrency beyond the default 4 workers
- external Postgres with `DB_POOLER_URL`
- shared object storage and Redis-backed realtime when those modes are enabled
