package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/labstack/echo/v4"
)

type MCPTool struct {
	Name         string         `json:"name"`
	Description  string         `json:"description"`
	RequiresAuth bool           `json:"requires_auth"`
	InputSchema  map[string]any `json:"input_schema,omitempty"`
}

type MCPInvokeRequest struct {
	Tool      string         `json:"tool"`
	Arguments map[string]any `json:"arguments"`
}

type MCPRPCRequest struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      any            `json:"id,omitempty"`
	Method  string         `json:"method"`
	Params  map[string]any `json:"params,omitempty"`
}

type MCPRPCResponse struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      any            `json:"id,omitempty"`
	Result  any            `json:"result,omitempty"`
	Error   *MCPRPCError   `json:"error,omitempty"`
}

type MCPRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func buildMCPTools() []MCPTool {
	return []MCPTool{
		{
			Name:         "system.health",
			Description:  "Return backend health and SLO status summary.",
			RequiresAuth: true,
		},
		{
			Name:         "collections.list",
			Description:  "List user collections available in the current workspace.",
			RequiresAuth: true,
		},
		{
			Name:         "collections.create",
			Description:  "Create a collection/table with validated schema metadata.",
			RequiresAuth: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"name":         map[string]any{"type": "string"},
					"display_name": map[string]any{"type": "string"},
					"list_rule": map[string]any{
						"type": "string",
						"enum": []string{"public", "auth", "admin"},
					},
					"create_rule": map[string]any{
						"type": "string",
						"enum": []string{"auth", "admin"},
					},
					"realtime_enabled": map[string]any{"type": "boolean"},
					"schema": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"name":       map[string]any{"type": "string"},
								"type":       map[string]any{"type": "string"},
								"required":   map[string]any{"type": "boolean"},
								"unique":     map[string]any{"type": "boolean"},
								"is_primary": map[string]any{"type": "boolean"},
								"default":    map[string]any{},
								"references": map[string]any{"type": "string"},
							},
							"required": []string{"name", "type"},
						},
					},
				},
				"required": []string{"name", "schema"},
			},
		},
		{
			Name:         "vector.status",
			Description:  "Return pgvector availability/install/readiness status.",
			RequiresAuth: true,
		},
		{
			Name:         "nlq.translate",
			Description:  "Translate natural language to deterministic SQL.",
			RequiresAuth: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{"type": "string"},
					"table": map[string]any{"type": "string"},
					"limit": map[string]any{"type": "integer"},
				},
				"required": []string{"query"},
			},
		},
		{
			Name:         "nlq.query",
			Description:  "Execute deterministic NLQ query and return rows.",
			RequiresAuth: true,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{"type": "string"},
					"table": map[string]any{"type": "string"},
					"limit": map[string]any{"type": "integer"},
				},
				"required": []string{"query"},
			},
		},
	}
}

func standardizeMCPInputSchema(schema map[string]any) map[string]any {
	if len(schema) == 0 {
		return map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		}
	}

	normalized := map[string]any{}
	for key, value := range schema {
		normalized[key] = value
	}
	if _, ok := normalized["type"]; !ok {
		normalized["type"] = "object"
	}
	if _, ok := normalized["properties"]; !ok {
		normalized["properties"] = map[string]any{}
	}
	if _, ok := normalized["additionalProperties"]; !ok {
		normalized["additionalProperties"] = false
	}
	return normalized
}

func buildStandardMCPTools() []map[string]any {
	tools := buildMCPTools()
	out := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		out = append(out, map[string]any{
			"name":        tool.Name,
			"description": tool.Description,
			"inputSchema": standardizeMCPInputSchema(tool.InputSchema),
		})
	}
	return out
}

func mcpStringArg(args map[string]any, key string) string {
	raw, ok := args[key]
	if !ok {
		return ""
	}
	s, ok := raw.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(s)
}

func mcpIntArg(args map[string]any, key string) int {
	raw, ok := args[key]
	if !ok || raw == nil {
		return 0
	}
	switch v := raw.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return 0
		}
		return n
	default:
		return 0
	}
}

func mcpBoolArg(args map[string]any, key string, defaultValue bool) bool {
	raw, ok := args[key]
	if !ok || raw == nil {
		return defaultValue
	}
	switch v := raw.(type) {
	case bool:
		return v
	case string:
		normalized := strings.ToLower(strings.TrimSpace(v))
		switch normalized {
		case "true", "1", "yes", "y":
			return true
		case "false", "0", "no", "n":
			return false
		default:
			return defaultValue
		}
	case int:
		return v != 0
	case int64:
		return v != 0
	case float64:
		return v != 0
	default:
		return defaultValue
	}
}

