package data

import (
	"context"
	"fmt"
	"strings"
)

// FieldSchema represents a single field in a collection schema
type FieldSchema struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Required bool   `json:"required,omitempty"`
	Default  any    `json:"default,omitempty"`
}

// TypeMapping maps OzyBase types to PostgreSQL types
var TypeMapping = map[string]string{
	"int2":        "INT2",
	"int4":        "INT4",
	"int8":        "INT8",
	"float4":      "FLOAT4",
	"float8":      "FLOAT8",
	"numeric":     "NUMERIC",
	"json":        "JSON",
	"jsonb":       "JSONB",
	"text":        "TEXT",
	"varchar":     "VARCHAR",
	"uuid":        "UUID",
	"date":        "DATE",
	"time":        "TIME",
	"timetz":      "TIMETZ",
	"timestamp":   "TIMESTAMP",
	"timestamptz": "TIMESTAMPTZ",
	"bool":        "BOOL",
	"boolean":     "BOOLEAN",
	"bytea":       "BYTEA",
	"inet":        "INET",
	"cidr":        "CIDR",
	"macaddr":     "MACADDR",
	"interval":    "INTERVAL",
	"money":       "MONEY",
	"text_array":  "TEXT[]",
	"int_array":   "INT4[]",
	// Aliases
	"number":  "INT4",
	"integer": "INT4",
	"string":  "TEXT",
}

// BuildCreateTableSQL generates a CREATE TABLE statement from a schema definition
func BuildCreateTableSQL(tableName string, schema []FieldSchema) (string, error) {
	if tableName == "" {
		return "", fmt.Errorf("table name cannot be empty")
	}

	if len(schema) == 0 {
		return "", fmt.Errorf("schema cannot be empty")
	}

	// Validate table name (prevent SQL injection)
	if !IsValidIdentifier(tableName) {
		return "", fmt.Errorf("invalid table name: %s", tableName)
	}

	var columns []string

	// Always add id as primary key
	columns = append(columns, "id UUID PRIMARY KEY DEFAULT gen_random_uuid()")

	for _, field := range schema {
		if !IsValidIdentifier(field.Name) {
			return "", fmt.Errorf("invalid field name: %s", field.Name)
		}

		pgType, ok := TypeMapping[strings.ToLower(field.Type)]
		if !ok {
			return "", fmt.Errorf("unknown type: %s", field.Type)
		}

		col := fmt.Sprintf("%s %s", field.Name, pgType)

		if field.Required {
			col += " NOT NULL"
		}

		if field.Default != nil {
			col += fmt.Sprintf(" DEFAULT %s", formatDefault(field.Default, field.Type))
		}

		columns = append(columns, col)
	}

	// Always add timestamps
	columns = append(columns, "created_at TIMESTAMPTZ DEFAULT NOW()")
	columns = append(columns, "updated_at TIMESTAMPTZ DEFAULT NOW()")
	columns = append(columns, "deleted_at TIMESTAMPTZ")

	// #nosec G201
	sql := fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (\n\t%s\n)",
		tableName,
		strings.Join(columns, ",\n\t"))

	return sql, nil
}

// IsValidIdentifier checks if a string is a valid SQL identifier
func IsValidIdentifier(name string) bool {
	if len(name) == 0 || len(name) > 63 {
		return false
	}

	// Must start with letter or underscore
	first := name[0]
	if !((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z') || first == '_') {
		return false
	}

	// Rest can be letters, digits, or underscores
	for _, c := range name[1:] {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
			return false
		}
	}

	return true
}

// formatDefault formats a default value for SQL
func formatDefault(value any, _ string) string {
	switch v := value.(type) {
	case bool:
		if v {
			return "TRUE"
		}
		return "FALSE"
	case string:
		return fmt.Sprintf("'%s'", strings.ReplaceAll(v, "'", "''"))
	case float64, int:
		return fmt.Sprintf("%v", v)
	default:
		return fmt.Sprintf("'%v'", v)
	}
}

