package api

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

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

	// Execute the query
	rows, err := h.DB.Pool.Query(c.Request().Context(), req.Query)
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

		// Clean up values (handle nil, bytes, etc if needed)
		// mpgx often returns appropriate types, but we might want to ensure JSON compatibility
		resultRows = append(resultRows, values)
		rowCount++
	}

	if rows.Err() != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Error iterating rows: " + rows.Err().Error()})
	}

	duration := time.Since(start)

	return c.JSON(http.StatusOK, SQLExecuteResponse{
		Columns:       columns,
		Rows:          resultRows,
		RowCount:      rowCount,
		ExecutionTime: duration.String(),
	})
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
