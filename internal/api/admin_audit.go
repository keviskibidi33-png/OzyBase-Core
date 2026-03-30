package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

const (
	maxAdminAuditBodyBytes = 32 * 1024
)

type adminAuditDescriptor struct {
	Action      string
	TargetParam string
}

var adminAuditDescriptors = map[string]adminAuditDescriptor{
	"GET /api/project/keys":                            {Action: "api_key_list"},
	"GET /api/project/keys/events":                     {Action: "api_key_events_list"},
	"GET /api/project/keys/essential":                  {Action: "api_key_essential_list"},
	"POST /api/project/keys/essential/verify":          {Action: "api_key_essential_verify"},
	"POST /api/project/keys/essential/:role/reveal":    {Action: "api_key_essential_reveal", TargetParam: "role"},
	"POST /api/project/keys/essential/:role/rotate":    {Action: "api_key_essential_rotate", TargetParam: "role"},
	"POST /api/project/keys":                           {Action: "api_key_create"},
	"DELETE /api/project/keys/:id":                     {Action: "api_key_delete", TargetParam: "id"},
	"PATCH /api/project/keys/:id/toggle":               {Action: "api_key_toggle", TargetParam: "id"},
	"POST /api/project/keys/:id/rotate":                {Action: "api_key_rotate", TargetParam: "id"},
	"POST /api/auth/signup":                            {Action: "admin_user_create"},
	"PATCH /api/auth/users/:id/role":                   {Action: "admin_user_role_update", TargetParam: "id"},
	"GET /api/auth/providers":                          {Action: "auth_providers_read"},
	"GET /api/auth/config":                             {Action: "auth_config_read"},
	"GET /api/auth/templates":                          {Action: "auth_templates_read"},
	"PUT /api/auth/templates/:type":                    {Action: "auth_template_update", TargetParam: "type"},
	"POST /api/auth/sessions/revoke-all":               {Action: "admin_sessions_revoke_all"},
	"GET /api/project/performance/advisor":             {Action: "performance_advisor_read"},
	"GET /api/project/performance/advisor/history":     {Action: "performance_advisor_history_read"},
	"GET /api/project/vector/status":                   {Action: "vector_status_read"},
	"POST /api/project/vector/setup":                   {Action: "vector_setup"},
	"POST /api/project/vector/upsert":                  {Action: "vector_upsert"},
	"POST /api/project/vector/search":                  {Action: "vector_search"},
	"POST /api/project/nlq/translate":                  {Action: "nlq_translate"},
	"POST /api/project/nlq/query":                      {Action: "nlq_query"},
	"POST /api/project/mcp":                            {Action: "mcp_rpc"},
	"GET /api/project/mcp/tools":                       {Action: "mcp_tools_read"},
	"POST /api/project/mcp/invoke":                     {Action: "mcp_invoke"},
	"GET /api/project/realtime/status":                 {Action: "realtime_status_read"},
	"POST /api/project/security/policies":              {Action: "security_policy_update"},
	"POST /api/project/security/notifications":         {Action: "security_notification_add"},
	"DELETE /api/project/security/notifications/:id":   {Action: "security_notification_delete", TargetParam: "id"},
	"GET /api/project/observability/slo":               {Action: "observability_slo_read"},
	"GET /api/project/security/alert-routing":          {Action: "security_alert_routing_read"},
	"POST /api/project/security/alert-routing":         {Action: "security_alert_routing_update"},
	"GET /api/project/security/rls/coverage":           {Action: "security_rls_coverage_read"},
	"GET /api/project/security/rls/coverage/history":   {Action: "security_rls_coverage_history_read"},
	"POST /api/project/security/rls/enforce":           {Action: "security_rls_enforce_all"},
	"POST /api/project/security/rls/closeout":          {Action: "security_rls_closeout"},
	"GET /api/project/integrations/metrics":            {Action: "integrations_metrics_read"},
	"GET /api/project/integrations/dlq":                {Action: "integrations_dlq_read"},
	"POST /api/project/integrations/dlq/:id/retry":     {Action: "integrations_dlq_retry", TargetParam: "id"},
	"POST /api/project/integrations":                   {Action: "integrations_create"},
	"DELETE /api/project/integrations/:id":             {Action: "integrations_delete", TargetParam: "id"},
	"POST /api/project/integrations/:id/test":          {Action: "integrations_test", TargetParam: "id"},
	"POST /api/project/health/fix":                     {Action: "project_health_fix"},
	"DELETE /api/functions/:name":                      {Action: "function_delete", TargetParam: "name"},
	"POST /api/security/firewall":                      {Action: "firewall_rule_create"},
	"DELETE /api/security/firewall/:id":                {Action: "firewall_rule_delete", TargetParam: "id"},
	"POST /api/extensions/:name":                       {Action: "extension_toggle", TargetParam: "name"},
	"POST /api/cron/enable":                            {Action: "cron_enable"},
	"GET /api/extensions/marketplace":                  {Action: "extensions_marketplace_list"},
	"POST /api/extensions/marketplace/sync":            {Action: "extensions_marketplace_sync"},
	"POST /api/extensions/marketplace/:slug/install":   {Action: "extensions_marketplace_install", TargetParam: "slug"},
	"DELETE /api/extensions/marketplace/:slug/install": {Action: "extensions_marketplace_uninstall", TargetParam: "slug"},
	"POST /api/vault":                                  {Action: "vault_secret_create"},
	"DELETE /api/vault/:id":                            {Action: "vault_secret_delete", TargetParam: "id"},
	"GET /api/project/connection":                      {Action: "project_connection_read"},
	"POST /api/wrappers":                               {Action: "wrapper_create"},
	"DELETE /api/wrappers/:name":                       {Action: "wrapper_delete", TargetParam: "name"},
	"POST /api/sql":                                    {Action: "sql_execute"},
	"POST /api/sql/sync":                               {Action: "sql_sync"},
	"GET /api/project/security/admin-audit":            {Action: "admin_audit_read"},
}