// GetTableSchema fetches the schema of a table from information_schema
func (db *DB) GetTableSchema(ctx context.Context, tableName string) ([]FieldSchema, error) {
	if !IsValidIdentifier(tableName) {
		return nil, fmt.Errorf("invalid table name: %s", tableName)
	}

	query := `
		SELECT column_name, data_type, is_nullable
		FROM information_schema.columns
		WHERE table_name = $1
		  AND table_schema = 'public'
		ORDER BY ordinal_position
	`

	rows, err := db.Pool.Query(ctx, query, tableName)
	if err != nil {
		return nil, fmt.Errorf("failed to query table schema: %w", err)
	}
	defer rows.Close()

	var schema []FieldSchema
	for rows.Next() {
		var colName, dataType, isNullable string

		if err := rows.Scan(&colName, &dataType, &isNullable); err != nil {
			return nil, fmt.Errorf("failed to scan column schema: %w", err)
		}

		// Skip internal columns as they are standard across OzyBase tables
		if colName == "id" || colName == "created_at" || colName == "updated_at" {
			continue
		}

		schema = append(schema, FieldSchema{
			Name:     colName,
			Type:     mapPostgresTypeToOzy(dataType),
			Required: isNullable == "NO",
		})
	}

	if len(schema) == 0 {
		return nil, fmt.Errorf("table not found or has no columns: %s", tableName)
	}

	return schema, nil
}

func mapPostgresTypeToOzy(pgType string) string {
	pgType = strings.ToUpper(pgType)
	switch {
	case strings.Contains(pgType, "INT2"):
		return "int2"
	case strings.Contains(pgType, "INT4") || pgType == "INTEGER":
		return "int4"
	case strings.Contains(pgType, "INT8") || pgType == "BIGINT":
		return "int8"
	case strings.Contains(pgType, "FLOAT4") || strings.Contains(pgType, "REAL"):
		return "float4"
	case strings.Contains(pgType, "FLOAT8") || strings.Contains(pgType, "DOUBLE PRECISION"):
		return "float8"
	case strings.Contains(pgType, "NUMERIC"):
		return "numeric"
	case strings.Contains(pgType, "JSONB"):
		return "jsonb"
	case strings.Contains(pgType, "JSON"):
		return "json"
	case pgType == "UUID":
		return "uuid"
	case pgType == "DATE":
		return "date"
	case pgType == "TIMETZ":
		return "timetz"
	case pgType == "TIME":
		return "time"
	case strings.Contains(pgType, "TIMESTAMPTZ"):
		return "timestamptz"
	case strings.Contains(pgType, "TIMESTAMP"):
		return "timestamp"
	case pgType == "BOOL" || pgType == "BOOLEAN":
		return "bool"
	case strings.Contains(pgType, "VARCHAR"):
		return "varchar"
	case strings.Contains(pgType, "TEXT"):
		return "text"
	case pgType == "BYTEA":
		return "bytea"
	case pgType == "INET":
		return "inet"
	case pgType == "CIDR":
		return "cidr"
	case pgType == "MACADDR":
		return "macaddr"
	case pgType == "INTERVAL":
		return "interval"
	case pgType == "MONEY":
		return "money"
	case strings.Contains(pgType, "ARRAY") || strings.Contains(pgType, "[]"):
		if strings.Contains(pgType, "INT") {
			return "int_array"
		}
		return "text_array"
	default:
		return "text"
	}
}

// DatabaseSchema represents the full schema of the database
type DatabaseSchema struct {
	Tables        []TableDefinition   `json:"tables"`
	Relationships []TableRelationship `json:"relationships"`
}

type TableDefinition struct {
	Name     string        `json:"name"`
	IsSystem bool          `json:"is_system"`
	Columns  []FieldSchema `json:"columns"`
}

type TableRelationship struct {
	FromTable string `json:"from_table"`
	FromCol   string `json:"from_col"`
	ToTable   string `json:"to_table"`
	ToCol     string `json:"to_col"`
}

