package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/labstack/echo/v4"
)

// Collection represents a collection in the system
type Collection struct {
	ID              string             `json:"id"`
	Name            string             `json:"name"`
	DisplayName     string             `json:"display_name,omitempty"`
	IsSystem        bool               `json:"is_system"`
	HasID           bool               `json:"has_id"`
	HasPrimaryID    bool               `json:"has_primary_id"`
	HasCreatedAt    bool               `json:"has_created_at"`
	HasUpdatedAt    bool               `json:"has_updated_at"`
	HasDeletedAt    bool               `json:"has_deleted_at"`
	Schema          []data.FieldSchema `json:"schema"`
	ListRule        string             `json:"list_rule"`
	CreateRule      string             `json:"create_rule"`
	RlsEnabled      bool               `json:"rls_enabled"`
	RlsRule         string             `json:"rls_rule"`
	RealtimeEnabled bool               `json:"realtime_enabled"`
	WorkspaceID     string             `json:"workspace_id,omitempty"`
	CreatedAt       time.Time          `json:"created_at"`
	UpdatedAt       time.Time          `json:"updated_at"`
}

// CreateCollectionRequest represents the request to create a new collection
type CreateCollectionRequest struct {
	Name            string             `json:"name"`
	DisplayName     string             `json:"display_name"`
	Schema          []data.FieldSchema `json:"schema"`
	ListRule        string             `json:"list_rule"`   // "public", "auth", "admin"
	CreateRule      string             `json:"create_rule"` // "auth", "admin"
	RlsEnabled      bool               `json:"rls_enabled"`
	RlsRule         string             `json:"rls_rule"`
	RlsPolicies     map[string]string  `json:"rls_policies"`
	RealtimeEnabled bool               `json:"realtime_enabled"`
	WorkspaceID     string             `json:"workspace_id"`
}

var allowedRLSPolicyActions = map[string]struct{}{
	"select": {},
	"insert": {},
	"update": {},
	"delete": {},
}

func validateRLSPolicyActions(perAction map[string]string) error {
	for action := range perAction {
		key := strings.ToLower(strings.TrimSpace(action))
		if _, ok := allowedRLSPolicyActions[key]; !ok {
			return fmt.Errorf("invalid RLS policy action: %s", action)
		}
	}
	return nil
}

func normalizeRLSPolicies(singleRule string, perAction map[string]string) map[string]string {
	policies := map[string]string{
		"select": "",
		"insert": "",
		"update": "",
		"delete": "",
	}

	for action, raw := range perAction {
		key := strings.ToLower(strings.TrimSpace(action))
		if _, ok := policies[key]; ok {
			policies[key] = strings.TrimSpace(raw)
		}
	}

	legacy := strings.TrimSpace(singleRule)
	if legacy != "" {
		for action, value := range policies {
			if value == "" {
				policies[action] = legacy
			}
		}
	}

	return policies
}

func makePolicyName(tableName, action string) string {
	candidate := fmt.Sprintf("policy_ozy_%s_%s", tableName, action)
	if len(candidate) <= 63 {
		return candidate
	}

	// Keep deterministic suffix while respecting identifier length.
	shortTable := tableName
	maxTable := 63 - len("policy_ozy__") - len(action) - 8
	if maxTable < 1 {
		maxTable = 1
	}
	if len(shortTable) > maxTable {
		shortTable = shortTable[:maxTable]
	}
	return fmt.Sprintf("policy_ozy_%s_%s", shortTable, action)
}

func validateRLSExpression(ctx context.Context, tx pgx.Tx, tableName, expr string) error {
	expression := strings.TrimSpace(expr)
	if expression == "" {
		return fmt.Errorf("policy expression cannot be empty")
	}
	if len(expression) > 1024 {
		return fmt.Errorf("policy expression is too long")
	}

	blocked := []string{";", "--", "/*", "*/", "pg_sleep(", "set_config("}
	lower := strings.ToLower(expression)
	for _, token := range blocked {
		if strings.Contains(lower, token) {
			return fmt.Errorf("policy expression contains disallowed token: %s", token)
		}
	}

	// Ask Postgres to validate expression syntax and referenced columns.
	// #nosec G201
	validateSQL := fmt.Sprintf("EXPLAIN SELECT 1 FROM %s WHERE (%s) LIMIT 0", tableName, expression)
	_, err := tx.Exec(ctx, validateSQL)
	return err
}

type collectionTableCapabilities struct {
	HasID        bool
	HasPrimaryID bool
	HasCreatedAt bool
	HasUpdatedAt bool
	HasDeletedAt bool
}

func (h *Handler) loadCollectionSchemaFromDatabase(ctx context.Context, tableName string) ([]data.FieldSchema, error) {
	if !data.IsValidIdentifier(tableName) {
		return nil, fmt.Errorf("invalid table name: %s", tableName)
	}

	rows, err := h.DB.Pool.Query(ctx, `
		SELECT column_name, data_type, is_nullable
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = $1
		ORDER BY ordinal_position
	`, tableName)
	if err != nil {
		return nil, fmt.Errorf("failed to query table schema: %w", err)
	}
	defer rows.Close()

	found := false
	schema := make([]data.FieldSchema, 0)
	for rows.Next() {
		found = true
		var colName, dataType, isNullable string
		if err := rows.Scan(&colName, &dataType, &isNullable); err != nil {
			return nil, fmt.Errorf("failed to scan column schema: %w", err)
		}

		if colName == "id" || colName == "created_at" || colName == "updated_at" || colName == "deleted_at" {
			continue
		}

		schema = append(schema, data.FieldSchema{
			Name:     colName,
			Type:     dataType,
			Required: isNullable == "NO",
		})
	}

	if rows.Err() != nil {
		return nil, fmt.Errorf("failed to read table schema: %w", rows.Err())
	}
	if !found {
		return nil, fmt.Errorf("table not found: %s", tableName)
	}

	return schema, nil
}

func (h *Handler) loadCollectionTableCapabilities(ctx context.Context) (map[string]collectionTableCapabilities, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT
			c.table_name,
			BOOL_OR(c.column_name = 'id') AS has_id,
			BOOL_OR(c.column_name = 'created_at') AS has_created_at,
			BOOL_OR(c.column_name = 'updated_at') AS has_updated_at,
			BOOL_OR(c.column_name = 'deleted_at') AS has_deleted_at,
			EXISTS (
				SELECT 1
				FROM information_schema.table_constraints tc
				JOIN information_schema.key_column_usage kcu
				  ON tc.constraint_name = kcu.constraint_name
				 AND tc.table_schema = kcu.table_schema
				WHERE tc.table_schema = 'public'
				  AND tc.table_name = c.table_name
				  AND tc.constraint_type = 'PRIMARY KEY'
				  AND kcu.column_name = 'id'
			) AS has_primary_id
		FROM information_schema.columns c
		WHERE c.table_schema = 'public'
		GROUP BY c.table_name
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to inspect table capabilities: %w", err)
	}
	defer rows.Close()

	caps := make(map[string]collectionTableCapabilities)
	for rows.Next() {
		var tableName string
		var item collectionTableCapabilities
		if err := rows.Scan(&tableName, &item.HasID, &item.HasCreatedAt, &item.HasUpdatedAt, &item.HasDeletedAt, &item.HasPrimaryID); err != nil {
			return nil, fmt.Errorf("failed to scan table capabilities: %w", err)
		}
		caps[tableName] = item
	}

	if rows.Err() != nil {
		return nil, fmt.Errorf("failed to read table capabilities: %w", rows.Err())
	}

	return caps, nil
}

func applyCollectionCapabilities(col Collection, capsMap map[string]collectionTableCapabilities) Collection {
	caps, ok := capsMap[col.Name]
	if !ok {
		return col
	}

	col.HasID = caps.HasID
	col.HasPrimaryID = caps.HasPrimaryID
	col.HasCreatedAt = caps.HasCreatedAt
	col.HasUpdatedAt = caps.HasUpdatedAt
	col.HasDeletedAt = caps.HasDeletedAt
	return col
}

