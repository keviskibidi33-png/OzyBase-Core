package api

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/labstack/echo/v4"
)

const sqlExecutionTimeout = 30 * time.Second
const defaultSQLEditorMaxRows = 1000

type SQLExecuteRequest struct {
	Query string `json:"query"`
}

type SQLSyncResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

type SQLExecuteResponse struct {
	Columns       []string        `json:"columns"`
	Rows          [][]interface{} `json:"rows"`
	RowCount      int             `json:"rowCount"`
	ResultLimit   int             `json:"resultLimit"`
	Truncated     bool            `json:"truncated"`
	ExecutionTime string          `json:"executionTime"`
	Command       string          `json:"command"`
	StatementKind string          `json:"statementKind"`
	RowsAffected  int64           `json:"rowsAffected"`
	HasResultSet  bool            `json:"hasResultSet"`
	Message       string          `json:"message"`
}

type sqlTableMutation struct {
	Action        string
	TableName     string
	PreviousTable string
}

var (
	qualifiedSQLIdentifierPattern = `((?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*))?)`
	createTableSQLPattern         = regexp.MustCompile(`(?is)^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?` + qualifiedSQLIdentifierPattern)
	alterTableSQLPattern          = regexp.MustCompile(`(?is)^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?` + qualifiedSQLIdentifierPattern)
	alterTableRenameSQLPattern    = regexp.MustCompile(`(?is)^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?` + qualifiedSQLIdentifierPattern + `\s+RENAME\s+TO\s+((?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*))`)
	dropTableSQLPattern           = regexp.MustCompile(`(?is)^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.+?)(?:\s+CASCADE|\s+RESTRICT)?\s*$`)
)

// HandleExecuteSQL executes a raw SQL query provided by the admin
func (h *Handler) HandleExecuteSQL(c echo.Context) error {
	var req SQLExecuteRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	if req.Query == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Query cannot be empty"})
	}

	start := time.Now()
	ctx, cancel := context.WithTimeout(c.Request().Context(), sqlExecutionTimeout)
	defer cancel()

	statementKind := sqlStatementKind(req.Query)
	workspaceID, _ := c.Get("workspace_id").(string)

	if !sqlQueryProducesRows(req.Query) {
		tag, err := h.DB.Pool.Exec(ctx, req.Query)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}

		duration := time.Since(start)
		rowsAffected := tag.RowsAffected()
		h.syncCollectionsAfterSQL(ctx, req.Query, workspaceID)

		return c.JSON(http.StatusOK, SQLExecuteResponse{
			Columns:       []string{},
			Rows:          [][]interface{}{},
			RowCount:      0,
			ResultLimit:   resolveSQLEditorMaxRows(),
			Truncated:     false,
			ExecutionTime: duration.String(),
			Command:       sqlCommandLabel(tag.String(), statementKind),
			StatementKind: statementKind,
			RowsAffected:  rowsAffected,
			HasResultSet:  false,
			Message:       sqlExecutionMessage(statementKind, false, 0, rowsAffected),
		})
	}

	// Execute the query
	rows, err := h.DB.Pool.Query(ctx, req.Query)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	// Get column descriptions
	fieldDescriptions := rows.FieldDescriptions()
	columns := make([]string, len(fieldDescriptions))
	for i, fd := range fieldDescriptions {
		columns[i] = string(fd.Name)
	}

	// Fetch rows
	var resultRows [][]interface{}
	rowCount := 0
	rowLimit := resolveSQLEditorMaxRows()
	truncated := false

	for rows.Next() {
		// Create a slice of interface{} to hold the values
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to scan rows: " + err.Error()})
		}

		for i := range values {
			values[i] = normalizeSQLResultValue(values[i])
		}

		if rowCount < rowLimit {
			resultRows = append(resultRows, values)
			rowCount++
			continue
		}

		truncated = true
		break
	}

	if rows.Err() != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Error iterating rows: " + rows.Err().Error()})
	}

	tag := rows.CommandTag()
	duration := time.Since(start)
	rowsAffected := tag.RowsAffected()

	return c.JSON(http.StatusOK, SQLExecuteResponse{
		Columns:       columns,
		Rows:          resultRows,
		RowCount:      rowCount,
		ResultLimit:   rowLimit,
		Truncated:     truncated,
		ExecutionTime: duration.String(),
		Command:       sqlCommandLabel(tag.String(), statementKind),
		StatementKind: statementKind,
		RowsAffected:  rowsAffected,
		HasResultSet:  true,
		Message:       sqlExecutionMessage(statementKind, true, rowCount, rowsAffected),
	})
}

func resolveSQLEditorMaxRows() int {
	raw := strings.TrimSpace(os.Getenv("OZY_SQL_EDITOR_MAX_ROWS"))
	if raw == "" {
		return defaultSQLEditorMaxRows
	}

	value, err := strconv.Atoi(raw)
	if err != nil {
		return defaultSQLEditorMaxRows
	}
	if value < 100 {
		return 100
	}
	if value > 10000 {
		return 10000
	}
	return value
}

