package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
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

func normalizeRLSPolicies(singleRule string, perAction map[string]string) map[string]string {
	policies := map[string]string{
		"select": "",
		"insert": "",
		"update": "",
		"delete": "",
	}

	if perAction != nil {
		for action, raw := range perAction {
			key := strings.ToLower(strings.TrimSpace(action))
			if _, ok := policies[key]; ok {
				policies[key] = strings.TrimSpace(raw)
			}
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

	blocked := []string{";", "--", "/*", "*/"}
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
							"error": fmt.Sprintf("Invalid RLS %s policy: one or more referenced columns do not exist", action),
						})
					}
					if pgErr.Code == "42601" || pgErr.Code == "42883" {
						return c.JSON(http.StatusBadRequest, map[string]string{
							"error": fmt.Sprintf("Invalid RLS %s policy expression: %s", action, pgErr.Message),
						})
					}
				}
				return c.JSON(http.StatusBadRequest, map[string]string{
					"error": fmt.Sprintf("Invalid RLS %s policy expression", action),
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

	metaMap := make(map[string]Collection)
	if err == nil {
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
			result = append(result, meta)
		} else {
			// Non-managed tables: tables in the physical DB but not in _v_collections
			// When a workspace IS selected, only show system tables (admin needs them)
			// Hide non-system unmanaged tables to enforce strict workspace isolation
			if workspaceID != "" && !isSystem {
				continue
			}
			result = append(result, Collection{
				Name:        tableName,
				DisplayName: tableName,
				IsSystem:    isSystem,
				ListRule:    "public",
				CreateRule:  "admin",
				Schema:      []data.FieldSchema{},
			})
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
	Name             string      `json:"name"`
	Host             string      `json:"host"`
	Port             string      `json:"port"`
	Database         string      `json:"database"`
	User             string      `json:"user"`
	Password         string      `json:"password,omitempty"`
	SSLMode          string      `json:"ssl_mode,omitempty"`
	PoolerHost       string      `json:"pooler_host,omitempty"`
	PoolerPort       string      `json:"pooler_port,omitempty"`
	PoolerTxPort     string      `json:"pooler_tx_port,omitempty"`
	ReadReplicaHost  string      `json:"read_replica_host,omitempty"`
	ReadReplicaPort  string      `json:"read_replica_port,omitempty"`
	ReadReplicaMode  string      `json:"read_replica_ssl_mode,omitempty"`
	APIURL           string      `json:"api_url,omitempty"`
	ServiceRoleKey   string      `json:"service_role_key,omitempty"`
	CanViewSecrets   bool        `json:"can_view_secrets"`
	InternalOnlyHost bool        `json:"internal_only_host"`
	TableCount       int         `json:"table_count"`
	UserTableCount   int         `json:"user_table_count"`
	SystemTableCount int         `json:"system_table_count"`
	FunctionCount    int         `json:"function_count"`
	SchemaCount      int         `json:"schema_count"`
	DbSize           string      `json:"db_size"`
	DbSizeBytes      int64       `json:"db_size_bytes"`
	Version          string      `json:"version"`
	Metrics          DbMetrics   `json:"metrics"`
	SlowQueries      []SlowQuery `json:"slow_queries"`
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

	// Connection info
	info.Name = info.Database
	info.Host = "localhost"
	info.Port = "5432"
	info.User = "postgres"
	info.SSLMode = "disable"

	if conn := resolveProjectConnectionInfo(); conn != nil {
		if conn.Host != "" {
			info.Host = conn.Host
		}
		if conn.Port != "" {
			info.Port = conn.Port
		}
		if conn.Database != "" {
			info.Database = conn.Database
			info.Name = conn.Database
		}
		if conn.User != "" {
			info.User = conn.User
		}
		if conn.Password != "" {
			info.Password = conn.Password
		}
		if conn.SSLMode != "" {
			info.SSLMode = conn.SSLMode
		}
		info.PoolerHost = conn.PoolerHost
		info.PoolerPort = conn.PoolerPort
		info.PoolerTxPort = conn.PoolerTxPort
		info.ReadReplicaHost = conn.ReadReplicaHost
		info.ReadReplicaPort = conn.ReadReplicaPort
		info.ReadReplicaMode = conn.ReadReplicaMode
		info.InternalOnlyHost = conn.InternalOnlyHost
	}

	if apiURL := readEnvForProjectInfo("SITE_URL"); apiURL != "" {
		info.APIURL = strings.TrimRight(apiURL, "/")
	}

	role, _ := c.Get("role").(string)
	info.CanViewSecrets = role == "admin"
	if info.CanViewSecrets {
		if key := firstNonEmptyEnv("SERVICE_ROLE_KEY", "OZY_SERVICE_ROLE_KEY"); key != "" {
			info.ServiceRoleKey = key
		}
		if info.Password == "" {
			info.Password = "[set in DATABASE_URL]"
		}
	} else {
		info.Password = ""
	}

	return c.JSON(http.StatusOK, info)
}

type projectConnectionInfo struct {
	Host             string
	Port             string
	Database         string
	User             string
	Password         string
	SSLMode          string
	PoolerHost       string
	PoolerPort       string
	PoolerTxPort     string
	ReadReplicaHost  string
	ReadReplicaPort  string
	ReadReplicaMode  string
	InternalOnlyHost bool
}

func resolveProjectConnectionInfo() *projectConnectionInfo {
	host := readEnvForProjectInfo("DB_PUBLIC_HOST")
	port := readEnvForProjectInfo("DB_PUBLIC_PORT")
	db := readEnvForProjectInfo("DB_NAME")
	user := readEnvForProjectInfo("DB_USER")
	password := readEnvForProjectInfo("DB_PASSWORD")
	sslmode := readEnvForProjectInfo("DB_SSLMODE")
	poolerHost := firstNonEmptyEnv("DB_POOLER_HOST", "POOLER_HOST")
	poolerPort := firstNonEmptyEnv("DB_POOLER_PORT", "POOLER_PORT")
	poolerTxPort := firstNonEmptyEnv("DB_POOLER_TX_PORT", "POOLER_TX_PORT")
	readReplicaHost := firstNonEmptyEnv("DB_READ_REPLICA_HOST", "READ_REPLICA_HOST")
	readReplicaPort := firstNonEmptyEnv("DB_READ_REPLICA_PORT", "READ_REPLICA_PORT")
	readReplicaMode := firstNonEmptyEnv("DB_READ_REPLICA_SSLMODE", "READ_REPLICA_SSLMODE")

	if host == "" {
		host = readEnvForProjectInfo("DB_HOST")
	}
	if port == "" {
		port = readEnvForProjectInfo("DB_PORT")
	}

	if host == "" || db == "" || user == "" {
		if parsed := parseDatabaseURL(readEnvForProjectInfo("DATABASE_URL")); parsed != nil {
			if host == "" {
				host = parsed.Host
			}
			if port == "" {
				port = parsed.Port
			}
			if db == "" {
				db = parsed.Database
			}
			if user == "" {
				user = parsed.User
			}
			if password == "" {
				password = parsed.Password
			}
			if sslmode == "" {
				sslmode = parsed.SSLMode
			}
		}
	}

	if host == "" {
		host = "localhost"
	}
	if port == "" {
		port = "5432"
	}
	if db == "" {
		db = "ozybase"
	}
	if user == "" {
		user = "postgres"
	}
	if sslmode == "" {
		sslmode = "disable"
	}
	if poolerPort == "" {
		poolerPort = "6543"
	}
	if poolerTxPort == "" {
		poolerTxPort = "6543"
	}
	if readReplicaMode == "" {
		readReplicaMode = sslmode
	}

	return &projectConnectionInfo{
		Host:             host,
		Port:             port,
		Database:         db,
		User:             user,
		Password:         password,
		SSLMode:          sslmode,
		PoolerHost:       poolerHost,
		PoolerPort:       poolerPort,
		PoolerTxPort:     poolerTxPort,
		ReadReplicaHost:  readReplicaHost,
		ReadReplicaPort:  readReplicaPort,
		ReadReplicaMode:  readReplicaMode,
		InternalOnlyHost: isInternalDBHost(host),
	}
}

func parseDatabaseURL(raw string) *projectConnectionInfo {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil
	}
	password, _ := u.User.Password()
	sslmode := u.Query().Get("sslmode")
	if sslmode == "" {
		sslmode = "disable"
	}
	return &projectConnectionInfo{
		Host:     u.Hostname(),
		Port:     u.Port(),
		Database: strings.TrimPrefix(u.Path, "/"),
		User:     u.User.Username(),
		Password: password,
		SSLMode:  sslmode,
	}
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		if v := readEnvForProjectInfo(key); v != "" {
			return v
		}
	}
	return ""
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

func isInternalDBHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	return h == "localhost" || h == "127.0.0.1" || h == "db" || strings.HasSuffix(h, ".internal")
}