func makeAdminAuditKey(method, route string) string {
	return strings.ToUpper(strings.TrimSpace(method)) + " " + strings.TrimSpace(route)
}

func normalizeRouteCandidates(route string) []string {
	route = strings.TrimSpace(route)
	if route == "" {
		return []string{}
	}
	candidates := []string{route}
	if strings.HasPrefix(route, "/api/") {
		trimmed := strings.TrimPrefix(route, "/api")
		if strings.HasPrefix(trimmed, "/") {
			candidates = append(candidates, trimmed)
		}
	} else if strings.HasPrefix(route, "/") {
		candidates = append(candidates, "/api"+route)
	}
	return candidates
}

func splitRoutePath(path string) []string {
	clean := strings.Trim(strings.TrimSpace(path), "/")
	if clean == "" {
		return []string{}
	}
	return strings.Split(clean, "/")
}

func routePatternMatches(pattern, actual string) bool {
	patternParts := splitRoutePath(pattern)
	actualParts := splitRoutePath(actual)
	if len(patternParts) != len(actualParts) {
		return false
	}
	for i := 0; i < len(patternParts); i++ {
		if strings.HasPrefix(patternParts[i], ":") {
			continue
		}
		if patternParts[i] != actualParts[i] {
			return false
		}
	}
	return true
}

func lookupAdminAuditDescriptor(method, route, requestPath string) (adminAuditDescriptor, bool) {
	for _, candidate := range normalizeRouteCandidates(route) {
		if desc, ok := adminAuditDescriptors[makeAdminAuditKey(method, candidate)]; ok {
			return desc, true
		}
	}

	reqPathCandidates := normalizeRouteCandidates(requestPath)
	for key, desc := range adminAuditDescriptors {
		keyParts := strings.SplitN(key, " ", 2)
		if len(keyParts) != 2 {
			continue
		}
		if keyParts[0] != strings.ToUpper(strings.TrimSpace(method)) {
			continue
		}
		pattern := strings.TrimSpace(keyParts[1])
		for _, actual := range reqPathCandidates {
			if routePatternMatches(pattern, actual) {
				return desc, true
			}
		}
	}
	return adminAuditDescriptor{}, false
}