func (h *Handler) syncCollectionsAfterSQL(ctx context.Context, query string, workspaceID string) {
	mutations := extractSQLTableMutations(query)
	if len(mutations) == 0 {
		return
	}

	for _, mutation := range mutations {
		var err error
		switch mutation.Action {
		case "upsert":
			err = h.upsertCollectionMetadataForTable(ctx, mutation.TableName, workspaceID)
		case "rename":
			err = h.renameCollectionMetadataForTable(ctx, mutation.PreviousTable, mutation.TableName, workspaceID)
		case "drop":
			err = h.deleteCollectionMetadataForTable(ctx, mutation.TableName)
		}
		if err != nil {
			log.Printf("⚠️ Warning: Failed to sync SQL collection metadata for %s (%s): %v", mutation.TableName, mutation.Action, err)
		}
	}
}

func extractSQLTableMutations(query string) []sqlTableMutation {
	statements := splitSQLStatements(query)
	mutations := make([]sqlTableMutation, 0, len(statements))
	seen := make(map[string]struct{})

	appendMutation := func(item sqlTableMutation) {
		key := strings.Join([]string{item.Action, item.PreviousTable, item.TableName}, "|")
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		mutations = append(mutations, item)
	}

	for _, statement := range statements {
		switch {
		case alterTableRenameSQLPattern.MatchString(statement):
			match := alterTableRenameSQLPattern.FindStringSubmatch(statement)
			oldTableName, okOld := normalizePublicTableIdentifier(match[1])
			newTableName, okNew := normalizePublicTableIdentifier(match[2])
			if okOld && okNew {
				appendMutation(sqlTableMutation{
					Action:        "rename",
					TableName:     newTableName,
					PreviousTable: oldTableName,
				})
			}
		case createTableSQLPattern.MatchString(statement):
			match := createTableSQLPattern.FindStringSubmatch(statement)
			if tableName, ok := normalizePublicTableIdentifier(match[1]); ok {
				appendMutation(sqlTableMutation{Action: "upsert", TableName: tableName})
			}
		case alterTableSQLPattern.MatchString(statement):
			match := alterTableSQLPattern.FindStringSubmatch(statement)
			if tableName, ok := normalizePublicTableIdentifier(match[1]); ok {
				appendMutation(sqlTableMutation{Action: "upsert", TableName: tableName})
			}
		case dropTableSQLPattern.MatchString(statement):
			match := dropTableSQLPattern.FindStringSubmatch(statement)
			for _, rawTarget := range splitDDLTargetList(match[1]) {
				if tableName, ok := normalizePublicTableIdentifier(rawTarget); ok {
					appendMutation(sqlTableMutation{Action: "drop", TableName: tableName})
				}
			}
		}
	}

	return mutations
}

func splitSQLStatements(raw string) []string {
	var (
		builder        strings.Builder
		statements     []string
		inSingleQuote  bool
		inDoubleQuote  bool
		inLineComment  bool
		inBlockComment bool
	)

	flush := func() {
		statement := strings.TrimSpace(builder.String())
		if statement != "" {
			statements = append(statements, statement)
		}
		builder.Reset()
	}

	for i := 0; i < len(raw); i++ {
		ch := raw[i]

		if inLineComment {
			if ch == '\n' {
				inLineComment = false
				builder.WriteByte('\n')
			}
			continue
		}
		if inBlockComment {
			if ch == '*' && i+1 < len(raw) && raw[i+1] == '/' {
				inBlockComment = false
				i++
			}
			continue
		}
		if inSingleQuote {
			builder.WriteByte(ch)
			if ch == '\'' {
				if i+1 < len(raw) && raw[i+1] == '\'' {
					builder.WriteByte(raw[i+1])
					i++
				} else {
					inSingleQuote = false
				}
			}
			continue
		}
		if inDoubleQuote {
			builder.WriteByte(ch)
			if ch == '"' {
				if i+1 < len(raw) && raw[i+1] == '"' {
					builder.WriteByte(raw[i+1])
					i++
				} else {
					inDoubleQuote = false
				}
			}
			continue
		}

		if ch == '-' && i+1 < len(raw) && raw[i+1] == '-' {
			inLineComment = true
			i++
			continue
		}
		if ch == '/' && i+1 < len(raw) && raw[i+1] == '*' {
			inBlockComment = true
			i++
			continue
		}
		if ch == '\'' {
			inSingleQuote = true
			builder.WriteByte(ch)
			continue
		}
		if ch == '"' {
			inDoubleQuote = true
			builder.WriteByte(ch)
			continue
		}
		if ch == ';' {
			flush()
			continue
		}

		builder.WriteByte(ch)
	}

	flush()
	return statements
}

