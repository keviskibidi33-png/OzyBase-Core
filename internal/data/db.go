package data

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DB wraps the PostgreSQL connection pool
type DB struct {
	Pool *pgxpool.Pool

	columnCacheMu  sync.RWMutex
	columnCache    map[string]columnCacheEntry
	columnCacheTTL time.Duration
}

type columnCacheEntry struct {
	columns   map[string]bool
	expiresAt time.Time
}

// Connect establishes a connection pool to PostgreSQL
func Connect(ctx context.Context, databaseURL string) (*DB, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %w", err)
	}

	// Verify connection is working
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	return &DB{
		Pool:           pool,
		columnCache:    map[string]columnCacheEntry{},
		columnCacheTTL: 30 * time.Second,
	}, nil
}

// Close gracefully closes the database connection pool
func (db *DB) Close() {
	if db.Pool != nil {
		db.Pool.Close()
	}
}

// Health checks if the database connection is healthy
func (db *DB) Health(ctx context.Context) error {
	return db.Pool.Ping(ctx)
}

// ListSchemas returns a list of all schema names in the database
func (db *DB) ListSchemas(ctx context.Context) ([]string, error) {
	rows, err := db.Pool.Query(ctx, `
		SELECT schema_name
		FROM information_schema.schemata
		WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
		ORDER BY schema_name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var schemas []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err == nil {
			schemas = append(schemas, s)
		}
	}
	return schemas, nil
}

// ListTables returns a list of table names in the public schema
func (db *DB) ListTables(ctx context.Context) ([]string, error) {
	rows, err := db.Pool.Query(ctx, `
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = 'public'
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err == nil {
			tables = append(tables, t)
		}
	}
	return tables, nil
}

// HasColumn checks if a specific table has a specific column
func (db *DB) HasColumn(ctx context.Context, tableName, columnName string) bool {
	var exists bool
	err := db.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 
			FROM information_schema.columns 
			WHERE table_name = $1 AND column_name = $2
		)
	`, tableName, columnName).Scan(&exists)
	if err != nil {
		return false
	}
	return exists
}

// GetTableColumns returns a map of column names for a specific table
func (db *DB) GetTableColumns(ctx context.Context, tableName string) (map[string]bool, error) {
	if !IsValidIdentifier(tableName) {
		return nil, fmt.Errorf("invalid table name")
	}

	if cached, ok := db.getColumnCache(tableName); ok {
		return cached, nil
	}

	rows, err := db.Pool.Query(ctx, `
		SELECT column_name 
		FROM information_schema.columns 
		WHERE table_name = $1 AND table_schema = 'public'
	`, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols := make(map[string]bool)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			cols[name] = true
		}
	}
	db.setColumnCache(tableName, cols)
	return cols, nil
}

// InvalidateTableColumnCache clears cached table column metadata after schema changes.
func (db *DB) InvalidateTableColumnCache(tableName string) {
	if db == nil || tableName == "" {
		return
	}
	db.columnCacheMu.Lock()
	defer db.columnCacheMu.Unlock()
	if db.columnCache == nil {
		return
	}
	delete(db.columnCache, tableName)
}

func (db *DB) getColumnCache(tableName string) (map[string]bool, bool) {
	if db == nil || tableName == "" {
		return nil, false
	}
	db.columnCacheMu.RLock()
	entry, ok := db.columnCache[tableName]
	db.columnCacheMu.RUnlock()
	if !ok || time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return cloneColumnsMap(entry.columns), true
}

func (db *DB) setColumnCache(tableName string, cols map[string]bool) {
	if db == nil || tableName == "" {
		return
	}
	db.columnCacheMu.Lock()
	defer db.columnCacheMu.Unlock()
	if db.columnCache == nil {
		db.columnCache = map[string]columnCacheEntry{}
	}
	ttl := db.columnCacheTTL
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	db.columnCache[tableName] = columnCacheEntry{
		columns:   cloneColumnsMap(cols),
		expiresAt: time.Now().Add(ttl),
	}
}

func cloneColumnsMap(input map[string]bool) map[string]bool {
	out := make(map[string]bool, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}