func shouldCaptureBody(method string) bool {
	switch strings.ToUpper(strings.TrimSpace(method)) {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func captureAuditBody(c echo.Context) []byte {
	req := c.Request()
	if req == nil || req.Body == nil {
		return nil
	}
	if !shouldCaptureBody(req.Method) {
		return nil
	}
	if req.ContentLength <= 0 || req.ContentLength > maxAdminAuditBodyBytes {
		return nil
	}
	if !strings.Contains(strings.ToLower(strings.TrimSpace(req.Header.Get(echo.HeaderContentType))), "application/json") {
		return nil
	}

	raw, err := io.ReadAll(req.Body)
	if err != nil {
		return nil
	}
	req.Body = io.NopCloser(bytes.NewBuffer(raw))
	return raw
}

func actorIDFromAuditContext(c echo.Context) *string {
	raw, ok := c.Get("user_id").(string)
	if !ok {
		return nil
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	if _, err := uuid.Parse(raw); err != nil {
		return nil
	}
	return &raw
}

func workspaceIDFromAuditContext(c echo.Context) *string {
	raw, ok := c.Get("workspace_id").(string)
	if !ok {
		return nil
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	if _, err := uuid.Parse(raw); err != nil {
		return nil
	}
	return &raw
}

func hashedValue(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:8])
}

func sqlStatementKind(raw string) string {
	trimmed := trimLeadingSQLComments(raw)
	if trimmed == "" {
		return "UNKNOWN"
	}
	fields := strings.Fields(trimmed)
	if len(fields) == 0 {
		return "UNKNOWN"
	}
	return strings.ToUpper(fields[0])
}

func trimLeadingSQLComments(raw string) string {
	trimmed := strings.TrimSpace(raw)
	for trimmed != "" {
		switch {
		case strings.HasPrefix(trimmed, "--"):
			nextLine := strings.Index(trimmed, "\n")
			if nextLine == -1 {
				return ""
			}
			trimmed = strings.TrimSpace(trimmed[nextLine+1:])
		case strings.HasPrefix(trimmed, "/*"):
			commentEnd := strings.Index(trimmed, "*/")
			if commentEnd == -1 {
				return ""
			}
			trimmed = strings.TrimSpace(trimmed[commentEnd+2:])
		default:
			return trimmed
		}
	}
	return trimmed
}

func isSensitiveAuditField(key string) bool {
	k := strings.ToLower(strings.TrimSpace(key))
	switch {
	case strings.Contains(k, "password"):
		return true
	case strings.Contains(k, "secret"):
		return true
	case strings.Contains(k, "token"):
		return true
	case strings.Contains(k, "api_key"):
		return true
	case strings.Contains(k, "authorization"):
		return true
	case strings.Contains(k, "cookie"):
		return true
	case strings.Contains(k, "webhook_url"):
		return true
	default:
		return false
	}
}

func sanitizeAuditPayload(route string, body []byte) map[string]any {
	if len(body) == 0 {
		return map[string]any{}
	}

	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return map[string]any{
			"raw_hash": hashedValue(string(body)),
			"size":     len(body),
		}
	}

	if route == "/api/sql" {
		query, _ := parsed["query"].(string)
		return map[string]any{
			"query_hash":     hashedValue(query),
			"query_size":     len(query),
			"statement_kind": sqlStatementKind(query),
		}
	}

	return sanitizeAuditMap(parsed)
}

func sanitizeAuditMap(raw map[string]any) map[string]any {
	out := make(map[string]any, len(raw))
	for key, value := range raw {
		if isSensitiveAuditField(key) {
			out[key] = "<redacted>"
			continue
		}
		out[key] = sanitizeAuditValue(value)
	}
	return out
}

func sanitizeAuditValue(value any) any {
	switch v := value.(type) {
	case map[string]any:
		return sanitizeAuditMap(v)
	case []any:
		out := make([]any, 0, len(v))
		for _, item := range v {
			out = append(out, sanitizeAuditValue(item))
		}
		return out
	default:
		return v
	}
}

// AdminAuditMiddleware writes uniform traceability records for privileged operations.
func AdminAuditMiddleware(h *Handler) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			req := c.Request()
			if req == nil || !strings.HasPrefix(strings.ToLower(req.URL.Path), "/api/") {
				return next(c)
			}

			body := captureAuditBody(c)
			started := time.Now().UTC()
			err := next(c)
			finished := time.Now().UTC()

			method := strings.ToUpper(strings.TrimSpace(req.Method))
			route := strings.TrimSpace(c.Path())
			if route == "" {
				route = strings.TrimSpace(req.URL.Path)
			}

			desc, shouldAudit := lookupAdminAuditDescriptor(method, route, strings.TrimSpace(req.URL.Path))
			if !shouldAudit {
				return err
			}

			status := c.Response().Status
			success := status >= http.StatusOK && status < http.StatusBadRequest
			requestID := RequestIDFromContext(c)

			actorRole, _ := c.Get("role").(string)
			actorRole = strings.TrimSpace(actorRole)
			if actorRole == "" {
				actorRole = "anonymous"
			}

			metadata := map[string]any{
				"raw_query": req.URL.RawQuery,
			}
			if len(body) > 0 {
				metadata["payload"] = sanitizeAuditPayload(route, body)
			}

			target := ""
			if desc.TargetParam != "" {
				target = strings.TrimSpace(c.Param(desc.TargetParam))
			}

			event := data.AdminAuditEvent{
				RequestID:  requestID,
				Action:     desc.Action,
				Target:     target,
				ActorUser:  actorIDFromAuditContext(c),
				ActorRole:  actorRole,
				Workspace:  workspaceIDFromAuditContext(c),
				Method:     method,
				Path:       strings.TrimSpace(req.URL.Path),
				Route:      route,
				Status:     status,
				Success:    success,
				DurationMS: finished.Sub(started).Milliseconds(),
				SourceIP:   c.RealIP(),
				UserAgent:  strings.TrimSpace(req.UserAgent()),
				Metadata:   metadata,
				CreatedAt:  finished,
			}

			insertCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_ = h.DB.InsertAdminAuditEvent(insertCtx, event)
			return err
		}
	}
}

