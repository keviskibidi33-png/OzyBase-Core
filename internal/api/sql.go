package api

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/labstack/echo/v4"
)

const sqlExecutionTimeout = 30 * time.Second

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
	ExecutionTime string          `json:"executionTime"`
	Command       string          `json:"command"`
	StatementKind string          `json:"statementKind"`
	RowsAffected  int64           `json:"rowsAffected"`
	HasResultSet  bool            `json:"hasResultSet"`
	Message       string          `json:"message"`
}

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

	if !sqlQueryProducesRows(req.Query) {
		tag, err := h.DB.Pool.Exec(ctx, req.Query)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
		}

		duration := time.Since(start)
		rowsAffected := tag.RowsAffected()

		return c.JSON(http.StatusOK, SQLExecuteResponse{
			Columns:       []string{},
			Rows:          [][]interface{}{},
			RowCount:      0,
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

		resultRows = append(resultRows, values)
		rowCount++
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
		ExecutionTime: duration.String(),
		Command:       sqlCommandLabel(tag.String(), statementKind),
		StatementKind: statementKind,
		RowsAffected:  rowsAffected,
		HasResultSet:  true,
		Message:       sqlExecutionMessage(statementKind, true, rowCount, rowsAffected),
	})
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
