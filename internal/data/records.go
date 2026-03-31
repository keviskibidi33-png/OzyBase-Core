package data

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

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
	Data       []map[string]any
	Total      int64
	HasMore    bool
	TotalExact bool
}

type recordCountMode string

const (
	recordCountExact    recordCountMode = "exact"
	recordCountDeferred recordCountMode = "deferred"
	recordCountAuto     recordCountMode = "auto"
)

func isSearchableRecordColumnType(dataType string) bool {
	switch strings.ToLower(strings.TrimSpace(dataType)) {
	case "text", "character varying", "varchar", "character", "char", "uuid", "citext":
		return true
	default:
		return false
	}
}

func buildRecordSearchClause(columnTypes map[string]string, placeholder string) string {
	searchableColumns := make([]string, 0, len(columnTypes))
	for columnName, dataType := range columnTypes {
		if !IsValidIdentifier(columnName) {
			continue
		}
		if columnName == "deleted_at" {
			continue
		}
		if columnName == "id" || isSearchableRecordColumnType(dataType) {
			searchableColumns = append(searchableColumns, columnName)
		}
	}
	if len(searchableColumns) == 0 {
		return ""
	}

	sort.Strings(searchableColumns)

	searchClauses := make([]string, 0, len(searchableColumns))
	for _, columnName := range searchableColumns {
		searchClauses = append(searchClauses, fmt.Sprintf("%s::text ILIKE %s", columnName, placeholder))
	}

	return "(" + strings.Join(searchClauses, " OR ") + ")"
}

func normalizeRecordCountMode(filters map[string][]string) recordCountMode {
	if filters["skip_count"] != nil {
		return recordCountDeferred
	}
	if rawModes, ok := filters["count_mode"]; ok {
		for _, rawMode := range rawModes {
			switch strings.ToLower(strings.TrimSpace(rawMode)) {
			case string(recordCountDeferred), "skip":
				return recordCountDeferred
			case string(recordCountAuto):
				return recordCountAuto
			case string(recordCountExact):
				return recordCountExact
			}
		}
	}
	return recordCountExact
}

func shouldUseDeferredRecordCount(mode recordCountMode, hasSearch bool, offset int, filterCount int) bool {
	switch mode {
	case recordCountDeferred:
		return true
	case recordCountAuto:
		return hasSearch || offset > 0 || filterCount > 0
	default:
		return false
	}
}

// ListRecords fetches all records with filters and sorting, respecting RLS if configured in DB.
// This implementation uses a structured QueryBuilder for improved maintainability.
func (db *DB) ListRecords(ctx context.Context, collectionName string, filters map[string][]string, orderBy string, limit, offset int) (*ListRecordsResult, error) {
	if !IsValidIdentifier(collectionName) {
		return nil, fmt.Errorf("invalid collection name: %s", collectionName)
	}

	result := &ListRecordsResult{
		Data:       []map[string]any{},
		TotalExact: true,
	}

	isSystemTable := strings.HasPrefix(collectionName, "_v_") || strings.HasPrefix(collectionName, "_ozy_")

	// 1. Fetch ALL columns dynamically for precise validation
	validCols, err := db.GetTableColumns(ctx, collectionName)
	if err != nil {
		return nil, err
	}
	columnTypes, err := db.GetTableColumnTypes(ctx, collectionName)
	if err != nil {
		return nil, err
	}
	if len(validCols) == 0 {
		return nil, fmt.Errorf("table not found or empty: %s", collectionName)
	}

	err = db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		qb := NewQueryBuilder(collectionName)
		hasSearch := false
		filterCount := 0

		// 2. Structural Filters (Soft Delete) - Only if column exists
		if !isSystemTable && validCols["deleted_at"] {
			qb.whereClauses = append(qb.whereClauses, "deleted_at IS NULL")
		}

		// 3. Search Logic
		if qValues, ok := filters["q"]; ok && len(qValues) > 0 && qValues[0] != "" {
			hasSearch = true
			placeholder := fmt.Sprintf("$%d", qb.argIdx)
			if searchClause := buildRecordSearchClause(columnTypes, placeholder); searchClause != "" {
				qb.whereClauses = append(qb.whereClauses, searchClause)
				qb.args = append(qb.args, "%"+qValues[0]+"%")
				qb.argIdx++
			} else if validCols["id"] {
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
				filterCount++
				parts := strings.SplitN(valStr, ".", 2)
				op, val := "eq", valStr
				if len(parts) == 2 {
					op, val = parts[0], parts[1]
				}
				qb.Where(col, op, val)
			}
		}

		// 5. Sorting and Pagination
		skipCount := shouldUseDeferredRecordCount(normalizeRecordCountMode(filters), hasSearch, offset, filterCount)
		if orderBy != "" {
			qb.Order(orderBy)
		} else if validCols["created_at"] {
			qb.Order("created_at DESC")
		}
		queryLimit := limit
		if skipCount && limit > 0 {
			queryLimit = limit + 1
		}
		qb.Paginate(queryLimit, offset)

		// 5. Execution - Count (Optional for performance)
		if !skipCount {
			countQuery, args := qb.BuildCount()
			if err := tx.QueryRow(ctx, countQuery, args...).Scan(&result.Total); err != nil {
				return err
			}
		} else {
			result.Total = -1 // Indicator that count was skipped
			result.TotalExact = false
		}

		// 6. Execution - Data
		dataQuery, args := qb.BuildSelect()
		rows, err := tx.Query(ctx, dataQuery, args...)
		if err != nil {
			return err
		}
		defer rows.Close()

		result.Data, err = rowsToMaps(rows)
		if err != nil {
			return err
		}

		if skipCount && limit > 0 && len(result.Data) > limit {
			result.HasMore = true
			result.Data = result.Data[:limit]
		}

		if !result.TotalExact {
			result.Total = int64(offset + len(result.Data))
			if result.HasMore {
				result.Total++
			}
		}

		return nil
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

		query := fmt.Sprintf("UPDATE %s SET %s, updated_at = NOW() WHERE id::text = $%d",
			collectionName, strings.Join(updates, ", "), i)
		values = append(values, id)
		i++

		if db.HasColumn(ctx, collectionName, "deleted_at") {
			query += " AND deleted_at IS NULL"
		}

		if ownerField != "" && ownerID != "" && db.HasColumn(ctx, collectionName, ownerField) {
			query += fmt.Sprintf(" AND %s = $%d", ownerField, i)
			values = append(values, ownerID)
		}

		_, err := tx.Exec(ctx, query, values...)
		return err
	})
}