func (h *Handler) upsertCollectionMetadataForTable(ctx context.Context, tableName, workspaceID string) error {
	schema, err := h.loadCollectionSchemaFromDatabase(ctx, tableName)
	if err != nil {
		return err
	}

	schemaJSON, err := json.Marshal(schema)
	if err != nil {
		return fmt.Errorf("failed to encode schema metadata: %w", err)
	}

	var workspace any
	if strings.TrimSpace(workspaceID) != "" {
		workspace = workspaceID
	}

	_, err = h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_collections (
			name, display_name, schema_def, list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled, workspace_id, updated_at
		)
		VALUES ($1, $2, $3, 'auth', 'admin', FALSE, '', FALSE, $4, NOW())
		ON CONFLICT (name) DO UPDATE SET
			display_name = COALESCE(NULLIF(_v_collections.display_name, ''), EXCLUDED.display_name),
			schema_def = EXCLUDED.schema_def,
			workspace_id = COALESCE(_v_collections.workspace_id, EXCLUDED.workspace_id),
			updated_at = NOW()
	`, tableName, tableName, schemaJSON, workspace)
	if err == nil {
		return nil
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "42703" {
		_, err = h.DB.Pool.Exec(ctx, `
			INSERT INTO _v_collections (
				name, schema_def, list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled, workspace_id, updated_at
			)
			VALUES ($1, $2, 'auth', 'admin', FALSE, '', FALSE, $3, NOW())
			ON CONFLICT (name) DO UPDATE SET
				schema_def = EXCLUDED.schema_def,
				workspace_id = COALESCE(_v_collections.workspace_id, EXCLUDED.workspace_id),
				updated_at = NOW()
		`, tableName, schemaJSON, workspace)
	}
	if err != nil {
		return fmt.Errorf("failed to upsert collection metadata for %s: %w", tableName, err)
	}
	return nil
}

func (h *Handler) renameCollectionMetadataForTable(ctx context.Context, oldTableName, newTableName, workspaceID string) error {
	if oldTableName == newTableName {
		return h.upsertCollectionMetadataForTable(ctx, newTableName, workspaceID)
	}

	schema, err := h.loadCollectionSchemaFromDatabase(ctx, newTableName)
	if err != nil {
		return err
	}

	schemaJSON, err := json.Marshal(schema)
	if err != nil {
		return fmt.Errorf("failed to encode renamed schema metadata: %w", err)
	}

	var workspace any
	if strings.TrimSpace(workspaceID) != "" {
		workspace = workspaceID
	}

	tag, err := h.DB.Pool.Exec(ctx, `
		UPDATE _v_collections
		SET name = $2,
			display_name = CASE
				WHEN COALESCE(display_name, '') = '' OR display_name = name THEN $2
				ELSE display_name
			END,
			schema_def = $3,
			workspace_id = COALESCE(workspace_id, $4::uuid),
			updated_at = NOW()
		WHERE name = $1
	`, oldTableName, newTableName, schemaJSON, workspace)
	if err == nil && tag.RowsAffected() > 0 {
		return nil
	}

	var pgErr *pgconn.PgError
	if err != nil && (!errors.As(err, &pgErr) || pgErr.Code != "42703") {
		return fmt.Errorf("failed to rename collection metadata from %s to %s: %w", oldTableName, newTableName, err)
	}

	if errors.As(err, &pgErr) && pgErr.Code == "42703" {
		tag, err = h.DB.Pool.Exec(ctx, `
			UPDATE _v_collections
			SET name = $2,
				schema_def = $3,
				workspace_id = COALESCE(workspace_id, $4::uuid),
				updated_at = NOW()
			WHERE name = $1
		`, oldTableName, newTableName, schemaJSON, workspace)
		if err != nil {
			return fmt.Errorf("failed to rename legacy collection metadata from %s to %s: %w", oldTableName, newTableName, err)
		}
		if tag.RowsAffected() > 0 {
			return nil
		}
	}

	return h.upsertCollectionMetadataForTable(ctx, newTableName, workspaceID)
}

func (h *Handler) deleteCollectionMetadataForTable(ctx context.Context, tableName string) error {
	if !data.IsValidIdentifier(tableName) {
		return nil
	}
	if _, err := h.DB.Pool.Exec(ctx, "DELETE FROM _v_collections WHERE name = $1", tableName); err != nil {
		return fmt.Errorf("failed to delete collection metadata for %s: %w", tableName, err)
	}
	return nil
}

// CreateCollection handles POST /api/collections
func (h *Handler) CreateCollection(c echo.Context) error {
	var req CreateCollectionRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request body",
		})
	}

	// Validate request
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Collection name is required",
		})
	}
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if req.DisplayName == "" {
		req.DisplayName = req.Name
	}

	if len(req.Schema) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Schema is required and must have at least one field",
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	// Build the CREATE TABLE SQL
	createSQL, err := data.BuildCreateTableSQL(req.Name, req.Schema)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	// Start transaction
	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to start transaction",
		})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Execute CREATE TABLE
	if _, err := tx.Exec(ctx, createSQL); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create table: " + err.Error(),
		})
	}

	// Attach Realtime Trigger IF ENABLED
	var triggerSQL string
	if req.RealtimeEnabled {
		triggerSQL = fmt.Sprintf(`
			CREATE TRIGGER tr_notify_%s
			AFTER INSERT OR UPDATE OR DELETE ON %s
			FOR EACH ROW EXECUTE FUNCTION notify_event();
		`, req.Name, req.Name)

		if _, err := tx.Exec(ctx, triggerSQL); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to attach realtime trigger: " + err.Error(),
			})
		}
	}

	// Native Postgres RLS Enforcement
	if req.RlsEnabled {
		if err := validateRLSPolicyActions(req.RlsPolicies); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error":      err.Error(),
				"error_code": "RLS_INVALID_ACTION",
			})
		}

		if err := h.DB.EnableRLS(ctx, tx, req.Name); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to enable native RLS: " + err.Error(),
			})
		}

		policies := normalizeRLSPolicies(req.RlsRule, req.RlsPolicies)
		for action, expression := range policies {
			if strings.TrimSpace(expression) == "" {
				continue
			}
			if err := validateRLSExpression(ctx, tx, req.Name, expression); err != nil {
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) {
					if pgErr.Code == "42703" {
						return c.JSON(http.StatusBadRequest, map[string]string{
							"error":      fmt.Sprintf("Invalid RLS %s policy: one or more referenced columns do not exist", action),
							"error_code": "RLS_INVALID_COLUMN",
						})
					}
					if pgErr.Code == "42601" || pgErr.Code == "42883" {
						return c.JSON(http.StatusBadRequest, map[string]string{
							"error":      fmt.Sprintf("Invalid RLS %s policy expression: %s", action, pgErr.Message),
							"error_code": "RLS_INVALID_EXPRESSION",
						})
					}
				}
				return c.JSON(http.StatusBadRequest, map[string]string{
					"error":      fmt.Sprintf("Invalid RLS %s policy expression", action),
					"error_code": "RLS_INVALID_EXPRESSION",
				})
			}

			policyName := makePolicyName(req.Name, action)
			_, _ = tx.Exec(ctx, fmt.Sprintf("DROP POLICY IF EXISTS %s ON %s", policyName, req.Name))
			if err := h.DB.CreatePolicyForAction(ctx, tx, req.Name, policyName, action, expression); err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{
					"error": "Failed to create RLS policy: " + err.Error(),
				})
			}
		}

		if strings.TrimSpace(req.RlsRule) == "" {
			req.RlsRule = policies["select"]
		}
	}

	// Set defaults if empty
	if req.ListRule == "" {
		req.ListRule = "auth"
	}
	if req.CreateRule == "" {
		req.CreateRule = "admin"
	}

	// Set Workspace from Context if missing
	if req.WorkspaceID == "" {
		if wsID, ok := c.Get("workspace_id").(string); ok {
			req.WorkspaceID = wsID
		}
	}

	// Store collection metadata
	schemaJSON, _ := json.Marshal(req.Schema)
	var workspaceID any
	if strings.TrimSpace(req.WorkspaceID) != "" {
		workspaceID = req.WorkspaceID
	}
	var collection Collection
	err = tx.QueryRow(ctx, `
		INSERT INTO _v_collections (name, display_name, schema_def, list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled, workspace_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, name, COALESCE(display_name, name), list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled, COALESCE(workspace_id::text, ''), created_at, updated_at
	`, req.Name, req.DisplayName, schemaJSON, req.ListRule, req.CreateRule, req.RlsEnabled, req.RlsRule, req.RealtimeEnabled, workspaceID).Scan(
		&collection.ID, &collection.Name, &collection.DisplayName, &collection.ListRule, &collection.CreateRule,
		&collection.RlsEnabled, &collection.RlsRule, &collection.RealtimeEnabled, &collection.WorkspaceID, &collection.CreatedAt, &collection.UpdatedAt,
	)

	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42703" {
			// Backward compatibility for deployments where display_name column is not yet present.
			err = tx.QueryRow(ctx, `
				INSERT INTO _v_collections (name, schema_def, list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled, workspace_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
				RETURNING id, name, list_rule, create_rule, rls_enabled, rls_rule, realtime_enabled, COALESCE(workspace_id::text, ''), created_at, updated_at
			`, req.Name, schemaJSON, req.ListRule, req.CreateRule, req.RlsEnabled, req.RlsRule, req.RealtimeEnabled, workspaceID).Scan(
				&collection.ID, &collection.Name, &collection.ListRule, &collection.CreateRule,
				&collection.RlsEnabled, &collection.RlsRule, &collection.RealtimeEnabled, &collection.WorkspaceID, &collection.CreatedAt, &collection.UpdatedAt,
			)
			collection.DisplayName = req.DisplayName
		}
	}

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to save collection metadata: " + err.Error(),
		})
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to commit transaction",
		})
	}

	// 📜 Record Migration
	fullMigrationSQL := createSQL
	if triggerSQL != "" {
		fullMigrationSQL += "\n\n" + triggerSQL
	}
	description := fmt.Sprintf("create_collection_%s", req.Name)
	if _, err := h.Migrations.CreateMigration(description, fullMigrationSQL); err != nil {
		log.Printf("⚠️ Warning: Failed to record migration: %v", err)
	}

	collection.Schema = req.Schema
	h.invalidateProjectInfoCache()
	h.invalidateHealthIssuesCache()
	return c.JSON(http.StatusCreated, collection)
}

// DeleteCollection handles DELETE /api/collections/:name
func (h *Handler) DeleteCollection(c echo.Context) error {
	name := c.Param("name")
	if name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Name is required"})
	}

	if !data.IsValidIdentifier(name) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid collection name"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	// Start transaction
	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 1. Drop table
	if _, err := tx.Exec(ctx, fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE", name)); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// 2. Remove metadata
	if _, err := tx.Exec(ctx, "DELETE FROM _v_collections WHERE name = $1", name); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	// 📜 Record Migration
	dropSQL := fmt.Sprintf("DROP TABLE IF EXISTS %s CASCADE;", name)
	description := fmt.Sprintf("delete_collection_%s", name)
	if _, err := h.Migrations.CreateMigration(description, dropSQL); err != nil {
		log.Printf("⚠️ Warning: Failed to record migration: %v", err)
	}

	h.invalidateProjectInfoCache()
	h.invalidateHealthIssuesCache()
	return c.NoContent(http.StatusNoContent)
}

// UpdateCollectionRules handles PATCH /api/collections/rules
func (h *Handler) UpdateCollectionRules(c echo.Context) error {
	var req struct {
		Name       string  `json:"name"`
		ListRule   *string `json:"list_rule,omitempty"`
		CreateRule *string `json:"create_rule,omitempty"`
		UpdateRule *string `json:"update_rule,omitempty"`
		DeleteRule *string `json:"delete_rule,omitempty"`
	}

	if err := c.Bind(&req); err != nil {
		return err
	}

	query := "UPDATE _v_collections SET updated_at = NOW()"
	args := []any{req.Name}
	argIdx := 2

	if req.ListRule != nil {
		query += fmt.Sprintf(", list_rule = $%d", argIdx)
		args = append(args, *req.ListRule)
		argIdx++
	}
	if req.CreateRule != nil {
		query += fmt.Sprintf(", create_rule = $%d", argIdx)
		args = append(args, *req.CreateRule)
		argIdx++
	}
	if req.UpdateRule != nil {
		query += fmt.Sprintf(", update_rule = $%d", argIdx)
		args = append(args, *req.UpdateRule)
		argIdx++
	}
	if req.DeleteRule != nil {
		query += fmt.Sprintf(", delete_rule = $%d", argIdx)
		args = append(args, *req.DeleteRule)
	}

	query += " WHERE name = $1"

	_, err := h.DB.Pool.Exec(c.Request().Context(), query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "updated"})
}

// UpdateRealtimeToggle handles PATCH /api/collections/realtime
func (h *Handler) UpdateRealtimeToggle(c echo.Context) error {
	var req struct {
		Name    string `json:"name"`
		Enabled bool   `json:"enabled"`
	}
	if err := c.Bind(&req); err != nil {
		return err
	}

	if !data.IsValidIdentifier(req.Name) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid collection name"})
	}

	ctx := c.Request().Context()
	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 1. Update Metadata
	_, err = tx.Exec(ctx, "UPDATE _v_collections SET realtime_enabled = $1 WHERE name = $2", req.Enabled, req.Name)
	if err != nil {
		return err
	}

	// 2. Manage Trigger
	var triggerSQL string
	if req.Enabled {
		triggerSQL = fmt.Sprintf(`
			CREATE TRIGGER tr_notify_%s
			AFTER INSERT OR UPDATE OR DELETE ON %s
			FOR EACH ROW EXECUTE FUNCTION notify_event();
		`, req.Name, req.Name)
	} else {
		triggerSQL = fmt.Sprintf("DROP TRIGGER IF EXISTS tr_notify_%s ON %s", req.Name, req.Name)
	}

	if _, err := tx.Exec(ctx, triggerSQL); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update trigger: " + err.Error()})
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "updated", "realtime_enabled": fmt.Sprintf("%v", req.Enabled)})
}

// ListCollections handles GET /api/collections
func (h *Handler) ListCollections(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	// Fetch all tables from information_schema
	tables, err := h.DB.ListTables(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch tables: " + err.Error(),
		})
	}

	// Fetch metadata from _v_collections scoped to workspace
	workspaceID, _ := c.Get("workspace_id").(string)

	// Fetch metadata for ALL collections to correctly identify and hide tables from other workspaces
	query := "SELECT name, COALESCE(display_name, name), schema_def, list_rule, create_rule, created_at, updated_at, realtime_enabled, workspace_id FROM _v_collections"
	usesDisplayName := true
	rows, err := h.DB.Pool.Query(ctx, query)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42703" {
			// Backward compatibility for deployments where display_name column is not yet present.
			usesDisplayName = false
			rows, err = h.DB.Pool.Query(ctx, "SELECT name, schema_def, list_rule, create_rule, created_at, updated_at, realtime_enabled, workspace_id FROM _v_collections")
		}
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch collection metadata: " + err.Error(),
		})
	}

	metaMap := make(map[string]Collection)
	defer rows.Close()
	for rows.Next() {
		var col Collection
		var schemaJSON []byte
		var wsID *string
		var scanErr error
		if usesDisplayName {
			scanErr = rows.Scan(&col.Name, &col.DisplayName, &schemaJSON, &col.ListRule, &col.CreateRule, &col.CreatedAt, &col.UpdatedAt, &col.RealtimeEnabled, &wsID)
		} else {
			scanErr = rows.Scan(&col.Name, &schemaJSON, &col.ListRule, &col.CreateRule, &col.CreatedAt, &col.UpdatedAt, &col.RealtimeEnabled, &wsID)
			col.DisplayName = col.Name
		}
		if scanErr == nil {
			if wsID != nil {
				col.WorkspaceID = *wsID
			}
			if err := json.Unmarshal(schemaJSON, &col.Schema); err == nil {
				metaMap[col.Name] = col
			}
		}
	}

	capabilities, err := h.loadCollectionTableCapabilities(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to inspect table capabilities: " + err.Error(),
		})
	}

	// Combine information
	result := make([]Collection, 0, len(tables))
	for _, tableName := range tables {
		// Define system tables prefixes
		lowerName := strings.ToLower(tableName)
		isSystem := strings.HasPrefix(lowerName, "_v_") || strings.HasPrefix(lowerName, "_ozy_")

		if meta, ok := metaMap[tableName]; ok {
			// If the table is managed by OzyBase:
			// 1. If it belongs to the current workspace, show it.
			// 2. If it belongs to ANOTHER workspace, HIDE it.
			// 3. If it has no workspace (shared/global), show it.

			if workspaceID != "" && meta.WorkspaceID != "" && meta.WorkspaceID != workspaceID {
				// belongs to another workspace -> Skip
				continue
			}

			meta.IsSystem = isSystem
			result = append(result, applyCollectionCapabilities(meta, capabilities))
		} else {
			// Non-managed tables: tables in the physical DB but not in _v_collections
			// When a workspace IS selected, only show system tables (admin needs them)
			// Hide non-system unmanaged tables to enforce strict workspace isolation
			if workspaceID != "" && !isSystem {
				continue
			}
			col := Collection{
				Name:        tableName,
				DisplayName: tableName,
				IsSystem:    isSystem,
				ListRule:    "public",
				CreateRule:  "admin",
				Schema:      []data.FieldSchema{},
			}
			result = append(result, applyCollectionCapabilities(col, capabilities))
		}
	}

	if result == nil {
		result = []Collection{}
	}

	return c.JSON(http.StatusOK, result)
}

// GetTableSchema handles GET /api/schema/:name
func (h *Handler) GetTableSchema(c echo.Context) error {
	tableName := c.Param("name")
	if tableName == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Table name is required",
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	schema, err := h.DB.GetTableSchema(ctx, tableName)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": err.Error(),
		})
	}

	return c.JSON(http.StatusOK, schema)
}

// ListSchemas handles GET /api/schemas
func (h *Handler) ListSchemas(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	schemas, err := h.DB.ListSchemas(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to list schemas: " + err.Error(),
		})
	}

	return c.JSON(http.StatusOK, schemas)
}

// AddColumn handles POST /api/tables/:name/columns
func (h *Handler) AddColumn(c echo.Context) error {
	tableName := c.Param("name")
	var field data.FieldSchema
	if err := c.Bind(&field); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid body"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	sql, err := h.DB.AddColumn(ctx, tableName, field)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// 📜 Record Migration
	description := fmt.Sprintf("add_column_%s_to_%s", field.Name, tableName)
	if _, err := h.Migrations.CreateMigration(description, sql); err != nil {
		log.Printf("⚠️ Warning: Failed to record migration: %v", err)
	}

	h.invalidateProjectInfoCache()
	h.invalidateHealthIssuesCache()
	return c.JSON(http.StatusCreated, field)
}

// DeleteColumn handles DELETE /api/tables/:name/columns/:col
func (h *Handler) DeleteColumn(c echo.Context) error {
	tableName := c.Param("name")
	columnName := c.Param("col")

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	sql, err := h.DB.DeleteColumn(ctx, tableName, columnName)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// 📜 Record Migration
	description := fmt.Sprintf("delete_column_%s_from_%s", columnName, tableName)
	if _, err := h.Migrations.CreateMigration(description, sql); err != nil {
		log.Printf("⚠️ Warning: Failed to record migration: %v", err)
	}

	h.invalidateProjectInfoCache()
	h.invalidateHealthIssuesCache()
	return c.NoContent(http.StatusNoContent)
}

// GetVisualizeSchema handles GET /api/collections/visualize
func (h *Handler) GetVisualizeSchema(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	schema, err := h.DB.GetDatabaseSchema(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch database schema: " + err.Error(),
		})
	}

	return c.JSON(http.StatusOK, schema)
}

// ProjectInfo represents the project information response
type ProjectInfo struct {
	Name             string                     `json:"name"`
	Database         string                     `json:"database"`
	APIURL           string                     `json:"api_url,omitempty"`
	TableCount       int                        `json:"table_count"`
	UserTableCount   int                        `json:"user_table_count"`
	SystemTableCount int                        `json:"system_table_count"`
	FunctionCount    int                        `json:"function_count"`
	SchemaCount      int                        `json:"schema_count"`
	DbSize           string                     `json:"db_size"`
	DbSizeBytes      int64                      `json:"db_size_bytes"`
	Version          string                     `json:"version"`
	Production       ProjectProductionReadiness `json:"production"`
	Metrics          DbMetrics                  `json:"metrics"`
	SlowQueries      []SlowQuery                `json:"slow_queries"`
}

type DbMetrics struct {
	DbRequests       int       `json:"db_requests"`
	AuthRequests     int       `json:"auth_requests"`
	StorageRequests  int       `json:"storage_requests"`
	RealtimeRequests int       `json:"realtime_requests"`
	DbHistory        []int     `json:"db_history"`
	AuthHistory      []int     `json:"auth_history"`
	StorageHistory   []int     `json:"storage_history"`
	RealtimeHistory  []int     `json:"realtime_history"`
	CpuHistory       []float64 `json:"cpu_history"`
	RamHistory       []float64 `json:"ram_history"`
}

type SlowQuery struct {
	Query   string  `json:"query"`
	AvgTime float64 `json:"avg_time"` // in seconds
	Calls   int     `json:"calls"`
}

// GetProjectInfo handles GET /api/project/info
func (h *Handler) GetProjectInfo(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()
	forceRefresh := strings.EqualFold(strings.TrimSpace(c.QueryParam("refresh")), "true")
	if !forceRefresh {
		if cached, ok := h.getCachedProjectInfo(); ok {
			return c.JSON(http.StatusOK, h.applyProjectInfoAccess(cached, c))
		}
	}

	var info ProjectInfo

	// Get database name and connection info from current connection
	err := h.DB.Pool.QueryRow(ctx, `SELECT current_database()`).Scan(&info.Database)
	if err != nil {
		info.Database = "unknown"
	}

	// Get PostgreSQL version
	err = h.DB.Pool.QueryRow(ctx, `SHOW server_version`).Scan(&info.Version)
	if err != nil {
		info.Version = "unknown"
	}
	info.Production = h.Production

	// Get table counts using the same logic as ListCollections
	tables, err := h.DB.ListTables(ctx)
	if err == nil {
		info.TableCount = len(tables)
		for _, tableName := range tables {
			lowerName := strings.ToLower(tableName)
			if strings.HasPrefix(lowerName, "_v_") || strings.HasPrefix(lowerName, "_ozy_") {
				info.SystemTableCount++
			} else {
				info.UserTableCount++
			}
		}
	}

	// Get function count
	err = h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM information_schema.routines
		WHERE routine_schema = 'public'
		AND routine_type = 'FUNCTION'
	`).Scan(&info.FunctionCount)
	if err != nil {
		info.FunctionCount = 0
	}

	// Get schema count
	err = h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM information_schema.schemata
		WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
	`).Scan(&info.SchemaCount)
	if err != nil {
		info.SchemaCount = 0
	}

	// Get database size
	err = h.DB.Pool.QueryRow(ctx, `SELECT pg_size_pretty(pg_database_size(current_database()))`).Scan(&info.DbSize)
	if err != nil {
		info.DbSize = "unknown"
	}
	_ = h.DB.Pool.QueryRow(ctx, `SELECT pg_database_size(current_database())`).Scan(&info.DbSizeBytes)

	// REAL METRICS FROM IN-MEMORY STORE
	h.Metrics.RLock()
	info.Metrics.DbRequests = h.Metrics.DbRequests
	info.Metrics.AuthRequests = h.Metrics.AuthRequests
	info.Metrics.StorageRequests = h.Metrics.StorageRequests

	// Helper to get last 12 points
	getLast12 := func(history []int) []int {
		res := make([]int, 12)
		historyLen := len(history)
		for i := 0; i < 12; i++ {
			idx := historyLen - 12 + i
			if idx >= 0 && idx < historyLen {
				res[i] = history[idx]
			}
		}
		return res
	}

	getLast12Float := func(history []float64) []float64 {
		res := make([]float64, 12)
		historyLen := len(history)
		for i := 0; i < 12; i++ {
			idx := historyLen - 12 + i
			if idx >= 0 && idx < historyLen {
				res[i] = history[idx]
			}
		}
		return res
	}

	info.Metrics.DbHistory = getLast12(h.Metrics.DbHistory)
	info.Metrics.AuthHistory = getLast12(h.Metrics.AuthHistory)
	info.Metrics.StorageHistory = getLast12(h.Metrics.StorageHistory)
	info.Metrics.RealtimeHistory = getLast12(h.Metrics.RealtimeHistory)
	info.Metrics.CpuHistory = getLast12Float(h.Metrics.CpuHistory)
	info.Metrics.RamHistory = getLast12Float(h.Metrics.RamHistory)
	h.Metrics.RUnlock()

	// 4. Realtime requests (active backends currently processing)
	_ = h.DB.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active' AND query NOT LIKE '%pg_stat_activity%'").Scan(&info.Metrics.RealtimeRequests)

	// SLOW QUERIES (Attempt to use pg_stat_statements if available, otherwise use pg_stat_activity)
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT query,
		       EXTRACT(EPOCH FROM (now() - query_start)) as duration,
		       1 as calls
		FROM pg_stat_activity
		WHERE state = 'active'
		AND query NOT LIKE '%pg_stat_activity%'
		ORDER BY duration DESC
		LIMIT 5
	`)

	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var sq SlowQuery
			if err := rows.Scan(&sq.Query, &sq.AvgTime, &sq.Calls); err == nil {
				if len(sq.Query) > 100 {
					sq.Query = sq.Query[:97] + "..."
				}
				info.SlowQueries = append(info.SlowQueries, sq)
			}
		}
	}

	if info.SlowQueries == nil {
		info.SlowQueries = []SlowQuery{}
	}

	info.Name = info.Database
	if apiURL := readEnvForProjectInfo("SITE_URL"); apiURL != "" {
		info.APIURL = strings.TrimRight(apiURL, "/")
	}

	h.setCachedProjectInfo(info, 5*time.Second)
	return c.JSON(http.StatusOK, info)
}

