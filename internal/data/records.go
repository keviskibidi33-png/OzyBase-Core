package data

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// InsertRecord inserts a record into a dynamic collection table
func (db *DB) InsertRecord(ctx context.Context, collectionName string, data map[string]any) (string, error) {
	if !IsValidIdentifier(collectionName) {
		return "", fmt.Errorf("invalid collection name: %s", collectionName)
	}

	var id string
	err := db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		var columns []string
		var placeholders []string
		var values []any
		i := 1

		for col, val := range data {
			if !IsValidIdentifier(col) {
				continue
			}
			if col == "id" || col == "created_at" || col == "updated_at" || col == "deleted_at" {
				continue
			}

			columns = append(columns, col)
			placeholders = append(placeholders, fmt.Sprintf("$%d", i))
			values = append(values, val)
			i++
		}

		query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) RETURNING id",
			collectionName, strings.Join(columns, ", "), strings.Join(placeholders, ", "))

		return tx.QueryRow(ctx, query, values...).Scan(&id)
	})

	return id, err
}

// ListRecordsResult encapsulates the output of a paginated list operation
type ListRecordsResult struct {
	Data  []map[string]any
	Total int64
}

// ListRecords fetches all records with filters and sorting, respecting RLS if configured in DB.
// This implementation uses a structured QueryBuilder for improved maintainability.
func (db *DB) ListRecords(ctx context.Context, collectionName string, filters map[string][]string, orderBy string, limit, offset int) (*ListRecordsResult, error) {
	if !IsValidIdentifier(collectionName) {
		return nil, fmt.Errorf("invalid collection name: %s", collectionName)
	}

	result := &ListRecordsResult{
		Data: []map[string]any{},
	}

	isSystemTable := strings.HasPrefix(collectionName, "_v_") || strings.HasPrefix(collectionName, "_ozy_")

	// 1. Fetch ALL columns dynamically for precise validation
	validCols, err := db.GetTableColumns(ctx, collectionName)
	if err != nil {
		fmt.Printf("[DB ARCH] Column lookup failed for %s: %v\n", collectionName, err)
		return nil, err
	}
	fmt.Printf("[DB ARCH] Detected columns for %s: %v\n", collectionName, validCols)
	if len(validCols) == 0 {
		return nil, fmt.Errorf("table not found or empty: %s", collectionName)
	}

	err = db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		qb := NewQueryBuilder(collectionName)

		// 2. Structural Filters (Soft Delete) - Only if column exists
		if !isSystemTable && validCols["deleted_at"] {
			qb.whereClauses = append(qb.whereClauses, "deleted_at IS NULL")
		}

		// 3. Search Logic
		if qValues, ok := filters["q"]; ok && len(qValues) > 0 && qValues[0] != "" {
			if validCols["id"] {
				qb.Where("id", "ilike", qValues[0])
			}
		}

		// 4. Dynamic Filters
		for col, values := range filters {
			if col == "order" || col == "select" || col == "limit" || col == "offset" || col == "q" {
				continue
			}
			if !IsValidIdentifier(col) || !validCols[col] {
				continue
			}

			for _, valStr := range values {
				parts := strings.SplitN(valStr, ".", 2)
				op, val := "eq", valStr
				if len(parts) == 2 {
					op, val = parts[0], parts[1]
				}
				qb.Where(col, op, val)
			}
		}

		// 5. Sorting and Pagination
		if orderBy != "" {
			qb.Order(orderBy)
		} else if validCols["created_at"] {
			qb.Order("created_at DESC")
		}
		qb.Paginate(limit, offset)

		// 5. Execution - Count
		importTime := time.Now()
		countQuery, args := qb.BuildCount()
		if err := tx.QueryRow(ctx, countQuery, args...).Scan(&result.Total); err != nil {
			fmt.Printf("[DB ARCH] Count failed for %s: %v | Query: %s\n", collectionName, err, countQuery)
			return err
		}
		countDuration := time.Since(importTime)

		// 6. Execution - Data
		dataTime := time.Now()
		dataQuery, args := qb.BuildSelect()
		rows, err := tx.Query(ctx, dataQuery, args...)
		if err != nil {
			fmt.Printf("[DB ARCH] Select failed for %s: %v | Query: %s\n", collectionName, err, dataQuery)
			return err
		}
		defer rows.Close()

		result.Data, err = rowsToMaps(rows)
		dataDuration := time.Since(dataTime)

		fmt.Printf("[PERF] %s: Total=%d | DataCount=%d | CountTime=%v | DataTime=%v | Query=%s | Args=%v\n",
			collectionName, result.Total, len(result.Data), countDuration, dataDuration, dataQuery, args)

		return err
	})

	return result, err
}

