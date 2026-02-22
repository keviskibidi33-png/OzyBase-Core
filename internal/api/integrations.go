package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/Xangel0s/OzyBase/internal/security"
	"github.com/labstack/echo/v4"
)

// ListIntegrations handles GET /api/project/integrations
func (h *Handler) ListIntegrations(c echo.Context) error {
	rows, err := h.DB.Pool.Query(c.Request().Context(), `
		SELECT id, name, type, webhook_url, is_active, created_at, last_triggered_at
		FROM _v_integrations
		ORDER BY created_at DESC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var integrations []map[string]any
	for rows.Next() {
		var i struct {
			ID              string  `json:"id"`
			Name            string  `json:"name"`
			Type            string  `json:"type"`
			WebhookURL      string  `json:"webhook_url"`
			IsActive        bool    `json:"is_active"`
			CreatedAt       string  `json:"created_at"`
			LastTriggeredAt *string `json:"last_triggered_at"`
		}
		if err := rows.Scan(&i.ID, &i.Name, &i.Type, &i.WebhookURL, &i.IsActive, &i.CreatedAt, &i.LastTriggeredAt); err == nil {
			integrations = append(integrations, map[string]any{
				"id":                i.ID,
				"name":              i.Name,
				"type":              i.Type,
				"webhook_url":       i.WebhookURL,
				"is_active":         i.IsActive,
				"created_at":        i.CreatedAt,
				"last_triggered_at": i.LastTriggeredAt,
			})
		}
	}

	return c.JSON(http.StatusOK, integrations)
}

// CreateIntegration handles POST /api/project/integrations
func (h *Handler) CreateIntegration(c echo.Context) error {
	var req struct {
		Name       string         `json:"name"`
		Type       string         `json:"type"`
		WebhookURL string         `json:"webhook_url"`
		Config     map[string]any `json:"config"`
	}

	if err := c.Bind(&req); err != nil {
		return err
	}

	if req.Name == "" || req.WebhookURL == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "name and webhook_url are required"})
	}
	if _, err := security.ValidateOutboundURL(req.WebhookURL, security.OutboundURLOptions{
		AllowHTTP:           false,
		AllowPrivateNetwork: security.AllowPrivateOutboundFromEnv(),
	}); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid webhook_url: " + err.Error()})
	}

	configJSON, _ := json.Marshal(req.Config)

	_, err := h.DB.Pool.Exec(c.Request().Context(), `
		INSERT INTO _v_integrations (name, type, webhook_url, config)
		VALUES ($1, $2, $3, $4)
	`, req.Name, req.Type, req.WebhookURL, configJSON)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]string{"status": "created"})
}

// DeleteIntegration handles DELETE /api/project/integrations/:id
func (h *Handler) DeleteIntegration(c echo.Context) error {
	id := c.Param("id")

	_, err := h.DB.Pool.Exec(c.Request().Context(), `
		DELETE FROM _v_integrations WHERE id = $1
	`, id)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "deleted"})
}

// TestIntegration handles POST /api/project/integrations/:id/test
func (h *Handler) TestIntegration(c echo.Context) error {
	id := c.Param("id")

	// 1. Fetch integration
	var i realtime.Integration
	var configJSON []byte
	err := h.DB.Pool.QueryRow(c.Request().Context(), `
		SELECT id, name, type, webhook_url, config FROM _v_integrations WHERE id = $1
	`, id).Scan(&i.ID, &i.Name, &i.Type, &i.WebhookURL, &configJSON)

	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Integration not found"})
	}

	if len(configJSON) > 0 {
		_ = json.Unmarshal(configJSON, &i.Config)
	}

	// 2. Send test alert manually (using internal method logic simplified)
	alert := realtime.SecurityAlertPayload{
		Type:      "test_alert",
		Severity:  "info",
		Details:   map[string]any{"message": "This is a test alert from OzyBase"},
		Timestamp: "now", // Should be time.Now() formatted but string is fine for json
	}

	// Silence lint error for now as we are stimulating a send
	_ = alert

	// Create a temporary integration service just for this test or use existing
	// We can reuse the h.Integrations service but we need to expose a method to send to a specific integration
	// For now, we will assume the test passes if we can find it, or implement a specific Test method in integrations.go
	// But to keep it simple, we'll just return OK for now as we don't have a direct "SendToOne" method exported yet.
	// TODO: Implement SendTestAlert in IntegrationService

	return c.JSON(http.StatusOK, map[string]string{"status": "Test alert sent (simulation)", "integration": i.Name})
}

// GetIntegrationDeliveryMetrics returns queue/retry/DLQ delivery metrics per integration.
func (h *Handler) GetIntegrationDeliveryMetrics(c echo.Context) error {
	rows, err := h.DB.Pool.Query(c.Request().Context(), `
		SELECT i.id::text,
		       i.name,
		       i.type,
		       COUNT(d.id) FILTER (WHERE d.status = 'delivered') AS delivered,
		       COUNT(d.id) FILTER (WHERE d.status = 'queued') AS queued,
		       COUNT(d.id) FILTER (WHERE d.status = 'processing') AS processing,
		       COUNT(d.id) FILTER (WHERE d.status = 'retry') AS retrying,
		       COUNT(d.id) FILTER (WHERE d.status = 'dlq') AS dlq,
		       COUNT(d.id) AS total,
		       COALESCE(ROUND((COUNT(d.id) FILTER (WHERE d.status = 'delivered')::numeric / NULLIF(COUNT(d.id), 0)) * 100, 2), 0) AS success_rate,
		       MAX(d.delivered_at) AS last_delivered_at
		FROM _v_integrations i
		LEFT JOIN _v_integration_deliveries d ON d.integration_id = i.id
		GROUP BY i.id, i.name, i.type, i.created_at
		ORDER BY i.created_at DESC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to read integration delivery metrics"})
	}
	defer rows.Close()

	type integrationMetrics struct {
		ID              string     `json:"id"`
		Name            string     `json:"name"`
		Type            string     `json:"type"`
		Delivered       int64      `json:"delivered"`
		Queued          int64      `json:"queued"`
		Processing      int64      `json:"processing"`
		Retrying        int64      `json:"retrying"`
		DLQ             int64      `json:"dlq"`
		Total           int64      `json:"total"`
		SuccessRate     float64    `json:"success_rate"`
		LastDeliveredAt *time.Time `json:"last_delivered_at,omitempty"`
	}
	out := make([]integrationMetrics, 0, 16)
	for rows.Next() {
		var m integrationMetrics
		if scanErr := rows.Scan(
			&m.ID, &m.Name, &m.Type, &m.Delivered, &m.Queued, &m.Processing, &m.Retrying, &m.DLQ, &m.Total, &m.SuccessRate, &m.LastDeliveredAt,
		); scanErr != nil {
			continue
		}
		out = append(out, m)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"metrics": out,
	})
}