func readEnvForProjectInfo(key string) string {
	val := strings.TrimSpace(os.Getenv(key))
	if val == "" {
		return ""
	}
	if isSetPlaceholder(val, key) {
		return ""
	}
	return val
}

func isSetPlaceholder(value, key string) bool {
	v := strings.ToLower(strings.TrimSpace(value))
	k := strings.ToLower(strings.TrimSpace(key))
	return v == "set_"+k || v == "set "+k || v == "set-"+k || v == "set:"+k
}

func (h *Handler) getCachedProjectInfo() (ProjectInfo, bool) {
	h.projectInfoCacheMu.RLock()
	defer h.projectInfoCacheMu.RUnlock()
	if h.projectInfoCache == nil || time.Now().After(h.projectInfoCacheUntil) {
		return ProjectInfo{}, false
	}
	return *h.projectInfoCache, true
}

func (h *Handler) setCachedProjectInfo(info ProjectInfo, ttl time.Duration) {
	h.projectInfoCacheMu.Lock()
	defer h.projectInfoCacheMu.Unlock()
	h.projectInfoCache = &info
	h.projectInfoCacheUntil = time.Now().Add(ttl)
}

func (h *Handler) applyProjectInfoAccess(info ProjectInfo, c echo.Context) ProjectInfo {
	return info
}