// GetRecord fetches a single record, respecting RLS
func (db *DB) GetRecord(ctx context.Context, collectionName, id string, ownerField, ownerID string) (map[string]any, error) {
	var record map[string]any
	err := db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		where := "id = $1"
		var queryArgs []any
		queryArgs = append(queryArgs, id)
		argIdx := 2

		if db.HasColumn(ctx, collectionName, "deleted_at") {
			where += " AND deleted_at IS NULL"
		}

		if ownerField != "" && ownerID != "" && db.HasColumn(ctx, collectionName, ownerField) {
			where += fmt.Sprintf(" AND %s = $%d", ownerField, argIdx)
			queryArgs = append(queryArgs, ownerID)
		}

		query := fmt.Sprintf("SELECT * FROM %s WHERE %s", collectionName, where)
		rows, err := tx.Query(ctx, query, queryArgs...)
		if err != nil {
			return err
		}
		defer rows.Close()

		records, err := rowsToMaps(rows)
		if err != nil {
			return err
		}
		if len(records) == 0 {
			return fmt.Errorf("record not found")
		}
		record = records[0]
		return nil
	})
	return record, err
}

// UpdateRecord updates a record, respecting RLS
func (db *DB) UpdateRecord(ctx context.Context, collectionName, id string, data map[string]any, ownerField, ownerID string) error {
	return db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		var updates []string
		var values []any
		i := 1

		for col, val := range data {
			if !IsValidIdentifier(col) {
				continue
			}
			if col == "id" || col == "created_at" || col == "updated_at" {
				continue
			}
			updates = append(updates, fmt.Sprintf("%s = $%d", col, i))
			values = append(values, val)
			i++
		}

		if len(updates) == 0 {
			return nil
		}

		query := fmt.Sprintf("UPDATE %s SET %s, updated_at = NOW() WHERE id = $%d",
			collectionName, strings.Join(updates, ", "), i)
		values = append(values, id)

		_, err := tx.Exec(ctx, query, values...)
		return err
	})
}

// DeleteRecord soft-deletes a record, respecting RLS
func (db *DB) DeleteRecord(ctx context.Context, collectionName, id string, ownerField, ownerID string) error {
	return db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		query := fmt.Sprintf("UPDATE %s SET deleted_at = NOW() WHERE id = $1", collectionName)
		_, err := tx.Exec(ctx, query, id)
		return err
	})
}

func rowsToMaps(rows pgx.Rows) ([]map[string]any, error) {
	fieldDescriptions := rows.FieldDescriptions()
	var results []map[string]any

	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}

		record := make(map[string]any)
		for i, fd := range fieldDescriptions {
			record[string(fd.Name)] = values[i]
		}
		results = append(results, record)
	}

	return results, rows.Err()
}

// BulkInsertRecord inserts multiple records
func (db *DB) BulkInsertRecord(ctx context.Context, collectionName string, records []map[string]any) error {
	return db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		for _, data := range records {
			var columns []string
			var placeholders []string
			var values []any
			i := 1

			for col, val := range data {
				if !IsValidIdentifier(col) {
					continue
				}
				if col == "id" || col == "created_at" || col == "updated_at" {
					continue
				}
				columns = append(columns, col)
				placeholders = append(placeholders, fmt.Sprintf("$%d", i))
				values = append(values, val)
				i++
			}

			if len(columns) == 0 {
				continue
			}
			query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
				collectionName, strings.Join(columns, ", "), strings.Join(placeholders, ", "))
			_, err := tx.Exec(ctx, query, values...)
			if err != nil {
				return err
			}
		}
		return nil
	})
}