// ListAdminAuditEvents handles GET /api/project/security/admin-audit
func (h *Handler) ListAdminAuditEvents(c echo.Context) error {
	limit := 100
	if raw := strings.TrimSpace(c.QueryParam("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 500 {
		limit = 500
	}

	actionFilter := strings.TrimSpace(c.QueryParam("action"))
	successFilterRaw := strings.TrimSpace(c.QueryParam("success"))

	query := `
		SELECT id::text, request_id, action, COALESCE(target, ''), COALESCE(actor_user_id::text, ''), actor_role,
		       COALESCE(workspace_id::text, ''), method, path, route, status, success, duration_ms,
		       COALESCE(source_ip, ''), COALESCE(user_agent, ''), metadata, created_at
		FROM _v_admin_audit_events
		WHERE 1=1
	`
	args := make([]any, 0, 4)
	argPos := 1
	if actionFilter != "" {
		query += " AND action = $" + strconv.Itoa(argPos)
		args = append(args, actionFilter)
		argPos++
	}
	if successFilterRaw != "" {
		successFilter := strings.EqualFold(successFilterRaw, "true")
		query += " AND success = $" + strconv.Itoa(argPos)
		args = append(args, successFilter)
		argPos++
	}
	query += " ORDER BY created_at DESC LIMIT $" + strconv.Itoa(argPos)
	args = append(args, limit)

	rows, err := h.DB.Pool.Query(c.Request().Context(), query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "failed to load admin audit events",
		})
	}
	defer rows.Close()

	events := make([]map[string]any, 0, limit)
	for rows.Next() {
		var (
			id, requestID, action, target, actorUserID, actorRole string
			workspaceID, method, path, route                      string
			status                                                int
			success                                               bool
			durationMS                                            int64
			sourceIP, userAgent                                   string
			metadataRaw                                           []byte
			createdAt                                             time.Time
		)
		if scanErr := rows.Scan(
			&id, &requestID, &action, &target, &actorUserID, &actorRole, &workspaceID, &method, &path, &route,
			&status, &success, &durationMS, &sourceIP, &userAgent, &metadataRaw, &createdAt,
		); scanErr != nil {
			continue
		}
		metadata := map[string]any{}
		_ = json.Unmarshal(metadataRaw, &metadata)

		events = append(events, map[string]any{
			"id":            id,
			"request_id":    requestID,
			"action":        action,
			"target":        target,
			"actor_user_id": actorUserID,
			"actor_role":    actorRole,
			"workspace_id":  workspaceID,
			"method":        method,
			"path":          path,
			"route":         route,
			"status":        status,
			"success":       success,
			"duration_ms":   durationMS,
			"source_ip":     sourceIP,
			"user_agent":    userAgent,
			"metadata":      metadata,
			"created_at":    createdAt,
		})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"items": events,
		"count": len(events),
	})
}