func (h *Handler) getCachedHealthIssues() ([]HealthIssue, bool) {
	h.healthIssuesCacheMu.RLock()
	defer h.healthIssuesCacheMu.RUnlock()
	if h.healthIssuesCache == nil || time.Now().After(h.healthIssuesCacheUntil) {
		return nil, false
	}
	out := make([]HealthIssue, len(h.healthIssuesCache))
	copy(out, h.healthIssuesCache)
	return out, true
}

func (h *Handler) setCachedHealthIssues(issues []HealthIssue, ttl time.Duration) {
	cloned := make([]HealthIssue, len(issues))
	copy(cloned, issues)

	h.healthIssuesCacheMu.Lock()
	defer h.healthIssuesCacheMu.Unlock()
	h.healthIssuesCache = cloned
	h.healthIssuesCacheUntil = time.Now().Add(ttl)
}

func (h *Handler) invalidateProjectInfoCache() {
	h.projectInfoCacheMu.Lock()
	defer h.projectInfoCacheMu.Unlock()
	h.projectInfoCache = nil
	h.projectInfoCacheUntil = time.Time{}
}

func (h *Handler) invalidateHealthIssuesCache() {
	h.healthIssuesCacheMu.Lock()
	defer h.healthIssuesCacheMu.Unlock()
	h.healthIssuesCache = nil
	h.healthIssuesCacheUntil = time.Time{}
}