// GetDatabaseSchema fetches the full schema for visualization
func (db *DB) GetDatabaseSchema(ctx context.Context) (*DatabaseSchema, error) {
	// 1. Get all tables
	tables, err := db.ListTables(ctx)
	if err != nil {
		return nil, err
	}

	var schema DatabaseSchema

	// 2. Get columns for each table
	for _, tableName := range tables {
		// reuse GetTableSchema logic but include system cols for visualization
		query := `
			SELECT column_name, data_type, is_nullable
			FROM information_schema.columns
			WHERE table_name = $1
			  AND table_schema = 'public'
			ORDER BY ordinal_position
		`
		rows, err := db.Pool.Query(ctx, query, tableName)
		if err != nil {
			continue // skip table on error
		}

		var cols []FieldSchema
		for rows.Next() {
			var colName, dataType, isNullable string
			if err := rows.Scan(&colName, &dataType, &isNullable); err == nil {
				cols = append(cols, FieldSchema{
					Name:     colName,
					Type:     mapPostgresTypeToOzy(dataType), // simplified type
					Required: isNullable == "NO",
				})
			}
		}
		rows.Close()

		schema.Tables = append(schema.Tables, TableDefinition{
			Name:     tableName,
			IsSystem: strings.HasPrefix(tableName, "_v_") || strings.HasPrefix(tableName, "_ozy_"),
			Columns:  cols,
		})
	}

	// 3. Get relationships (Foreign Keys)
	relQuery := `
		SELECT
			tc.table_name,
			kcu.column_name,
			ccu.table_name AS foreign_table_name,
			ccu.column_name AS foreign_column_name
		FROM
			information_schema.table_constraints AS tc
			JOIN information_schema.key_column_usage AS kcu
			  ON tc.constraint_name = kcu.constraint_name
			  AND tc.table_schema = kcu.table_schema
			JOIN information_schema.constraint_column_usage AS ccu
			  ON ccu.constraint_name = tc.constraint_name
			  AND ccu.table_schema = tc.table_schema
		WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';
	`

	rows, err := db.Pool.Query(ctx, relQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch relationships: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var fromTable, fromCol, toTable, toCol string
		if err := rows.Scan(&fromTable, &fromCol, &toTable, &toCol); err == nil {
			schema.Relationships = append(schema.Relationships, TableRelationship{
				FromTable: fromTable,
				FromCol:   fromCol,
				ToTable:   toTable,
				ToCol:     toCol,
			})
		}
	}

	return &schema, nil
}

// AddColumn adds a new column to an existing table
func (db *DB) AddColumn(ctx context.Context, tableName string, field FieldSchema) (string, error) {
	if !IsValidIdentifier(tableName) || !IsValidIdentifier(field.Name) {
		return "", fmt.Errorf("invalid table or column name")
	}

	pgType, ok := TypeMapping[strings.ToLower(field.Type)]
	if !ok {
		return "", fmt.Errorf("unknown type: %s", field.Type)
	}

	// #nosec G201
	sql := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", tableName, field.Name, pgType)
	if field.Required {
		sql += " NOT NULL"
	}
	if field.Default != nil {
		sql += fmt.Sprintf(" DEFAULT %s", formatDefault(field.Default, field.Type))
	}

	_, err := db.Pool.Exec(ctx, sql)
	return sql, err
}

// DeleteColumn removes a column from an existing table
func (db *DB) DeleteColumn(ctx context.Context, tableName string, columnName string) (string, error) {
	if !IsValidIdentifier(tableName) || !IsValidIdentifier(columnName) {
		return "", fmt.Errorf("invalid table or column name")
	}

	// #nosec G201
	sql := fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", tableName, columnName)
	_, err := db.Pool.Exec(ctx, sql)
	return sql, err
}

// DeleteTable drops an existing table
func (db *DB) DeleteTable(ctx context.Context, tableName string) error {
	if !IsValidIdentifier(tableName) {
		return fmt.Errorf("invalid table name: %s", tableName)
	}

	// #nosec G201
	sql := fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE", tableName)
	_, err := db.Pool.Exec(ctx, sql)
	return err
}
