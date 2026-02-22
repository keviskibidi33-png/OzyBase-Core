package realtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"time"

	"github.com/Xangel0s/OzyBase/internal/security"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type WebhookIntegration struct {
	pool *pgxpool.Pool
}

type IntegrationType string

const (
	IntegrationSlack   IntegrationType = "slack"
	IntegrationDiscord IntegrationType = "discord"
	IntegrationSIEM    IntegrationType = "siem"
	IntegrationCustom  IntegrationType = "custom"

	deliveryStatusQueued     = "queued"
	deliveryStatusProcessing = "processing"
	deliveryStatusRetry      = "retry"
	deliveryStatusDelivered  = "delivered"
	deliveryStatusDLQ        = "dlq"
)

type Integration struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Type       IntegrationType `json:"type"`
	WebhookURL string          `json:"webhook_url"`
	IsActive   bool            `json:"is_active"`
	Config     map[string]any  `json:"config,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
}

type SecurityAlertPayload struct {
	Type      string         `json:"type"`
	Severity  string         `json:"severity"`
	Details   map[string]any `json:"details"`
	Timestamp string         `json:"timestamp"`
}

type deliveryJob struct {
	ID           string
	Integration  Integration
	DeliveryType string
	Payload      json.RawMessage
	Headers      map[string]string
	Attempts     int
	MaxAttempts  int
}

func NewWebhookIntegration(pool *pgxpool.Pool) *WebhookIntegration {
	return &WebhookIntegration{pool: pool}
}

// StartDeliveryWorker processes queued integration deliveries with retry + DLQ semantics.
func (w *WebhookIntegration) StartDeliveryWorker(ctx context.Context) {
	if w == nil || w.pool == nil {
		return
	}

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := w.processPendingDeliveries(ctx, 20); err != nil {
				log.Printf("[integrations] delivery worker tick failed: %v", err)
			}
		}
	}
}

func (w *WebhookIntegration) processPendingDeliveries(ctx context.Context, batchSize int) error {
	if batchSize <= 0 {
		batchSize = 20
	}

	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, `
		SELECT d.id,
		       d.delivery_type,
		       d.payload,
		       d.headers,
		       d.attempts,
		       d.max_attempts,
		       i.id,
		       i.name,
		       i.type,
		       i.webhook_url,
		       i.config
		FROM _v_integration_deliveries d
		JOIN _v_integrations i ON i.id = d.integration_id
		WHERE d.status IN ($1, $2)
		  AND d.next_attempt_at <= NOW()
		  AND i.is_active = true
		ORDER BY d.next_attempt_at ASC
		LIMIT $3
		FOR UPDATE OF d SKIP LOCKED
	`, deliveryStatusQueued, deliveryStatusRetry, batchSize)
	if err != nil {
		return err
	}
	defer rows.Close()

	jobs := make([]deliveryJob, 0, batchSize)
	for rows.Next() {
		var j deliveryJob
		var configJSON []byte
		var headersJSON []byte
		err = rows.Scan(
			&j.ID,
			&j.DeliveryType,
			&j.Payload,
			&headersJSON,
			&j.Attempts,
			&j.MaxAttempts,
			&j.Integration.ID,
			&j.Integration.Name,
			&j.Integration.Type,
			&j.Integration.WebhookURL,
			&configJSON,
		)
		if err != nil {
			log.Printf("[integrations] malformed queued delivery row skipped: %v", err)
			continue
		}
		if len(configJSON) > 0 {
			_ = json.Unmarshal(configJSON, &j.Integration.Config)
		}
		if len(headersJSON) > 0 {
			_ = json.Unmarshal(headersJSON, &j.Headers)
		}
		if j.Headers == nil {
			j.Headers = map[string]string{}
		}
		jobs = append(jobs, j)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, j := range jobs {
		if _, err := tx.Exec(ctx, `
			UPDATE _v_integration_deliveries
			SET status = $2, updated_at = NOW()
			WHERE id = $1
		`, j.ID, deliveryStatusProcessing); err != nil {
			return err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	for _, j := range jobs {
		statusCode, err := w.deliverQueuedJob(ctx, j)
		nextAttempts := j.Attempts + 1
		if err == nil && statusCode < http.StatusBadRequest {
			if mErr := w.markDelivered(ctx, j.ID, nextAttempts, statusCode); mErr != nil {
				log.Printf("[integrations] failed to mark delivery success (job=%s): %v", j.ID, mErr)
			}
			continue
		}
		if mErr := w.markFailed(ctx, j, nextAttempts, statusCode, err); mErr != nil {
			log.Printf("[integrations] failed to mark delivery failure (job=%s): %v", j.ID, mErr)
		}
	}

	return nil
}

func (w *WebhookIntegration) deliverQueuedJob(ctx context.Context, job deliveryJob) (int, error) {
	if _, err := security.ValidateOutboundURL(job.Integration.WebhookURL, security.OutboundURLOptions{
		AllowHTTP:           false,
		AllowPrivateNetwork: security.AllowPrivateOutboundFromEnv(),
	}); err != nil {
		return 0, err
	}

	timeout := 15 * time.Second
	if job.DeliveryType == "siem_batch" {
		timeout = 30 * time.Second
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, job.Integration.WebhookURL, bytes.NewBuffer(job.Payload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range job.Headers {
		if k == "" || v == "" {
			continue
		}
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: timeout}
	// #nosec G704 -- URL was validated with security.ValidateOutboundURL above.
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if _, err := w.pool.Exec(ctx, `
		UPDATE _v_integrations
		SET last_triggered_at = NOW()
		WHERE id = $1
	`, job.Integration.ID); err != nil {
		log.Printf("[integrations] failed to update last_triggered_at (integration=%s): %v", job.Integration.ID, err)
	}

	if resp.StatusCode >= http.StatusBadRequest {
		return resp.StatusCode, fmt.Errorf("non-success status: %d", resp.StatusCode)
	}
	return resp.StatusCode, nil
}

func (w *WebhookIntegration) markDelivered(ctx context.Context, deliveryID string, attempts int, statusCode int) error {
	_, err := w.pool.Exec(ctx, `
		UPDATE _v_integration_deliveries
		SET status = $2,
		    attempts = $3,
		    last_status_code = $4,
		    delivered_at = NOW(),
		    updated_at = NOW()
		WHERE id = $1
	`, deliveryID, deliveryStatusDelivered, attempts, statusCode)
	return err
}

func (w *WebhookIntegration) markFailed(ctx context.Context, job deliveryJob, attempts int, statusCode int, deliveryErr error) error {
	maxAttempts := job.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = 5
	}

	status := deliveryStatusRetry
	nextAttempt := time.Now().UTC().Add(retryBackoffDelay(attempts))
	if attempts >= maxAttempts {
		status = deliveryStatusDLQ
		nextAttempt = time.Now().UTC()
	}

	lastError := ""
	if deliveryErr != nil {
		lastError = deliveryErr.Error()
	}
	_, err := w.pool.Exec(ctx, `
		UPDATE _v_integration_deliveries
		SET status = $2,
		    attempts = $3,
		    next_attempt_at = $4,
		    last_error = $5,
		    last_status_code = CASE WHEN $6 = 0 THEN NULL ELSE $6 END,
		    updated_at = NOW()
		WHERE id = $1
	`, job.ID, status, attempts, nextAttempt, lastError, statusCode)
	return err
}

func retryBackoffDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	seconds := 5 * math.Pow(2, float64(attempt-1))
	if seconds > 900 {
		seconds = 900
	}
	return time.Duration(seconds) * time.Second
}

func configHeaders(config map[string]any) map[string]string {
	headers := map[string]string{}
	raw, ok := config["headers"].(map[string]any)
	if !ok {
		return headers
	}
	for k, v := range raw {
		if k == "" {
			continue
		}
		if sv, ok := v.(string); ok && sv != "" {
			headers[k] = sv
		}
	}
	return headers
}

func configMaxAttempts(config map[string]any) int {
	if config == nil {
		return 5
	}
	switch v := config["max_attempts"].(type) {
	case float64:
		if int(v) >= 1 && int(v) <= 20 {
			return int(v)
		}
	case int:
		if v >= 1 && v <= 20 {
			return v
		}
	}
	return 5
}

func (w *WebhookIntegration) enqueueDelivery(ctx context.Context, integration Integration, deliveryType string, payload any) error {
	if w == nil || w.pool == nil {
		return nil
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	headersJSON, _ := json.Marshal(configHeaders(integration.Config))
	maxAttempts := configMaxAttempts(integration.Config)

	_, err = w.pool.Exec(ctx, `
		INSERT INTO _v_integration_deliveries (integration_id, delivery_type, payload, headers, max_attempts, status, next_attempt_at)
		VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, NOW())
	`, integration.ID, deliveryType, string(payloadJSON), string(headersJSON), maxAttempts, deliveryStatusQueued)
	return err
}

func (w *WebhookIntegration) listActiveIntegrations(ctx context.Context, onlySIEM bool) ([]Integration, error) {
	if w == nil || w.pool == nil {
		return nil, nil
	}

	query := `
		SELECT id, name, type, webhook_url, config
		FROM _v_integrations
		WHERE is_active = true
	`
	if onlySIEM {
		query += " AND type = 'siem'"
	} else {
		query += " AND type IN ('slack', 'discord', 'siem', 'custom')"
	}

	rows, err := w.pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Integration, 0, 8)
	for rows.Next() {
		var integration Integration
		var configJSON []byte
		if err := rows.Scan(&integration.ID, &integration.Name, &integration.Type, &integration.WebhookURL, &configJSON); err != nil {
			continue
		}
		if len(configJSON) > 0 {
			_ = json.Unmarshal(configJSON, &integration.Config)
		}
		out = append(out, integration)
	}
	return out, rows.Err()
}

// SendSecurityAlert enqueues alert deliveries to all active integrations.
func (w *WebhookIntegration) SendSecurityAlert(ctx context.Context, alert SecurityAlertPayload) error {
	if w == nil || w.pool == nil {
		log.Printf("[integrations] security alert skipped: integration provider unavailable (degraded mode)")
		return nil
	}
	integrations, err := w.listActiveIntegrations(ctx, false)
	if err != nil {
		log.Printf("[integrations] failed to list active integrations: %v (degraded mode, continuing)", err)
		return nil
	}
	if len(integrations) == 0 {
		log.Printf("[integrations] no active integrations configured; alert kept local only")
		return nil
	}

	for _, integration := range integrations {
		payload := any(alert)
		switch integration.Type {
		case IntegrationSlack:
			payload = w.formatSlackMessage(alert)
		case IntegrationDiscord:
			payload = w.formatDiscordMessage(alert)
		case IntegrationSIEM:
			payload = w.formatSIEMMessage(alert)
		}
		if err := w.enqueueDelivery(ctx, integration, "security_alert", payload); err != nil {
			log.Printf("[integrations] failed to enqueue security alert for %s: %v", integration.Name, err)
		}
	}
	return nil
}

func (w *WebhookIntegration) formatSlackMessage(alert SecurityAlertPayload) map[string]any {
	color := "danger"
	if alert.Severity == "warning" {
		color = "warning"
	}

	return map[string]any{
		"attachments": []map[string]any{
			{
				"color": color,
				"title": fmt.Sprintf("Security Alert: %s", alert.Type),
				"text":  fmt.Sprintf("Severity: *%s*", alert.Severity),
				"fields": []map[string]any{
					{
						"title": "Details",
						"value": formatDetails(alert.Details),
						"short": false,
					},
					{
						"title": "Timestamp",
						"value": alert.Timestamp,
						"short": true,
					},
				},
				"footer": "OzyBase Security System",
				"ts":     time.Now().Unix(),
			},
		},
	}
}

func (w *WebhookIntegration) formatDiscordMessage(alert SecurityAlertPayload) map[string]any {
	color := 15158332 // Red
	if alert.Severity == "warning" {
		color = 16776960 // Yellow
	}

	return map[string]any{
		"embeds": []map[string]any{
			{
				"title":       fmt.Sprintf("Security Alert: %s", alert.Type),
				"description": fmt.Sprintf("**Severity:** %s", alert.Severity),
				"color":       color,
				"fields": []map[string]any{
					{
						"name":   "Details",
						"value":  formatDetails(alert.Details),
						"inline": false,
					},
				},
				"footer": map[string]string{
					"text": "OzyBase Security System",
				},
				"timestamp": alert.Timestamp,
			},
		},
	}
}

func (w *WebhookIntegration) formatSIEMMessage(alert SecurityAlertPayload) map[string]any {
	return map[string]any{
		"event_type": "security_alert",
		"source":     "ozybase",
		"alert_type": alert.Type,
		"severity":   alert.Severity,
		"timestamp":  alert.Timestamp,
		"details":    alert.Details,
		"version":    "1.0",
	}
}

func formatDetails(details map[string]any) string {
	result := ""
	for key, value := range details {
		result += fmt.Sprintf("**%s:** %v\n", key, value)
	}
	return result
}

// SendLogBatch enqueues SIEM log batches for delivery worker processing.
func (w *WebhookIntegration) SendLogBatch(ctx context.Context, logs []map[string]any) error {
	if w == nil || w.pool == nil {
		log.Printf("[integrations] SIEM log batch skipped: integration provider unavailable (degraded mode)")
		return nil
	}
	integrations, err := w.listActiveIntegrations(ctx, true)
	if err != nil {
		log.Printf("[integrations] failed to list SIEM integrations: %v (degraded mode, continuing)", err)
		return nil
	}
	if len(integrations) == 0 {
		log.Printf("[integrations] no active SIEM integrations configured; batch retained locally")
		return nil
	}

	payload := map[string]any{
		"source":    "ozybase",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"logs":      logs,
		"count":     len(logs),
	}
	for _, integration := range integrations {
		if err := w.enqueueDelivery(ctx, integration, "siem_batch", payload); err != nil {
			log.Printf("[integrations] failed to enqueue SIEM batch for %s: %v", integration.Name, err)
		}
	}
	return nil
}