// HealthIssue represents a security or performance recommendation
type HealthIssue struct {
	Type        string `json:"type"` // "security" | "performance"
	Title       string `json:"title"`
	Description string `json:"description"`
	Fixable     bool   `json:"fixable"`
	Reviewable  bool   `json:"reviewable,omitempty"`
	ReviewKey   string `json:"review_key,omitempty"`
	ActionView  string `json:"action_view,omitempty"`
	ActionLabel string `json:"action_label,omitempty"`
	Count       int    `json:"count,omitempty"`
}

func reviewKeySegment(value any) string {
	trimmed := strings.TrimSpace(fmt.Sprint(value))
	if trimmed == "" || trimmed == "<nil>" {
		return ""
	}
	return strings.ReplaceAll(trimmed, "|", "/")
}

func buildGeoBreachReviewKey(ip, country, city string) string {
	return strings.Join([]string{
		"geo_breach",
		reviewKeySegment(ip),
		reviewKeySegment(country),
		reviewKeySegment(city),
	}, "|")
}

func parseGeoBreachReviewKey(reviewKey string) (ip, country, city string, ok bool) {
	parts := strings.Split(reviewKey, "|")
	if len(parts) != 4 || parts[0] != "geo_breach" {
		return "", "", "", false
	}
	return strings.TrimSpace(parts[1]), strings.TrimSpace(parts[2]), strings.TrimSpace(parts[3]), true
}

func buildSecurityAlertHealthIssue(alertType string, details map[string]any) (HealthIssue, string, bool) {
	switch strings.TrimSpace(alertType) {
	case "geo_breach":
		ip := reviewKeySegment(details["ip"])
		country := reviewKeySegment(details["country"])
		city := reviewKeySegment(details["city"])
		location := "unknown location"
		switch {
		case country != "" && city != "":
			location = fmt.Sprintf("%s (%s)", country, city)
		case country != "":
			location = country
		case city != "":
			location = city
		}

		desc := fmt.Sprintf("Access attempt from unauthorized location: %s", location)
		if ip != "" {
			desc += fmt.Sprintf(" via IP %s", ip)
		}
		desc += ". Review geo-fencing policy or mark the alert as reviewed after validation."

		reviewKey := buildGeoBreachReviewKey(ip, country, city)
		return HealthIssue{
			Type:        "security",
			Title:       "Geographic Access Breach",
			Description: desc,
			Reviewable:  true,
			ReviewKey:   reviewKey,
			ActionView:  "security_policies",
			ActionLabel: "Open Geo-Fencing",
		}, reviewKey, true
	case "system_error":
		return HealthIssue{
			Type:        "security",
			Title:       "System Configuration Error",
			Description: fmt.Sprintf("Error: %v", details["error"]),
		}, "system_error", true
	default:
		return HealthIssue{
			Type:        "security",
			Title:       "Security Alert",
			Description: "A security event was detected.",
		}, strings.TrimSpace(alertType), true
	}
}