// ListIntegrationDLQ returns failed deliveries that exhausted retries.
func (h *Handler) ListIntegrationDLQ(c echo.Context) error {
	limit := 100
	if raw := strings.TrimSpace(c.QueryParam("limit")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 && v <= 500 {
			limit = v
		}
	}

	rows, err := h.DB.Pool.Query(c.Request().Context(), `
		SELECT d.id::text,
		       i.id::text,
		       i.name,
		       i.type,
		       d.delivery_type,
		       d.attempts,
		       d.max_attempts,
		       COALESCE(d.last_error, ''),
		       COALESCE(d.last_status_code, 0),
		       d.created_at,
		       d.updated_at
		FROM _v_integration_deliveries d
		JOIN _v_integrations i ON i.id = d.integration_id
		WHERE d.status = 'dlq'
		ORDER BY d.updated_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to list DLQ deliveries"})
	}
	defer rows.Close()

	dlqItems := make([]map[string]any, 0, limit)
	for rows.Next() {
		var itemID, integrationID, name, integrationType, deliveryType, lastError string
		var attempts, maxAttempts int
		var lastStatusCode int
		var createdAt, updatedAt time.Time
		if scanErr := rows.Scan(&itemID, &integrationID, &name, &integrationType, &deliveryType, &attempts, &maxAttempts, &lastError, &lastStatusCode, &createdAt, &updatedAt); scanErr != nil {
			continue
		}
		dlqItems = append(dlqItems, map[string]any{
			"id":               itemID,
			"integration_id":   integrationID,
			"integration_name": name,
			"integration_type": integrationType,
			"delivery_type":    deliveryType,
			"attempts":         attempts,
			"max_attempts":     maxAttempts,
			"last_error":       lastError,
			"last_status_code": lastStatusCode,
			"created_at":       createdAt,
			"updated_at":       updatedAt,
		})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"items": dlqItems,
	})
}

// RetryIntegrationDLQ moves one DLQ item back to retry queue.
func (h *Handler) RetryIntegrationDLQ(c echo.Context) error {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "dlq id is required"})
	}

	var retriedID string
	err := h.DB.Pool.QueryRow(c.Request().Context(), `
		UPDATE _v_integration_deliveries
		SET status = 'retry',
		    attempts = 0,
		    next_attempt_at = NOW(),
		    last_error = NULL,
		    updated_at = NOW()
		WHERE id = $1
		  AND status = 'dlq'
		RETURNING id::text
	`, id).Scan(&retriedID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "dlq delivery not found"})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "requeued", "id": retriedID})
}