// DeleteRecord soft-deletes a record, respecting RLS
func (db *DB) DeleteRecord(ctx context.Context, collectionName, id string, ownerField, ownerID string) error {
	return db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		query := fmt.Sprintf("UPDATE %s SET deleted_at = NOW() WHERE id::text = $1", collectionName)
		args := []any{id}
		argIdx := 2

		if db.HasColumn(ctx, collectionName, "deleted_at") {
			query += " AND deleted_at IS NULL"
		}

		if ownerField != "" && ownerID != "" && db.HasColumn(ctx, collectionName, ownerField) {
			query += fmt.Sprintf(" AND %s = $%d", ownerField, argIdx)
			args = append(args, ownerID)
		}

		_, err := tx.Exec(ctx, query, args...)
		return err
	})
}

// BulkUpdateRecords updates multiple records in one statement.
func (db *DB) BulkUpdateRecords(ctx context.Context, collectionName string, ids []string, data map[string]any, ownerField, ownerID string) (int64, error) {
	if !IsValidIdentifier(collectionName) {
		return 0, fmt.Errorf("invalid collection name: %s", collectionName)
	}
	if len(ids) == 0 {
		return 0, nil
	}

	var affected int64
	err := db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		var updates []string
		var args []any
		argIdx := 1

		for col, val := range data {
			if !IsValidIdentifier(col) {
				continue
			}
			if col == "id" || col == "created_at" || col == "updated_at" || col == "deleted_at" {
				continue
			}
			updates = append(updates, fmt.Sprintf("%s = $%d", col, argIdx))
			args = append(args, val)
			argIdx++
		}

		if len(updates) == 0 {
			return fmt.Errorf("no valid fields provided for bulk update")
		}
		if db.HasColumn(ctx, collectionName, "updated_at") {
			updates = append(updates, "updated_at = NOW()")
		}

		query := fmt.Sprintf("UPDATE %s SET %s WHERE id::text = ANY($%d::text[])", collectionName, strings.Join(updates, ", "), argIdx)
		args = append(args, ids)
		argIdx++

		if db.HasColumn(ctx, collectionName, "deleted_at") {
			query += " AND deleted_at IS NULL"
		}

		if ownerField != "" && ownerID != "" && db.HasColumn(ctx, collectionName, ownerField) {
			query += fmt.Sprintf(" AND %s = $%d", ownerField, argIdx)
			args = append(args, ownerID)
		}

		result, err := tx.Exec(ctx, query, args...)
		if err != nil {
			return err
		}
		affected = result.RowsAffected()
		return nil
	})
	return affected, err
}