// GetHealthIssues handles GET /api/project/health
func (h *Handler) GetHealthIssues(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()
	forceRefresh := strings.EqualFold(strings.TrimSpace(c.QueryParam("refresh")), "true")
	if !forceRefresh {
		if cached, ok := h.getCachedHealthIssues(); ok {
			return c.JSON(http.StatusOK, cached)
		}
	}

	// Initialize as empty slice so it marshals to [] instead of null if empty
	issues := make([]HealthIssue, 0)

	// 1. Formal RLS coverage by table/action (database policies, not only metadata flags)
	coverage, covErr := h.collectRLSPolicyCoverage(ctx)
	if covErr == nil {
		for _, item := range coverage {
			if !item.RLSDatabaseEnabled {
				issues = append(issues, HealthIssue{
					Type:        "security",
					Title:       fmt.Sprintf("Table `%s` does not have Row Level Security enabled", item.TableName),
					Description: "Enable native Postgres RLS and define per-action policies.",
				})
				continue
			}
			if len(item.MissingActions) > 0 {
				issues = append(issues, HealthIssue{
					Type:        "security",
					Title:       fmt.Sprintf("Table `%s` is missing RLS policies for: %s", item.TableName, strings.Join(item.MissingActions, ", ")),
					Description: "Define policies for SELECT, INSERT, UPDATE, and DELETE to enforce full action coverage.",
				})
			}
		}
	}

	// 2. Check for Foreign Keys without indexes (Dynamic)
	rows, err := h.DB.Pool.Query(ctx, `
		WITH fk_columns AS (
			SELECT conrelid::regclass as table_name, conname as constraint_name, a.attname as column_name
			FROM pg_constraint c
			CROSS JOIN LATERAL unnest(c.conkey) as col(num)
			JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = col.num
			WHERE c.contype = 'f'
		),
		indexed_columns AS (
			SELECT indrelid::regclass as table_name, a.attname as column_name
			FROM pg_index i
			CROSS JOIN LATERAL unnest(i.indkey) as col(num)
			JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = col.num
		)
		SELECT f.table_name::text, f.column_name, f.constraint_name
		FROM fk_columns f
		LEFT JOIN indexed_columns i ON f.table_name = i.table_name AND f.column_name = i.column_name
		WHERE i.column_name IS NULL
		  AND f.table_name::text NOT LIKE '_v_%' AND f.table_name::text NOT LIKE '_ozy_%'
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var tableName, colName, conName string
			if err := rows.Scan(&tableName, &colName, &conName); err == nil {
				issues = append(issues, HealthIssue{
					Type:        "performance",
					Title:       fmt.Sprintf("Foreign Key `%s` in `%s` is missing an index", colName, tableName),
					Description: fmt.Sprintf("Missing index on FKs can cause slow deletes and updates on the parent table. (Constraint: %s)", conName),
				})
			}
		}
	}

	// 3. Check for high sequential scans (Real PostgreSQL statistics)
	var seqScanIssue bool
	rows, err = h.DB.Pool.Query(ctx, `
		SELECT relname, seq_scan, idx_scan
		FROM pg_stat_user_tables
		WHERE seq_scan > COALESCE(idx_scan, 0) * 10
		  AND seq_scan > 1000
		  AND relname NOT LIKE '_v_%' AND relname NOT LIKE '_ozy_%'
		ORDER BY seq_scan DESC
		LIMIT 3
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var tableName string
			var seqScan, idxScan int64
			if err := rows.Scan(&tableName, &seqScan, &idxScan); err == nil {
				seqScanIssue = true
				issues = append(issues, HealthIssue{
					Type:        "performance",
					Title:       fmt.Sprintf("Table `%s` has high sequential scans (%d seq vs %d idx)", tableName, seqScan, idxScan),
					Description: "Consider adding indexes to frequently filtered columns or running ANALYZE.",
				})
			}
		}
	}
	// Only add generic warning if no specific tables found but stats suggest issues
	if !seqScanIssue {
		var totalSeq, totalIdx int64
		_ = h.DB.Pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(seq_scan), 0), COALESCE(SUM(idx_scan), 0)
			FROM pg_stat_user_tables
		`).Scan(&totalSeq, &totalIdx)
		// Only warn if significant imbalance
		if totalSeq > 10000 && totalIdx == 0 {
			issues = append(issues, HealthIssue{
				Type:        "performance",
				Title:       "High number of sequential scans detected",
				Description: "Consider adding indexes to frequently filtered columns.",
			})
		}
	}

	// 4. Check for public access rules
	var publicCount int
	_ = h.DB.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM _v_collections WHERE list_rule = 'public' AND name NOT LIKE '_v_%' AND name NOT LIKE '_ozy_%'").Scan(&publicCount)
	if publicCount > 0 {
		issues = append(issues, HealthIssue{
			Type:        "security",
			Title:       fmt.Sprintf("%d collections have public list rules", publicCount),
			Description: "Ensure this is intended and sensitive data is not exposed.",
		})
	}

	// 5. Check for unresolved security alerts
	rows, err = h.DB.Pool.Query(ctx, "SELECT type, severity, metadata FROM _v_security_alerts WHERE is_resolved = false ORDER BY created_at DESC LIMIT 10")
	if err == nil {
		defer rows.Close()
		type aggregatedAlert struct {
			issue HealthIssue
			count int
		}
		aggregated := make(map[string]*aggregatedAlert)
		order := make([]string, 0, 8)

		for rows.Next() {
			var aType, severity string
			var details map[string]any
			if err := rows.Scan(&aType, &severity, &details); err == nil {
				issue, aggregateKey, include := buildSecurityAlertHealthIssue(aType, details)
				if !include {
					continue
				}
				if aggregateKey == "" {
					aggregateKey = fmt.Sprintf("%s:%v", aType, details)
				}
				if existing, ok := aggregated[aggregateKey]; ok {
					existing.count++
					continue
				}
				aggregated[aggregateKey] = &aggregatedAlert{
					issue: issue,
					count: 1,
				}
				order = append(order, aggregateKey)
			}
		}

		for _, aggregateKey := range order {
			aggregate := aggregated[aggregateKey]
			if aggregate.count > 1 {
				aggregate.issue.Count = aggregate.count
			}
			issues = append(issues, aggregate.issue)
		}
	}

	for index := range issues {
		issues[index].Fixable = isHealthIssueAutoFixable(issues[index].Type, issues[index].Title)
	}

	h.setCachedHealthIssues(issues, 10*time.Second)
	return c.JSON(http.StatusOK, issues)
}

// FixHealthRequest represents a request to fix a health issue
type FixHealthRequest struct {
	Type  string `json:"type"`
	Issue string `json:"issue"`
}

type ReviewHealthRequest struct {
	Type      string `json:"type"`
	Issue     string `json:"issue"`
	ReviewKey string `json:"review_key"`
}

func isRLSHealthFixIssue(issueType, issue string) bool {
	typeLower := strings.ToLower(strings.TrimSpace(issueType))
	if typeLower != "security" {
		return false
	}
	issueLower := strings.ToLower(issue)
	return strings.Contains(issueLower, "row level security") ||
		strings.Contains(issueLower, "missing rls policies") ||
		strings.Contains(issueLower, " rls ")
}

func normalizeAllowedCountries(raw any) []string {
	switch value := raw.(type) {
	case []string:
		next := make([]string, 0, len(value))
		for _, country := range value {
			trimmed := strings.TrimSpace(country)
			if trimmed != "" {
				next = append(next, trimmed)
			}
		}
		return next
	case []any:
		next := make([]string, 0, len(value))
		for _, item := range value {
			trimmed := strings.TrimSpace(fmt.Sprint(item))
			if trimmed != "" && trimmed != "<nil>" {
				next = append(next, trimmed)
			}
		}
		return next
	default:
		return []string{}
	}
}

func containsFold(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), strings.TrimSpace(target)) {
			return true
		}
	}
	return false
}

func (h *Handler) resolveGeoBreachAlerts(ctx context.Context, reviewKey string) (int64, error) {
	ip, country, city, ok := parseGeoBreachReviewKey(strings.TrimSpace(reviewKey))
	var tag pgconn.CommandTag
	var err error
	if ok {
		tag, err = h.DB.Pool.Exec(ctx, `
			UPDATE _v_security_alerts
			SET is_resolved = true
			WHERE type = 'geo_breach'
			  AND is_resolved = false
			  AND COALESCE(metadata->>'ip', '') = $1
			  AND COALESCE(metadata->>'country', '') = $2
			  AND COALESCE(metadata->>'city', '') = $3
		`, ip, country, city)
	} else {
		tag, err = h.DB.Pool.Exec(ctx, `
			UPDATE _v_security_alerts
			SET is_resolved = true
			WHERE type = 'geo_breach'
			  AND is_resolved = false
		`)
	}
	if err != nil {
		return 0, err
	}
	h.invalidateHealthIssuesCache()
	return tag.RowsAffected(), nil
}

func isHealthIssueAutoFixable(issueType, issue string) bool {
	typeLower := strings.ToLower(strings.TrimSpace(issueType))
	issueLower := strings.ToLower(strings.TrimSpace(issue))

	if isRLSHealthFixIssue(issueType, issue) {
		return true
	}
	if typeLower == "security" && strings.Contains(issueLower, "public list rules") {
		return true
	}
	if typeLower == "performance" && strings.Contains(issueLower, "sequential scans") {
		return true
	}
	if typeLower == "performance" && strings.Contains(issueLower, "missing an index") {
		return true
	}
	return false
}

func resolveLatestUnresolvedGeoBreachCountry(ctx context.Context, tx pgx.Tx) (string, error) {
	var rawMetadata []byte
	err := tx.QueryRow(ctx, `
		SELECT metadata
		FROM _v_security_alerts
		WHERE type = 'geo_breach' AND is_resolved = false
		ORDER BY created_at DESC
		LIMIT 1
	`).Scan(&rawMetadata)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}

	var metadata map[string]any
	if len(rawMetadata) > 0 {
		if err := json.Unmarshal(rawMetadata, &metadata); err != nil {
			return "", err
		}
	}

	country := strings.TrimSpace(fmt.Sprint(metadata["country"]))
	if country == "" || country == "<nil>" || strings.EqualFold(country, "unknown") {
		return "", nil
	}
	return country, nil
}

func inferRLSAutoFixRuleFromColumns(tableName string, available map[string]struct{}) string {
	for _, candidate := range []string{"owner_id", "user_id", "created_by"} {
		if _, ok := available[candidate]; ok {
			return fmt.Sprintf("%s = auth.uid()", candidate)
		}
	}

	if tableName == "users" || tableName == "_v_users" {
		if _, ok := available["id"]; ok {
			return "id = auth.uid()"
		}
	}

	return ""
}

func resolveRLSAutoFixRule(ctx context.Context, tx pgx.Tx, tableName string) (string, error) {
	available, err := getTableColumnSet(ctx, tx, tableName)
	if err != nil {
		return "", err
	}

	if rule := inferRLSAutoFixRuleFromColumns(tableName, available); rule != "" {
		return rule, nil
	}

	var rule string
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(NULLIF(qual, ''), NULLIF(with_check, ''))
		FROM pg_policies
		WHERE schemaname = 'public' AND tablename = $1
		ORDER BY
			CASE cmd
				WHEN 'SELECT' THEN 0
				WHEN 'UPDATE' THEN 1
				WHEN 'DELETE' THEN 2
				WHEN 'INSERT' THEN 3
				ELSE 4
			END,
			policyname
		LIMIT 1
	`, tableName).Scan(&rule)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}

	return strings.TrimSpace(rule), nil
}