// HealthIssue represents a security or performance recommendation
type HealthIssue struct {
	Type        string `json:"type"` // "security" | "performance"
	Title       string `json:"title"`
	Description string `json:"description"`
}

// GetHealthIssues handles GET /api/project/health
func (h *Handler) GetHealthIssues(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	// Initialize as empty slice so it marshals to [] instead of null if empty
	issues := make([]HealthIssue, 0)

	// 1. Check for tables without RLS (Mock for now as we don't have a formal RLS system in the app yet,
	// but we can check actual PG tables)
	// 1. Check for tables without RLS enabled in OzyBase metadata
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT name
		FROM _v_collections
		WHERE rls_enabled = false
		  AND name NOT LIKE '_v_%' AND name NOT LIKE '_ozy_%'
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var tableName string
			if err := rows.Scan(&tableName); err == nil {
				issues = append(issues, HealthIssue{
					Type:        "security",
					Title:       fmt.Sprintf("Table `%s` does not have Row Level Security enabled", tableName),
					Description: "RLS is recommended to protect your data at the database level.",
				})
			}
		}
	}

	// 2. Check for Foreign Keys without indexes (Dynamic)
	rows, err = h.DB.Pool.Query(ctx, `
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
		for rows.Next() {
			var aType, severity string
			var details map[string]any
			if err := rows.Scan(&aType, &severity, &details); err == nil {
				title := "Unknown Security Alert"
				desc := "A security event was detected."

				if aType == "geo_breach" && details != nil {
					title = "Geographic Access Breach"
					desc = fmt.Sprintf("Access attempt from unauthorized location: %v (%v) via IP %v", details["country"], details["city"], details["ip"])
				} else if aType == "system_error" && details != nil {
					title = "System Configuration Error"
					desc = fmt.Sprintf("Error: %v", details["error"])
				}

				issues = append(issues, HealthIssue{
					Type:        "security",
					Title:       title,
					Description: desc,
				})
			}
		}
	}

	return c.JSON(http.StatusOK, issues)
}

// FixHealthRequest represents a request to fix a health issue
type FixHealthRequest struct {
	Type  string `json:"type"`
	Issue string `json:"issue"`
}

// FixHealthIssues handles POST /api/project/health/fix
func (h *Handler) FixHealthIssues(c echo.Context) error {
	var req FixHealthRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	// Logging to debug what the frontend is sending
	fmt.Printf("🛠️ Applying fix: Type=%s, Issue=%s\n", req.Type, req.Issue)

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	issueLower := strings.ToLower(req.Issue)
	typeLower := strings.ToLower(req.Type)

	if typeLower == "security" && strings.Contains(issueLower, "row level security") {
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

		ownerColumn, ownerErr := resolveRLSOwnerColumn(ctx, tx, tableName)
		if ownerErr != nil || ownerColumn == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "RLS auto-fix requires owner column (owner_id, user_id, created_by)",
			})
		}
		rule := fmt.Sprintf("%s = auth.uid()", ownerColumn)

		// 1. Primary PG RLS (Native)
		sql := fmt.Sprintf("ALTER TABLE %s ENABLE ROW LEVEL SECURITY", tableName)
		if _, err := tx.Exec(ctx, sql); err != nil {
			log.Printf("Warning: Failed to enable native RLS (might not have permission): %v", err)
		}
		policySQL := fmt.Sprintf("DROP POLICY IF EXISTS policy_ozy_%s ON %s", tableName, tableName)
		_, _ = tx.Exec(ctx, policySQL)
		policyName := fmt.Sprintf("policy_ozy_%s", tableName)
		if err := h.DB.CreatePolicy(ctx, tx, tableName, policyName, rule); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create RLS policy: " + err.Error()})
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

	return c.JSON(http.StatusNotFound, map[string]string{"error": "Fix strategy not found for this issue: " + req.Issue})
}

type EnforceRLSResult struct {
	Table       string `json:"table"`
	Status      string `json:"status"`
	Rule        string `json:"rule,omitempty"`
	Description string `json:"description,omitempty"`
}

// EnforceRLSAll enables RLS on all user collections with an owner column and tightens ACL defaults.
func (h *Handler) EnforceRLSAll(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 20*time.Second)
	defer cancel()

	rows, err := h.DB.Pool.Query(ctx, `
		SELECT name, rls_enabled
		FROM _v_collections
		WHERE name NOT LIKE '_v_%' AND name NOT LIKE '_ozy_%'
		ORDER BY name
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to list collections"})
	}
	defer rows.Close()

	type entry struct {
		Name       string
		RLSEnabled bool
	}
	var collections []entry
	for rows.Next() {
		var e entry
		if scanErr := rows.Scan(&e.Name, &e.RLSEnabled); scanErr == nil {
			collections = append(collections, e)
		}
	}

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to start transaction"})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	results := make([]EnforceRLSResult, 0, len(collections))
	for _, col := range collections {
		if !data.IsValidIdentifier(col.Name) {
			results = append(results, EnforceRLSResult{
				Table:       col.Name,
				Status:      "skipped",
				Description: "invalid identifier",
			})
			continue
		}

		ownerColumn, ownerErr := resolveRLSOwnerColumn(ctx, tx, col.Name)
		if ownerErr != nil || ownerColumn == "" {
			results = append(results, EnforceRLSResult{
				Table:       col.Name,
				Status:      "skipped",
				Description: "owner column missing (owner_id/user_id/created_by)",
			})
			continue
		}

		rule := fmt.Sprintf("%s = auth.uid()", ownerColumn)
		enableSQL := fmt.Sprintf("ALTER TABLE %s ENABLE ROW LEVEL SECURITY", col.Name)
		if _, execErr := tx.Exec(ctx, enableSQL); execErr != nil {
			results = append(results, EnforceRLSResult{
				Table:       col.Name,
				Status:      "error",
				Description: "failed to enable native RLS",
			})
			continue
		}

		dropPolicySQL := fmt.Sprintf("DROP POLICY IF EXISTS policy_ozy_%s ON %s", col.Name, col.Name)
		_, _ = tx.Exec(ctx, dropPolicySQL)
		policyName := fmt.Sprintf("policy_ozy_%s", col.Name)
		if policyErr := h.DB.CreatePolicy(ctx, tx, col.Name, policyName, rule); policyErr != nil {
			results = append(results, EnforceRLSResult{
				Table:       col.Name,
				Status:      "error",
				Description: "failed to create RLS policy",
			})
			continue
		}

		if _, metaErr := tx.Exec(ctx, `
			UPDATE _v_collections
			SET rls_enabled = true, rls_rule = $2, list_rule = 'auth', create_rule = 'admin', update_rule = 'auth', delete_rule = 'auth'
			WHERE name = $1
		`, col.Name, rule); metaErr != nil {
			results = append(results, EnforceRLSResult{
				Table:       col.Name,
				Status:      "error",
				Description: "failed to update metadata",
			})
			continue
		}

		results = append(results, EnforceRLSResult{
			Table:       col.Name,
			Status:      "enforced",
			Rule:        rule,
			Description: "native and metadata RLS enabled",
		})
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit RLS enforcement"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status":  "ok",
		"results": results,
	})
}

func resolveRLSOwnerColumn(ctx context.Context, tx pgx.Tx, tableName string) (string, error) {
	rows, err := tx.Query(ctx, `
		SELECT column_name
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = $1
	`, tableName)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	available := map[string]struct{}{}
	for rows.Next() {
		var col string
		if scanErr := rows.Scan(&col); scanErr == nil {
			available[strings.ToLower(strings.TrimSpace(col))] = struct{}{}
		}
	}

	for _, candidate := range []string{"owner_id", "user_id", "created_by"} {
		if _, ok := available[candidate]; ok {
			return candidate, nil
		}
	}
	return "", nil
}