// BulkDeleteRecords soft-deletes multiple records in one statement.
func (db *DB) BulkDeleteRecords(ctx context.Context, collectionName string, ids []string, ownerField, ownerID string) (int64, error) {
	if !IsValidIdentifier(collectionName) {
		return 0, fmt.Errorf("invalid collection name: %s", collectionName)
	}
	if len(ids) == 0 {
		return 0, nil
	}

	var affected int64
	err := db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		query := fmt.Sprintf("UPDATE %s SET deleted_at = NOW() WHERE id::text = ANY($1::text[])", collectionName)
		args := []any{ids}
		argIdx := 2

		if db.HasColumn(ctx, collectionName, "deleted_at") {
			query += " AND deleted_at IS NULL"
		}

		if ownerField != "" && ownerID != "" && db.HasColumn(ctx, collectionName, ownerField) {
			query += fmt.Sprintf(" AND %s = $%d", ownerField, argIdx)
			args = append(args, ownerID)
		}

		result, err := tx.Exec(ctx, query, args...)
		if err != nil {
			return err
		}
		affected = result.RowsAffected()
		return nil
	})
	return affected, err
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

// BulkInsertRecord inserts multiple records in chunks while preserving
// PostgreSQL type coercion and surfacing row-level errors when a chunk fails.
func (db *DB) BulkInsertRecord(ctx context.Context, collectionName string, records []map[string]any) error {
	if len(records) == 0 {
		return nil
	}

	if !IsValidIdentifier(collectionName) {
		return fmt.Errorf("invalid collection name: %s", collectionName)
	}

	validCols, err := db.GetTableColumns(ctx, collectionName)
	if err != nil {
		return err
	}

	columns := collectBulkInsertColumns(validCols, records)

	if len(columns) == 0 {
		return fmt.Errorf("no valid columns found for import")
	}

	return db.WithTransactionAndRLS(ctx, func(tx pgx.Tx) error {
		chunkSize := bulkInsertChunkSize(len(columns))
		for start := 0; start < len(records); start += chunkSize {
			end := start + chunkSize
			if end > len(records) {
				end = len(records)
			}
			if err := execBulkInsertChunk(ctx, tx, collectionName, columns, records[start:end], start); err != nil {
				return err
			}
		}
		return nil
	})
}

func collectBulkInsertColumns(validCols map[string]bool, records []map[string]any) []string {
	columnSet := make(map[string]struct{})
	for _, record := range records {
		for col := range record {
			if !IsValidIdentifier(col) || !validCols[col] {
				continue
			}
			if col == "id" || col == "created_at" || col == "updated_at" || col == "deleted_at" {
				continue
			}
			columnSet[col] = struct{}{}
		}
	}

	columns := make([]string, 0, len(columnSet))
	for col := range columnSet {
		columns = append(columns, col)
	}
	sort.Strings(columns)
	return columns
}

func bulkInsertChunkSize(columnCount int) int {
	if columnCount <= 0 {
		return 1
	}

	const maxParams = 65535
	const maxRowsPerChunk = 250

	chunkSize := maxParams / columnCount
	if chunkSize < 1 {
		return 1
	}
	if chunkSize > maxRowsPerChunk {
		return maxRowsPerChunk
	}
	return chunkSize
}

func execBulkInsertChunk(ctx context.Context, tx pgx.Tx, collectionName string, columns []string, records []map[string]any, rowOffset int) error {
	query, values := buildBulkInsertStatement(collectionName, columns, records)
	if _, err := tx.Exec(ctx, query, values...); err != nil {
		if len(records) == 1 {
			return fmt.Errorf("row %d import failed: %w", rowOffset+1, err)
		}
		for index, record := range records {
			if rowErr := execBulkInsertChunk(ctx, tx, collectionName, columns, []map[string]any{record}, rowOffset+index); rowErr != nil {
				return rowErr
			}
		}
		return err
	}
	return nil
}

func buildBulkInsertStatement(collectionName string, columns []string, records []map[string]any) (string, []any) {
	var builder strings.Builder
	builder.Grow(len(collectionName) + len(columns)*16 + len(records)*len(columns)*6)
	builder.WriteString("INSERT INTO ")
	builder.WriteString(collectionName)
	builder.WriteString(" (")
	builder.WriteString(strings.Join(columns, ", "))
	builder.WriteString(") VALUES ")

	values := make([]any, 0, len(records)*len(columns))
	argIndex := 1

	for rowIndex, record := range records {
		if rowIndex > 0 {
			builder.WriteString(", ")
		}
		builder.WriteString("(")
		for colIndex, col := range columns {
			if colIndex > 0 {
				builder.WriteString(", ")
			}
			builder.WriteString("$")
			builder.WriteString(strconv.Itoa(argIndex))
			values = append(values, normalizeBulkInsertValue(record[col]))
			argIndex++
		}
		builder.WriteString(")")
	}

	return builder.String(), values
}

func normalizeBulkInsertValue(value any) any {
	raw, ok := value.(string)
	if !ok {
		return value
	}

	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	return trimmed
}