// FixHealthIssues handles POST /api/project/health/fix
func (h *Handler) FixHealthIssues(c echo.Context) error {
	var req FixHealthRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	log.Printf("applying health fix type=%s issue=%s", req.Type, req.Issue)

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	issueLower := strings.ToLower(req.Issue)
	typeLower := strings.ToLower(req.Type)

	if isRLSHealthFixIssue(req.Type, req.Issue) {
		// Extract table name from issue title: "Table `tablename` does not have..."
		parts := strings.Split(req.Issue, "`")
		if len(parts) < 3 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Could not identify table"})
		}
		tableName := parts[1]

		if !data.IsValidIdentifier(tableName) {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid table name"})
		}

		// Apply RLS
		tx, err := h.DB.Pool.Begin(ctx)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Transaction failed"})
		}
		defer func() { _ = tx.Rollback(ctx) }()

		rule, ruleErr := resolveRLSAutoFixRule(ctx, tx, tableName)
		if ruleErr != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to resolve RLS auto-fix rule: " + ruleErr.Error(),
			})
		}
		if rule == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "RLS auto-fix requires owner column (owner_id, user_id, created_by) or an existing policy",
			})
		}

		// 1. Primary PG RLS (Native)
		sql := fmt.Sprintf("ALTER TABLE %s ENABLE ROW LEVEL SECURITY", tableName)
		if _, err := tx.Exec(ctx, sql); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "Failed to enable native RLS: " + err.Error(),
			})
		}
		legacyPolicy := fmt.Sprintf("policy_ozy_%s", tableName)
		_, _ = tx.Exec(ctx, fmt.Sprintf("DROP POLICY IF EXISTS %s ON %s", legacyPolicy, tableName))
		for _, action := range rlsActions {
			policyName := makePolicyName(tableName, action)
			_, _ = tx.Exec(ctx, fmt.Sprintf("DROP POLICY IF EXISTS %s ON %s", policyName, tableName))
			if err := h.DB.CreatePolicyForAction(ctx, tx, tableName, policyName, action, rule); err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create RLS policy: " + err.Error()})
			}
		}

		// 2. OzyBase Metadata RLS (Internal)
		_, err = tx.Exec(ctx, `
			UPDATE _v_collections
			SET rls_enabled = true, rls_rule = $2, list_rule = 'auth', create_rule = 'admin', update_rule = 'auth', delete_rule = 'auth'
			WHERE name = $1
		`, tableName, rule)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update metadata: " + err.Error()})
		}

		if err := tx.Commit(ctx); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to commit fix"})
		}

		h.invalidateHealthIssuesCache()
		return c.JSON(http.StatusOK, map[string]string{"message": "RLS enabled successfully"})
	}

	if typeLower == "performance" && strings.Contains(issueLower, "sequential scans") {
		// Extract table name from issue: "Table `tablename` has high sequential scans..."
		parts := strings.Split(req.Issue, "`")
		if len(parts) >= 2 {
			tableName := parts[1]
			if data.IsValidIdentifier(tableName) {
				// 1. Create index on commonly queried columns (id is always indexed, but let's ensure others)
				// Get columns that might benefit from indexing
				columns, err := h.DB.Pool.Query(ctx, `
					SELECT column_name FROM information_schema.columns 
					WHERE table_name = $1 
					  AND table_schema = 'public'
					  AND column_name NOT IN ('id', 'created_at', 'updated_at', 'deleted_at')
					  AND data_type IN ('uuid', 'integer', 'bigint', 'text', 'varchar', 'boolean')
					LIMIT 3
				`, tableName)
				if err == nil {
					defer columns.Close()
					for columns.Next() {
						var colName string
						if columns.Scan(&colName) == nil && data.IsValidIdentifier(colName) {
							indexName := fmt.Sprintf("idx_%s_%s", tableName, colName)
							sql := fmt.Sprintf("CREATE INDEX IF NOT EXISTS %s ON %s (%s)", indexName, tableName, colName)
							_, _ = h.DB.Pool.Exec(ctx, sql)
						}
					}
				}

				// 2. Run ANALYZE on specific table
				sql := fmt.Sprintf("ANALYZE %s", tableName)
				_, _ = h.DB.Pool.Exec(ctx, sql)

				// 3. Reset statistics for this table
				_, _ = h.DB.Pool.Exec(ctx, "SELECT pg_stat_reset_single_table_counters($1::regclass::oid)", tableName)

				return c.JSON(http.StatusOK, map[string]string{
					"message": fmt.Sprintf("Created indexes, analyzed table '%s', and reset statistics", tableName),
				})
			}
		}

		// Fallback: Run global ANALYZE and reset all stats
		if _, err := h.DB.Pool.Exec(ctx, "ANALYZE"); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to run ANALYZE: " + err.Error()})
		}
		// Reset all user table stats
		_, _ = h.DB.Pool.Exec(ctx, "SELECT pg_stat_reset()")
		return c.JSON(http.StatusOK, map[string]string{"message": "Database statistics updated and counters reset"})
	}

	if typeLower == "security" && strings.Contains(issueLower, "public list rules") {
		// Fix: Change all public list rules to 'auth'
		_, err := h.DB.Pool.Exec(ctx, "UPDATE _v_collections SET list_rule = 'auth' WHERE list_rule = 'public'")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update collection rules: " + err.Error()})
		}
		return c.JSON(http.StatusOK, map[string]string{"message": "Public collections updated to Auth-only access"})
	}

	if typeLower == "security" && strings.Contains(issueLower, "geographic access breach") {
		tx, err := h.DB.Pool.Begin(ctx)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Transaction failed"})
		}
		defer func() { _ = tx.Rollback(ctx) }()

		country, err := resolveLatestUnresolvedGeoBreachCountry(ctx, tx)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to inspect geo breach details: " + err.Error()})
		}
		if country == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "No unresolved geo-breach alert with a valid country was found"})
		}

		policy := map[string]any{
			"enabled":           true,
			"allowed_countries": []string{},
		}

		var rawConfig []byte
		err = tx.QueryRow(ctx, "SELECT config FROM _v_security_policies WHERE type = 'geo_fencing'").Scan(&rawConfig)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load geo-fencing policy: " + err.Error()})
		}
		if len(rawConfig) > 0 {
			if err := json.Unmarshal(rawConfig, &policy); err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to parse geo-fencing policy: " + err.Error()})
			}
		}

		allowedCountries := normalizeAllowedCountries(policy["allowed_countries"])
		if !containsFold(allowedCountries, country) {
			allowedCountries = append(allowedCountries, country)
		}
		policy["enabled"] = true
		policy["allowed_countries"] = allowedCountries

		configJSON, marshalErr := json.Marshal(policy)
		if marshalErr != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to serialize geo-fencing policy: " + marshalErr.Error()})
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO _v_security_policies (type, config, updated_at)
			VALUES ('geo_fencing', $1, NOW())
			ON CONFLICT (type) DO UPDATE SET config = $1, updated_at = NOW()
		`, configJSON); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update geo-fencing policy: " + err.Error()})
		}

		if _, err := tx.Exec(ctx, `
			UPDATE _v_security_alerts
			SET is_resolved = true
			WHERE type = 'geo_breach' AND is_resolved = false
		`); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to resolve geo-breach alerts: " + err.Error()})
		}

		if err := tx.Commit(ctx); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to commit geo-breach fix"})
		}

		h.Geo.InvalidatePolicy()
		h.invalidateHealthIssuesCache()
		return c.JSON(http.StatusOK, map[string]string{"message": "Geo-fencing allowlist updated and geo-breach alerts resolved"})
	}

	if typeLower == "performance" && strings.Contains(issueLower, "missing an index") {
		// Extract column and table from: "Foreign Key `column` in `table` is missing an index"
		parts := strings.Split(req.Issue, "`")
		if len(parts) < 5 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Could not identify table or column"})
		}
		colName := parts[1]
		tableName := parts[3]

		if !data.IsValidIdentifier(tableName) || !data.IsValidIdentifier(colName) {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid identifiers"})
		}

		// Create index
		indexName := fmt.Sprintf("idx_%s_%s", tableName, colName)
		sql := fmt.Sprintf("CREATE INDEX IF NOT EXISTS %s ON %s (%s)", indexName, tableName, colName)
		if _, err := h.DB.Pool.Exec(ctx, sql); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create index: " + err.Error()})
		}
		return c.JSON(http.StatusOK, map[string]string{"message": "Index created successfully"})
	}

	log.Printf("health fix strategy not found type=%q issue=%q", req.Type, req.Issue)
	return c.JSON(http.StatusBadRequest, map[string]string{
		"error":      "Fix strategy not found for this issue: " + req.Issue,
		"error_code": "FIX_STRATEGY_NOT_FOUND",
	})
}

