package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type tableViewPayload struct {
	Name      string         `json:"name"`
	Config    map[string]any `json:"config"`
	IsDefault *bool          `json:"is_default"`
}

// ListTableViews handles GET /api/tables/:name/views
func (h *Handler) ListTableViews(c echo.Context) error {
	tableName := c.Param("name")
	if tableName == "" || !data.IsValidIdentifier(tableName) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid table name"})
	}

	userID, _ := c.Get("user_id").(string)
	if userID == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}
	if _, err := uuid.Parse(userID); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid user context"})
	}

	workspaceID, _ := c.Get("workspace_id").(string)

	query := `
		SELECT id, name, config, is_default, created_at, updated_at
		FROM _v_table_views
		WHERE user_id = $1 AND table_name = $2
	`
	args := []any{userID, tableName}

	if workspaceID != "" {
		query += " AND workspace_id = $3"
		args = append(args, workspaceID)
	} else {
		query += " AND workspace_id IS NULL"
	}

	query += " ORDER BY is_default DESC, created_at DESC"

	rows, err := h.DB.Pool.Query(c.Request().Context(), query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to list views"})
	}
	defer rows.Close()

	views := make([]map[string]any, 0)
	for rows.Next() {
		var id, name string
		var configBytes []byte
		var isDefault bool
		var createdAt, updatedAt time.Time

		if err := rows.Scan(&id, &name, &configBytes, &isDefault, &createdAt, &updatedAt); err == nil {
			var config map[string]any
			_ = json.Unmarshal(configBytes, &config)
			views = append(views, map[string]any{
				"id":         id,
				"name":       name,
				"config":     config,
				"is_default": isDefault,
				"created_at": createdAt,
				"updated_at": updatedAt,
			})
		}
	}

	return c.JSON(http.StatusOK, views)
}

// CreateTableView handles POST /api/tables/:name/views
func (h *Handler) CreateTableView(c echo.Context) error {
	tableName := c.Param("name")
	if tableName == "" || !data.IsValidIdentifier(tableName) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid table name"})
	}

	userID, _ := c.Get("user_id").(string)
	if userID == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}
	if _, err := uuid.Parse(userID); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid user context"})
	}

	var payload tableViewPayload
	if err := c.Bind(&payload); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
	}

	payload.Name = strings.TrimSpace(payload.Name)
	if payload.Name == "" || len(payload.Name) > 80 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "view name is required (1-80 chars)"})
	}

	configBytes, err := json.Marshal(payload.Config)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid config payload"})
	}
	if len(configBytes) > 100_000 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "config payload too large"})
	}

	workspaceID, _ := c.Get("workspace_id").(string)
	isDefault := false
	if payload.IsDefault != nil {
		isDefault = *payload.IsDefault
	}

	tx, err := h.DB.Pool.Begin(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create view"})
	}
	defer func() { _ = tx.Rollback(c.Request().Context()) }()

	if isDefault {
		_, _ = tx.Exec(c.Request().Context(), `
			UPDATE _v_table_views
			SET is_default = false, updated_at = NOW()
			WHERE user_id = $1 AND table_name = $2 AND (
				($3 = '' AND workspace_id IS NULL) OR workspace_id = $3
			)
		`, userID, tableName, workspaceID)
	}

	var id string
	err = tx.QueryRow(c.Request().Context(), `
		INSERT INTO _v_table_views (user_id, workspace_id, table_name, name, config, is_default)
		VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6)
		RETURNING id
	`, userID, workspaceID, tableName, payload.Name, configBytes, isDefault).Scan(&id)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create view"})
	}

	if err := tx.Commit(c.Request().Context()); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit view"})
	}

	return c.JSON(http.StatusCreated, map[string]any{
		"id":         id,
		"name":       payload.Name,
		"config":     payload.Config,
		"is_default": isDefault,
	})
}

// UpdateTableView handles PATCH /api/tables/:name/views/:id
func (h *Handler) UpdateTableView(c echo.Context) error {
	tableName := c.Param("name")
	viewID := c.Param("id")
	if tableName == "" || !data.IsValidIdentifier(tableName) || viewID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	userID, _ := c.Get("user_id").(string)
	if userID == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}

	var payload tableViewPayload
	if err := c.Bind(&payload); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
	}

	workspaceID, _ := c.Get("workspace_id").(string)

	tx, err := h.DB.Pool.Begin(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to update view"})
	}
	defer func() { _ = tx.Rollback(c.Request().Context()) }()

	if payload.IsDefault != nil && *payload.IsDefault {
		_, _ = tx.Exec(c.Request().Context(), `
			UPDATE _v_table_views
			SET is_default = false, updated_at = NOW()
			WHERE user_id = $1 AND table_name = $2 AND (
				($3 = '' AND workspace_id IS NULL) OR workspace_id = $3
			)
		`, userID, tableName, workspaceID)
	}

	setClauses := make([]string, 0, 3)
	args := make([]any, 0, 6)
	argIdx := 1

	if strings.TrimSpace(payload.Name) != "" {
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", argIdx))
		args = append(args, strings.TrimSpace(payload.Name))
		argIdx++
	}
	if payload.Config != nil {
		configBytes, err := json.Marshal(payload.Config)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid config payload"})
		}
		if len(configBytes) > 100_000 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "config payload too large"})
		}
		setClauses = append(setClauses, fmt.Sprintf("config = $%d", argIdx))
		args = append(args, configBytes)
		argIdx++
	}
	if payload.IsDefault != nil {
		setClauses = append(setClauses, fmt.Sprintf("is_default = $%d", argIdx))
		args = append(args, *payload.IsDefault)
		argIdx++
	}

	if len(setClauses) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "no updates provided"})
	}

	setClauses = append(setClauses, "updated_at = NOW()")

	args = append(args, viewID, userID, tableName, workspaceID)
	query := fmt.Sprintf(`
		UPDATE _v_table_views
		SET %s
		WHERE id = $%d AND user_id = $%d AND table_name = $%d AND (
			($%d = '' AND workspace_id IS NULL) OR workspace_id = $%d
		)
	`, strings.Join(setClauses, ", "), argIdx, argIdx+1, argIdx+2, argIdx+3, argIdx+3)

	if _, err := tx.Exec(c.Request().Context(), query, args...); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to update view"})
	}

	if err := tx.Commit(c.Request().Context()); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit view"})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "updated"})
}

// DeleteTableView handles DELETE /api/tables/:name/views/:id
func (h *Handler) DeleteTableView(c echo.Context) error {
	tableName := c.Param("name")
	viewID := c.Param("id")
	if tableName == "" || !data.IsValidIdentifier(tableName) || viewID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	userID, _ := c.Get("user_id").(string)
	if userID == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}

	workspaceID, _ := c.Get("workspace_id").(string)

	_, err := h.DB.Pool.Exec(c.Request().Context(), `
		DELETE FROM _v_table_views
		WHERE id = $1 AND user_id = $2 AND table_name = $3 AND (
			($4 = '' AND workspace_id IS NULL) OR workspace_id = $4
		)
	`, viewID, userID, tableName, workspaceID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to delete view"})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "deleted"})
}