func normalizeACLRule(raw string, fallback string, allowed map[string]struct{}) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	if normalized == "" {
		normalized = fallback
	}
	if _, ok := allowed[normalized]; ok {
		return normalized, nil
	}
	return "", fmt.Errorf("invalid ACL rule %q", raw)
}

func mcpParseFieldSchema(raw any) (data.FieldSchema, error) {
	m, ok := raw.(map[string]any)
	if !ok {
		return data.FieldSchema{}, errors.New("schema entries must be objects")
	}
	fieldName := strings.TrimSpace(mcpStringArg(m, "name"))
	fieldType := strings.TrimSpace(mcpStringArg(m, "type"))
	if fieldName == "" {
		return data.FieldSchema{}, errors.New("schema field name is required")
	}
	if fieldType == "" {
		return data.FieldSchema{}, fmt.Errorf("schema field %q type is required", fieldName)
	}
	if !data.IsValidIdentifier(fieldName) {
		return data.FieldSchema{}, fmt.Errorf("schema field %q is not a valid identifier", fieldName)
	}

	field := data.FieldSchema{
		Name:      fieldName,
		Type:      fieldType,
		Required:  mcpBoolArg(m, "required", false),
		Unique:    mcpBoolArg(m, "unique", false),
		IsPrimary: mcpBoolArg(m, "is_primary", false),
	}
	if refs := strings.TrimSpace(mcpStringArg(m, "references")); refs != "" {
		field.References = refs
	}
	if defaultValue, ok := m["default"]; ok {
		field.Default = defaultValue
	}
	return field, nil
}

func mcpParseSchema(args map[string]any) ([]data.FieldSchema, error) {
	raw, ok := args["schema"]
	if !ok {
		return nil, errors.New("schema is required")
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, errors.New("schema must be an array of fields")
	}
	if len(items) == 0 {
		return nil, errors.New("schema cannot be empty")
	}

	out := make([]data.FieldSchema, 0, len(items))
	for i, item := range items {
		field, err := mcpParseFieldSchema(item)
		if err != nil {
			return nil, fmt.Errorf("schema[%d]: %w", i, err)
		}
		out = append(out, field)
	}
	return out, nil
}