func splitDDLTargetList(raw string) []string {
	items := []string{}
	var (
		builder       strings.Builder
		inDoubleQuote bool
	)

	flush := func() {
		item := strings.TrimSpace(builder.String())
		if item != "" {
			items = append(items, item)
		}
		builder.Reset()
	}

	for i := 0; i < len(raw); i++ {
		ch := raw[i]
		if inDoubleQuote {
			builder.WriteByte(ch)
			if ch == '"' {
				if i+1 < len(raw) && raw[i+1] == '"' {
					builder.WriteByte(raw[i+1])
					i++
				} else {
					inDoubleQuote = false
				}
			}
			continue
		}
		if ch == '"' {
			inDoubleQuote = true
			builder.WriteByte(ch)
			continue
		}
		if ch == ',' {
			flush()
			continue
		}
		builder.WriteByte(ch)
	}

	flush()
	return items
}

func normalizePublicTableIdentifier(raw string) (string, bool) {
	parts := splitQualifiedIdentifier(raw)
	if len(parts) == 0 || len(parts) > 2 {
		return "", false
	}

	normalizePart := func(part string) (string, bool) {
		part = strings.TrimSpace(part)
		if part == "" {
			return "", false
		}
		if strings.HasPrefix(part, "\"") && strings.HasSuffix(part, "\"") {
			part = strings.TrimPrefix(strings.TrimSuffix(part, "\""), "\"")
			part = strings.ReplaceAll(part, `""`, `"`)
		}
		if !data.IsValidIdentifier(part) {
			return "", false
		}
		return part, true
	}

	if len(parts) == 1 {
		tableName, ok := normalizePart(parts[0])
		return tableName, ok
	}

	schemaName, ok := normalizePart(parts[0])
	if !ok || !strings.EqualFold(schemaName, "public") {
		return "", false
	}

	tableName, ok := normalizePart(parts[1])
	return tableName, ok
}

func splitQualifiedIdentifier(raw string) []string {
	parts := []string{}
	var (
		builder       strings.Builder
		inDoubleQuote bool
	)

	flush := func() {
		part := strings.TrimSpace(builder.String())
		if part != "" {
			parts = append(parts, part)
		}
		builder.Reset()
	}

	for i := 0; i < len(raw); i++ {
		ch := raw[i]
		if inDoubleQuote {
			builder.WriteByte(ch)
			if ch == '"' {
				if i+1 < len(raw) && raw[i+1] == '"' {
					builder.WriteByte(raw[i+1])
					i++
				} else {
					inDoubleQuote = false
				}
			}
			continue
		}
		if ch == '"' {
			inDoubleQuote = true
			builder.WriteByte(ch)
			continue
		}
		if ch == '.' {
			flush()
			continue
		}
		builder.WriteByte(ch)
	}

	flush()
	return parts
}

func sqlQueryProducesRows(query string) bool {
	switch sqlStatementKind(query) {
	case "SELECT", "WITH", "SHOW", "EXPLAIN", "VALUES", "TABLE":
		return true
	case "INSERT", "UPDATE", "DELETE", "MERGE":
		return strings.Contains(strings.ToUpper(trimLeadingSQLComments(query)), "RETURNING")
	default:
		return false
	}
}

func sqlCommandLabel(commandTag string, statementKind string) string {
	commandTag = strings.TrimSpace(commandTag)
	if commandTag != "" {
		return commandTag
	}
	return statementKind
}

func sqlExecutionMessage(statementKind string, hasResultSet bool, rowCount int, rowsAffected int64) string {
	switch {
	case hasResultSet:
		return fmt.Sprintf("%s returned %d row(s).", statementKind, rowCount)
	case rowsAffected > 0:
		return fmt.Sprintf("%s executed successfully. %d row(s) affected.", statementKind, rowsAffected)
	default:
		return fmt.Sprintf("%s executed successfully.", statementKind)
	}
}

func normalizeSQLResultValue(value any) any {
	switch v := value.(type) {
	case nil:
		return nil
	case time.Time:
		return v.UTC().Format(time.RFC3339Nano)
	case []byte:
		if utf8.Valid(v) {
			return string(v)
		}
		return base64.StdEncoding.EncodeToString(v)
	case fmt.Stringer:
		return v.String()
	case []any:
		out := make([]any, len(v))
		for i := range v {
			out[i] = normalizeSQLResultValue(v[i])
		}
		return out
	default:
		return value
	}
}

// HandleSyncSystem triggers the internal migrations to repair system schema
func (h *Handler) HandleSyncSystem(c echo.Context) error {
	if err := h.DB.RunMigrations(c.Request().Context()); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to sync system schema: " + err.Error()})
	}

	return c.JSON(http.StatusOK, SQLSyncResponse{
		Status:  "success",
		Message: "System schema synced and repaired successfully",
	})
}