// ReviewHealthIssues handles POST /api/project/health/review
func (h *Handler) ReviewHealthIssues(c echo.Context) error {
	var req ReviewHealthRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	typeLower := strings.ToLower(strings.TrimSpace(req.Type))
	issueLower := strings.ToLower(strings.TrimSpace(req.Issue))
	if typeLower != "security" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Only security review flows are supported"})
	}

	if strings.Contains(issueLower, "geographic access breach") || strings.HasPrefix(strings.TrimSpace(req.ReviewKey), "geo_breach|") {
		affected, err := h.resolveGeoBreachAlerts(ctx, req.ReviewKey)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to review geo breach alerts: " + err.Error()})
		}
		if affected == 0 {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "No matching geo breach alerts were pending review"})
		}
		return c.JSON(http.StatusOK, map[string]any{
			"message":        "Geo breach alerts marked as reviewed",
			"rows_affected":  affected,
			"reviewed_issue": req.Issue,
		})
	}

	return c.JSON(http.StatusBadRequest, map[string]string{
		"error": "Review strategy not found for this issue: " + req.Issue,
	})
}

type EnforceRLSResult struct {
	Table          string   `json:"table"`
	Status         string   `json:"status"`
	Rule           string   `json:"rule,omitempty"`
	ActionsApplied []string `json:"actions_applied,omitempty"`
	Description    string   `json:"description,omitempty"`
}

func (h *Handler) enforceRLSAllInternal(ctx context.Context, dryRun bool, rulePattern string) ([]EnforceRLSResult, int, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT name
		FROM _v_collections
		WHERE name NOT LIKE '_v_%' AND name NOT LIKE '_ozy_%'
		ORDER BY name
	`)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	collections := make([]string, 0, 16)
	for rows.Next() {
		var name string
		if scanErr := rows.Scan(&name); scanErr == nil {
			collections = append(collections, name)
		}
	}

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	results := make([]EnforceRLSResult, 0, len(collections))
	enforcedCount := 0
	for _, tableName := range collections {
		if !data.IsValidIdentifier(tableName) {
			results = append(results, EnforceRLSResult{
				Table:       tableName,
				Status:      "skipped",
				Description: "invalid identifier",
			})
			continue
		}

		ownerColumn, ownerErr := resolveRLSOwnerColumn(ctx, tx, tableName)
		if ownerErr != nil || ownerColumn == "" {
			results = append(results, EnforceRLSResult{
				Table:       tableName,
				Status:      "skipped",
				Description: "owner column missing (owner_id/user_id/created_by)",
			})
			continue
		}

		rule := fmt.Sprintf("%s = auth.uid()", ownerColumn)
		if custom := strings.TrimSpace(rulePattern); custom != "" {
			rule = custom
		}
		if exprErr := validateRLSExpression(ctx, tx, tableName, rule); exprErr != nil {
			results = append(results, EnforceRLSResult{
				Table:       tableName,
				Status:      "error",
				Description: "invalid policy expression",
			})
			continue
		}

		if dryRun {
			results = append(results, EnforceRLSResult{
				Table:          tableName,
				Status:         "preview",
				Rule:           rule,
				ActionsApplied: append([]string{}, rlsActions...),
				Description:    "preview only (no changes applied)",
			})
			continue
		}

		enableSQL := fmt.Sprintf("ALTER TABLE %s ENABLE ROW LEVEL SECURITY", tableName)
		if _, execErr := tx.Exec(ctx, enableSQL); execErr != nil {
			results = append(results, EnforceRLSResult{
				Table:       tableName,
				Status:      "error",
				Description: "failed to enable native RLS",
			})
			continue
		}

		legacyPolicy := fmt.Sprintf("policy_ozy_%s", tableName)
		_, _ = tx.Exec(ctx, fmt.Sprintf("DROP POLICY IF EXISTS %s ON %s", legacyPolicy, tableName))
		applied := make([]string, 0, len(rlsActions))
		policyErr := false
		for _, action := range rlsActions {
			policyName := makePolicyName(tableName, action)
			_, _ = tx.Exec(ctx, fmt.Sprintf("DROP POLICY IF EXISTS %s ON %s", policyName, tableName))
			if err := h.DB.CreatePolicyForAction(ctx, tx, tableName, policyName, action, rule); err != nil {
				results = append(results, EnforceRLSResult{
					Table:       tableName,
					Status:      "error",
					Description: fmt.Sprintf("failed to create RLS %s policy", action),
				})
				policyErr = true
				break
			}
			applied = append(applied, action)
		}
		if policyErr {
			continue
		}

		if _, metaErr := tx.Exec(ctx, `
			UPDATE _v_collections
			SET rls_enabled = true, rls_rule = $2, list_rule = 'auth', create_rule = 'admin', update_rule = 'auth', delete_rule = 'auth'
			WHERE name = $1
		`, tableName, rule); metaErr != nil {
			results = append(results, EnforceRLSResult{
				Table:       tableName,
				Status:      "error",
				Description: "failed to update metadata",
			})
			continue
		}

		results = append(results, EnforceRLSResult{
			Table:          tableName,
			Status:         "enforced",
			Rule:           rule,
			ActionsApplied: append([]string{}, applied...),
			Description:    "native and metadata RLS enabled with per-action policies",
		})
		enforcedCount++
	}

	if dryRun {
		return results, 0, nil
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, 0, err
	}
	h.invalidateHealthIssuesCache()
	return results, enforcedCount, nil
}

// EnforceRLSAll enables RLS on all user collections with an owner column and tightens ACL defaults.
func (h *Handler) EnforceRLSAll(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 20*time.Second)
	defer cancel()

	var req struct {
		DryRun      bool   `json:"dry_run"`
		RulePattern string `json:"rule_pattern"`
	}
	if err := c.Bind(&req); err != nil && !errors.Is(err, io.EOF) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	dryRun := req.DryRun || strings.EqualFold(strings.TrimSpace(c.QueryParam("dry_run")), "true")

	results, enforcedCount, err := h.enforceRLSAllInternal(ctx, dryRun, req.RulePattern)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to enforce RLS policies"})
	}

	if dryRun {
		return c.JSON(http.StatusOK, map[string]any{
			"status":   "preview",
			"dry_run":  true,
			"results":  results,
			"enforced": 0,
		})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status":   "ok",
		"enforced": enforcedCount,
		"results":  results,
	})
}

func getTableColumnSet(ctx context.Context, tx pgx.Tx, tableName string) (map[string]struct{}, error) {
	rows, err := tx.Query(ctx, `
		SELECT column_name
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = $1
	`, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	available := map[string]struct{}{}
	for rows.Next() {
		var col string
		if scanErr := rows.Scan(&col); scanErr == nil {
			available[strings.ToLower(strings.TrimSpace(col))] = struct{}{}
		}
	}

	return available, rows.Err()
}

func resolveRLSOwnerColumn(ctx context.Context, tx pgx.Tx, tableName string) (string, error) {
	available, err := getTableColumnSet(ctx, tx, tableName)
	if err != nil {
		return "", err
	}

	for _, candidate := range []string{"owner_id", "user_id", "created_by"} {
		if _, ok := available[candidate]; ok {
			return candidate, nil
		}
	}
	if tableName == "users" || tableName == "_v_users" {
		if _, ok := available["id"]; ok {
			return "id", nil
		}
	}
	return "", nil
}