func (h *Handler) mcpCreateCollection(ctx context.Context, args map[string]any) (map[string]any, error) {
	name := strings.TrimSpace(mcpStringArg(args, "name"))
	if name == "" {
		return nil, errors.New("name is required")
	}
	if !data.IsValidIdentifier(name) {
		return nil, fmt.Errorf("collection name %q is invalid", name)
	}
	lowerName := strings.ToLower(name)
	if strings.HasPrefix(lowerName, "_v_") || strings.HasPrefix(lowerName, "_ozy_") {
		return nil, errors.New("system-prefixed table names are not allowed")
	}

	schema, err := mcpParseSchema(args)
	if err != nil {
		return nil, err
	}

	displayName := strings.TrimSpace(mcpStringArg(args, "display_name"))
	if displayName == "" {
		displayName = name
	}
	listRule, err := normalizeACLRule(mcpStringArg(args, "list_rule"), "auth", map[string]struct{}{
		"public": {},
		"auth":   {},
		"admin":  {},
	})
	if err != nil {
		return nil, err
	}
	createRule, err := normalizeACLRule(mcpStringArg(args, "create_rule"), "admin", map[string]struct{}{
		"auth":  {},
		"admin": {},
	})
	if err != nil {
		return nil, err
	}
	realtimeEnabled := mcpBoolArg(args, "realtime_enabled", false)

	createSQL, err := data.BuildCreateTableSQL(name, schema)
	if err != nil {
		return nil, err
	}

	schemaJSON, err := json.Marshal(schema)
	if err != nil {
		return nil, fmt.Errorf("failed to encode schema: %w", err)
	}

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var existed bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM _v_collections WHERE name = $1)", name).Scan(&existed); err != nil {
		return nil, fmt.Errorf("failed to inspect existing collection metadata: %w", err)
	}

	if _, err := tx.Exec(ctx, createSQL); err != nil {
		return nil, fmt.Errorf("failed to create collection table: %w", err)
	}

	if realtimeEnabled {
		triggerSQL := fmt.Sprintf(`
			CREATE TRIGGER tr_notify_%s
			AFTER INSERT OR UPDATE OR DELETE ON %s
			FOR EACH ROW EXECUTE FUNCTION notify_event();
		`, name, name)
		if _, err := tx.Exec(ctx, triggerSQL); err != nil {
			return nil, fmt.Errorf("failed to enable realtime trigger: %w", err)
		}
	}

	var collectionID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO _v_collections (name, display_name, schema_def, list_rule, create_rule, rls_enabled, realtime_enabled, updated_at)
		VALUES ($1, $2, $3, $4, $5, FALSE, $6, NOW())
		ON CONFLICT (name) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			schema_def = EXCLUDED.schema_def,
			list_rule = EXCLUDED.list_rule,
			create_rule = EXCLUDED.create_rule,
			realtime_enabled = EXCLUDED.realtime_enabled,
			updated_at = NOW()
		RETURNING id::text
	`, name, displayName, schemaJSON, listRule, createRule, realtimeEnabled).Scan(&collectionID); err != nil {
		return nil, fmt.Errorf("failed to upsert collection metadata: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit collection creation: %w", err)
	}

	status := "created"
	if existed {
		status = "updated"
	}
	return map[string]any{
		"status":           status,
		"id":               collectionID,
		"name":             name,
		"display_name":     displayName,
		"list_rule":        listRule,
		"create_rule":      createRule,
		"realtime_enabled": realtimeEnabled,
		"schema_fields":    len(schema),
	}, nil
}

func (h *Handler) mcpHealth(ctx context.Context) map[string]any {
	status := "ok"
	errText := ""
	if err := h.DB.Health(ctx); err != nil {
		status = "degraded"
		errText = err.Error()
	}

	serviceSLO, sloErr := h.evaluateServiceSLO(ctx, false)
	if sloErr != nil {
		return map[string]any{
			"status":    status,
			"db_error":  errText,
			"slo_error": sloErr.Error(),
		}
	}
	if serviceSLO.Breached {
		status = "degraded"
	}

	return map[string]any{
		"status":       status,
		"db_error":     errText,
		"slo_status":   serviceSLO.Status,
		"slo_breached": serviceSLO.Breached,
		"evaluated_at": serviceSLO.EvaluatedAt,
	}
}

func (h *Handler) mcpCollections(ctx context.Context) ([]string, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT name
		FROM _v_collections
		WHERE name NOT LIKE '\_v\_%' ESCAPE '\'
		  AND name NOT LIKE '\_ozy\_%' ESCAPE '\'
		ORDER BY name ASC
		LIMIT 500
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]string, 0, 64)
	for rows.Next() {
		var name string
		if scanErr := rows.Scan(&name); scanErr != nil {
			continue
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		out = append(out, name)
	}
	return out, nil
}

func (h *Handler) executeMCPTool(ctx context.Context, tool string, arguments map[string]any) (any, int, bool, error) {
	switch tool {
	case "system.health":
		return h.mcpHealth(ctx), http.StatusOK, true, nil
	case "collections.list":
		items, err := h.mcpCollections(ctx)
		if err != nil {
			return nil, http.StatusInternalServerError, true, err
		}
		return map[string]any{"items": items, "count": len(items)}, http.StatusOK, true, nil
	case "collections.create":
		result, err := h.mcpCreateCollection(ctx, arguments)
		if err != nil {
			return nil, http.StatusBadRequest, true, err
		}
		return result, http.StatusOK, true, nil
	case "vector.status":
		result, err := h.collectVectorStatus(ctx)
		if err != nil {
			return nil, http.StatusInternalServerError, true, err
		}
		return result, http.StatusOK, true, nil
	case "nlq.translate":
		nlqReq := NLQTranslateRequest{
			Query: mcpStringArg(arguments, "query"),
			Table: mcpStringArg(arguments, "table"),
			Limit: mcpIntArg(arguments, "limit"),
		}
		result, err := h.translateNLQ(ctx, nlqReq)
		if err != nil {
			return nil, http.StatusBadRequest, true, err
		}
		return result, http.StatusOK, true, nil
	case "nlq.query":
		nlqReq := NLQTranslateRequest{
			Query: mcpStringArg(arguments, "query"),
			Table: mcpStringArg(arguments, "table"),
			Limit: mcpIntArg(arguments, "limit"),
		}
		result, err := h.runNLQ(ctx, nlqReq)
		if err != nil {
			return nil, http.StatusBadRequest, true, err
		}
		return result, http.StatusOK, true, nil
	default:
		return nil, http.StatusNotFound, false, errors.New("unknown MCP tool")
	}
}

func newMCPRPCResponse(id any, result any) MCPRPCResponse {
	return MCPRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}
}

func newMCPRPCError(id any, code int, message string) MCPRPCResponse {
	return MCPRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error: &MCPRPCError{
			Code:    code,
			Message: message,
		},
	}
}

func encodeMCPToolContent(result any) string {
	if result == nil {
		return "{}"
	}
	payload, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", result)
	}
	return string(payload)
}

// GetMCPTools handles GET /api/project/mcp/tools
func (h *Handler) GetMCPTools(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{
		"runtime": "native",
		"count":   len(buildMCPTools()),
		"tools":   buildMCPTools(),
	})
}

// InvokeMCPTool handles POST /api/project/mcp/invoke
func (h *Handler) InvokeMCPTool(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 12*time.Second)
	defer cancel()

	var req MCPInvokeRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid MCP payload"})
	}
	req.Tool = strings.TrimSpace(req.Tool)
	if req.Tool == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "tool is required"})
	}
	if req.Arguments == nil {
		req.Arguments = map[string]any{}
	}
	result, status, found, err := h.executeMCPTool(ctx, req.Tool, req.Arguments)
	if !found {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "unknown MCP tool"})
	}
	if err != nil {
		return c.JSON(status, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, map[string]any{
		"tool":   req.Tool,
		"result": result,
	})
}

// HandleMCPRPC exposes a standard JSON-RPC MCP endpoint for editor integrations.
func (h *Handler) HandleMCPRPC(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 12*time.Second)
	defer cancel()

	var req MCPRPCRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, newMCPRPCError(nil, -32700, "invalid JSON payload"))
	}
	if strings.TrimSpace(req.Method) == "" {
		return c.JSON(http.StatusBadRequest, newMCPRPCError(req.ID, -32600, "method is required"))
	}

	method := strings.TrimSpace(req.Method)
	params := req.Params
	if params == nil {
		params = map[string]any{}
	}

	if strings.HasPrefix(method, "notifications/") {
		return c.NoContent(http.StatusAccepted)
	}

	switch method {
	case "initialize":
		protocolVersion := mcpStringArg(params, "protocolVersion")
		if protocolVersion == "" {
			protocolVersion = "2025-06-18"
		}
		return c.JSON(http.StatusOK, newMCPRPCResponse(req.ID, map[string]any{
			"protocolVersion": protocolVersion,
			"capabilities": map[string]any{
				"tools": map[string]any{
					"listChanged": false,
				},
			},
			"serverInfo": map[string]any{
				"name":    "OzyBase",
				"version": "2026.03",
			},
			"instructions": "Use tools/list and tools/call to access the OzyBase MCP runtime.",
		}))
	case "ping":
		return c.JSON(http.StatusOK, newMCPRPCResponse(req.ID, map[string]any{}))
	case "tools/list":
		return c.JSON(http.StatusOK, newMCPRPCResponse(req.ID, map[string]any{
			"tools": buildStandardMCPTools(),
		}))
	case "tools/call":
		toolName := mcpStringArg(params, "name")
		if toolName == "" {
			return c.JSON(http.StatusBadRequest, newMCPRPCError(req.ID, -32602, "tool name is required"))
		}

		rawArgs, ok := params["arguments"]
		if !ok || rawArgs == nil {
			rawArgs = map[string]any{}
		}
		args, ok := rawArgs.(map[string]any)
		if !ok {
			return c.JSON(http.StatusBadRequest, newMCPRPCError(req.ID, -32602, "tool arguments must be an object"))
		}

		result, _, found, err := h.executeMCPTool(ctx, toolName, args)
		if !found {
			return c.JSON(http.StatusNotFound, newMCPRPCError(req.ID, -32601, "unknown MCP tool"))
		}
		if err != nil {
			return c.JSON(http.StatusOK, newMCPRPCResponse(req.ID, map[string]any{
				"content": []map[string]any{
					{"type": "text", "text": err.Error()},
				},
				"structuredContent": map[string]any{
					"tool":  toolName,
					"error": err.Error(),
				},
				"isError": true,
			}))
		}

		return c.JSON(http.StatusOK, newMCPRPCResponse(req.ID, map[string]any{
			"content": []map[string]any{
				{"type": "text", "text": encodeMCPToolContent(result)},
			},
			"structuredContent": result,
		}))
	default:
		return c.JSON(http.StatusNotFound, newMCPRPCError(req.ID, -32601, "method not found"))
	}
}
