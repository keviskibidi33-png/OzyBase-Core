package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/labstack/echo/v4"
)

const (
	defaultSLOWindowMinutes       = 60
	defaultSLOAvailabilityTarget  = 99.90
	defaultSLOErrorRateMaxPct     = 1.00
	defaultSLOLatencyP95MaxMS     = 300.0
	defaultSLOMinRequests         = 25
	defaultOnCallEscalationMinute = 15
)

type SLOThresholds struct {
	WindowMinutes        int     `json:"window_minutes"`
	AvailabilityTarget   float64 `json:"availability_target_pct"`
	ErrorRateMaxPct      float64 `json:"error_rate_max_pct"`
	LatencyP95MaxMS      float64 `json:"latency_p95_max_ms"`
	MinRequestsForSignal int64   `json:"min_requests_for_signal"`
}

type SLOIndicator struct {
	Name       string  `json:"name"`
	Objective  float64 `json:"objective"`
	Current    float64 `json:"current"`
	Unit       string  `json:"unit"`
	Comparator string  `json:"comparator"`
	Status     string  `json:"status"`
	Breached   bool    `json:"breached"`
}

type SLOEvaluation struct {
	Status              string        `json:"status"`
	Severity            string        `json:"severity"`
	Breached            bool          `json:"breached"`
	EvaluatedAt         time.Time     `json:"evaluated_at"`
	Thresholds          SLOThresholds `json:"thresholds"`
	WindowMinutes       int           `json:"window_minutes"`
	TotalRequests       int64         `json:"total_requests"`
	SuccessfulRequests  int64         `json:"successful_requests"`
	ServerErrorRequests int64         `json:"server_error_requests"`
	Availability        SLOIndicator  `json:"availability"`
	ErrorRate           SLOIndicator  `json:"error_rate"`
	LatencyP95          SLOIndicator  `json:"latency_p95"`
	Error               string        `json:"error,omitempty"`
}

type SLOHistoryPoint struct {
	ID              string    `json:"id"`
	RecordedAt      time.Time `json:"recorded_at"`
	WindowMinutes   int       `json:"window_minutes"`
	TotalRequests   int64     `json:"total_requests"`
	AvailabilityPct float64   `json:"availability_pct"`
	ErrorRatePct    float64   `json:"error_rate_pct"`
	LatencyP95MS    float64   `json:"latency_p95_ms"`
}

type OnCallRoutingConfig struct {
	Enabled           bool   `json:"enabled"`
	PrimaryContact    string `json:"primary_contact"`
	SecondaryContact  string `json:"secondary_contact"`
	EscalationMinutes int    `json:"escalation_minutes"`
	RunbookURL        string `json:"runbook_url"`
	Timezone          string `json:"timezone"`
}

type AlertRouteTarget struct {
	Channel string `json:"channel"`
	Target  string `json:"target"`
	Source  string `json:"source"`
}

type ActionableAlertRule struct {
	ID           string             `json:"id"`
	Name         string             `json:"name"`
	Severity     string             `json:"severity"`
	Breached     bool               `json:"breached"`
	Trigger      string             `json:"trigger"`
	Threshold    string             `json:"threshold"`
	CurrentValue string             `json:"current_value"`
	Routes       []AlertRouteTarget `json:"routes"`
	Actions      []string           `json:"actions"`
}

func loadSLOThresholdsFromEnv() SLOThresholds {
	return SLOThresholds{
		WindowMinutes:        parseEnvIntBounded("OZY_SLO_WINDOW_MINUTES", defaultSLOWindowMinutes, 5, 1440),
		AvailabilityTarget:   parseEnvFloatBounded("OZY_SLO_AVAILABILITY_TARGET_PCT", defaultSLOAvailabilityTarget, 90, 100),
		ErrorRateMaxPct:      parseEnvFloatBounded("OZY_SLO_ERROR_RATE_MAX_PCT", defaultSLOErrorRateMaxPct, 0, 100),
		LatencyP95MaxMS:      parseEnvFloatBounded("OZY_SLO_LATENCY_P95_MAX_MS", defaultSLOLatencyP95MaxMS, 10, 60000),
		MinRequestsForSignal: int64(parseEnvIntBounded("OZY_SLO_MIN_REQUESTS", defaultSLOMinRequests, 1, 1000000)),
	}
}

func parseEnvIntBounded(key string, fallback, minVal, maxVal int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	if parsed < minVal {
		return minVal
	}
	if parsed > maxVal {
		return maxVal
	}
	return parsed
}

func parseEnvFloatBounded(key string, fallback, minVal, maxVal float64) float64 {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return fallback
	}
	if parsed < minVal {
		return minVal
	}
	if parsed > maxVal {
		return maxVal
	}
	return parsed
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func newSLOIndicator(name string, objective float64, current float64, unit string, comparator string, breached bool, sufficient bool) SLOIndicator {
	status := "pass"
	if !sufficient {
		status = "insufficient_data"
	} else if breached {
		status = "fail"
	}
	return SLOIndicator{
		Name:       name,
		Objective:  round2(objective),
		Current:    round2(current),
		Unit:       unit,
		Comparator: comparator,
		Status:     status,
		Breached:   sufficient && breached,
	}
}

func buildSLOEvaluation(thresholds SLOThresholds, totalRequests int64, successfulRequests int64, serverErrors int64, latencyP95 float64) SLOEvaluation {
	availability := 100.0
	errorRate := 0.0
	if totalRequests > 0 {
		availability = (float64(successfulRequests) / float64(totalRequests)) * 100
		errorRate = (float64(serverErrors) / float64(totalRequests)) * 100
	}

	sufficient := totalRequests >= thresholds.MinRequestsForSignal
	availabilityBreach := availability < thresholds.AvailabilityTarget
	errorRateBreach := errorRate > thresholds.ErrorRateMaxPct
	latencyBreach := latencyP95 > thresholds.LatencyP95MaxMS
	breached := sufficient && (availabilityBreach || errorRateBreach || latencyBreach)

	status := "pass"
	severity := "info"
	if !sufficient {
		status = "insufficient_data"
		severity = "warning"
	} else if breached {
		status = "breached"
		if availabilityBreach || errorRateBreach {
			severity = "critical"
		} else {
			severity = "warning"
		}
	}

	return SLOEvaluation{
		Status:              status,
		Severity:            severity,
		Breached:            breached,
		EvaluatedAt:         time.Now().UTC(),
		Thresholds:          thresholds,
		WindowMinutes:       thresholds.WindowMinutes,
		TotalRequests:       totalRequests,
		SuccessfulRequests:  successfulRequests,
		ServerErrorRequests: serverErrors,
		Availability:        newSLOIndicator("availability", thresholds.AvailabilityTarget, availability, "%", ">=", availabilityBreach, sufficient),
		ErrorRate:           newSLOIndicator("error_rate", thresholds.ErrorRateMaxPct, errorRate, "%", "<=", errorRateBreach, sufficient),
		LatencyP95:          newSLOIndicator("latency_p95", thresholds.LatencyP95MaxMS, latencyP95, "ms", "<=", latencyBreach, sufficient),
	}
}

func (h *Handler) evaluateServiceSLO(ctx context.Context, persistSnapshot bool) (SLOEvaluation, error) {
	if h == nil || h.DB == nil || h.DB.Pool == nil {
		return SLOEvaluation{}, fmt.Errorf("database pool not initialized")
	}
	thresholds := loadSLOThresholdsFromEnv()

	var totalRequests int64
	var successfulRequests int64
	var serverErrors int64
	var latencyP95 float64

	err := h.DB.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*)::bigint AS total_requests,
			COUNT(*) FILTER (WHERE status < 500)::bigint AS successful_requests,
			COUNT(*) FILTER (WHERE status >= 500)::bigint AS server_errors,
			COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::double precision AS latency_p95_ms
		FROM _v_audit_logs
		WHERE created_at > NOW() - ($1 * INTERVAL '1 minute')
		  AND path NOT LIKE '/api/project/logs%'
		  AND path NOT LIKE '/api/project/info%'
	`, thresholds.WindowMinutes).Scan(&totalRequests, &successfulRequests, &serverErrors, &latencyP95)
	if err != nil {
		return SLOEvaluation{}, err
	}

	eval := buildSLOEvaluation(thresholds, totalRequests, successfulRequests, serverErrors, latencyP95)
	if persistSnapshot {
		_ = h.persistSLOSnapshot(ctx, eval)
	}
	return eval, nil
}

func (h *Handler) persistSLOSnapshot(ctx context.Context, eval SLOEvaluation) error {
	thresholdsJSON, err := json.Marshal(eval.Thresholds)
	if err != nil {
		return err
	}
	breachesJSON, err := json.Marshal(map[string]any{
		"status":              eval.Status,
		"severity":            eval.Severity,
		"breached":            eval.Breached,
		"availability":        eval.Availability.Breached,
		"error_rate":          eval.ErrorRate.Breached,
		"latency_p95":         eval.LatencyP95.Breached,
		"insufficient_sample": eval.Status == "insufficient_data",
	})
	if err != nil {
		return err
	}

	_, err = h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_slo_history (
			window_minutes,
			total_requests,
			successful_requests,
			server_errors,
			availability_pct,
			error_rate_pct,
			latency_p95_ms,
			thresholds,
			breaches
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
	`,
		eval.WindowMinutes,
		eval.TotalRequests,
		eval.SuccessfulRequests,
		eval.ServerErrorRequests,
		eval.Availability.Current,
		eval.ErrorRate.Current,
		eval.LatencyP95.Current,
		string(thresholdsJSON),
		string(breachesJSON),
	)
	return err
}

func (h *Handler) getSLOHistory(ctx context.Context, limit int) ([]SLOHistoryPoint, error) {
	if limit < 1 {
		limit = 1
	}
	if limit > 365 {
		limit = 365
	}

	rows, err := h.DB.Pool.Query(ctx, `
		SELECT id::text, recorded_at, window_minutes, total_requests, availability_pct, error_rate_pct, latency_p95_ms
		FROM _v_slo_history
		ORDER BY recorded_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		if isUndefinedTableErr(err) {
			return []SLOHistoryPoint{}, nil
		}
		return nil, err
	}
	defer rows.Close()

	items := make([]SLOHistoryPoint, 0, limit)
	for rows.Next() {
		var item SLOHistoryPoint
		if scanErr := rows.Scan(
			&item.ID,
			&item.RecordedAt,
			&item.WindowMinutes,
			&item.TotalRequests,
			&item.AvailabilityPct,
			&item.ErrorRatePct,
			&item.LatencyP95MS,
		); scanErr != nil {
			continue
		}
		item.AvailabilityPct = round2(item.AvailabilityPct)
		item.ErrorRatePct = round2(item.ErrorRatePct)
		item.LatencyP95MS = round2(item.LatencyP95MS)
		items = append(items, item)
	}
	return items, nil
}

func isUndefinedTableErr(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42P01"
}

func (h *Handler) GetSLOStatus(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 6*time.Second)
	defer cancel()

	eval, err := h.evaluateServiceSLO(ctx, true)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "failed to evaluate SLO signals",
		})
	}

	limit := 30
	if raw := strings.TrimSpace(c.QueryParam("history_limit")); raw != "" {
		if parsed, parseErr := strconv.Atoi(raw); parseErr == nil {
			limit = parsed
		}
	}
	history, historyErr := h.getSLOHistory(ctx, limit)
	if historyErr != nil {
		history = []SLOHistoryPoint{}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"evaluation": eval,
		"history":    history,
	})
}

func defaultOnCallRoutingConfig() OnCallRoutingConfig {
	return OnCallRoutingConfig{
		Enabled:           true,
		EscalationMinutes: defaultOnCallEscalationMinute,
		Timezone:          "UTC",
	}
}

func normalizeOnCallRoutingConfig(cfg OnCallRoutingConfig) OnCallRoutingConfig {
	cfg.PrimaryContact = strings.TrimSpace(cfg.PrimaryContact)
	cfg.SecondaryContact = strings.TrimSpace(cfg.SecondaryContact)
	cfg.RunbookURL = strings.TrimSpace(cfg.RunbookURL)
	cfg.Timezone = strings.TrimSpace(cfg.Timezone)
	if cfg.Timezone == "" {
		cfg.Timezone = "UTC"
	}
	if cfg.EscalationMinutes < 1 {
		cfg.EscalationMinutes = defaultOnCallEscalationMinute
	}
	if cfg.EscalationMinutes > 240 {
		cfg.EscalationMinutes = 240
	}
	return cfg
}

func (h *Handler) loadOnCallRoutingConfig(ctx context.Context) (OnCallRoutingConfig, error) {
	var configRaw []byte
	err := h.DB.Pool.QueryRow(ctx, `
		SELECT config
		FROM _v_security_policies
		WHERE type = 'on_call_routing'
	`).Scan(&configRaw)

	cfg := defaultOnCallRoutingConfig()
	if err != nil && err != pgx.ErrNoRows {
		return cfg, err
	}
	if err == nil && len(configRaw) > 0 {
		_ = json.Unmarshal(configRaw, &cfg)
		cfg = normalizeOnCallRoutingConfig(cfg)
	}

	if cfg.PrimaryContact == "" {
		_ = h.DB.Pool.QueryRow(ctx, `
			SELECT email
			FROM _v_security_notification_recipients
			WHERE is_active = true
			ORDER BY created_at ASC
			LIMIT 1
		`).Scan(&cfg.PrimaryContact)
		cfg.PrimaryContact = strings.TrimSpace(cfg.PrimaryContact)
	}

	return cfg, nil
}

func (h *Handler) collectAlertRouteTargets(ctx context.Context, cfg OnCallRoutingConfig) []AlertRouteTarget {
	out := make([]AlertRouteTarget, 0, 16)
	seen := map[string]struct{}{}
	appendRoute := func(channel, target, source string) {
		target = strings.TrimSpace(target)
		if target == "" {
			return
		}
		key := strings.ToLower(channel + ":" + target)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, AlertRouteTarget{
			Channel: channel,
			Target:  target,
			Source:  source,
		})
	}

	if cfg.Enabled {
		appendRoute("on_call", cfg.PrimaryContact, "on_call_primary")
		appendRoute("on_call", cfg.SecondaryContact, "on_call_secondary")
	}

	recipientsRows, err := h.DB.Pool.Query(ctx, `
		SELECT email
		FROM _v_security_notification_recipients
		WHERE is_active = true
		ORDER BY created_at ASC
	`)
	if err == nil {
		defer recipientsRows.Close()
		for recipientsRows.Next() {
			var email string
			if scanErr := recipientsRows.Scan(&email); scanErr == nil {
				appendRoute("email", email, "security_notifications")
			}
		}
	}

	integrationsRows, err := h.DB.Pool.Query(ctx, `
		SELECT type, name
		FROM _v_integrations
		WHERE is_active = true
		ORDER BY created_at ASC
	`)
	if err == nil {
		defer integrationsRows.Close()
		for integrationsRows.Next() {
			var integrationType string
			var integrationName string
			if scanErr := integrationsRows.Scan(&integrationType, &integrationName); scanErr != nil {
				continue
			}
			target := strings.TrimSpace(integrationName)
			if target == "" {
				target = strings.TrimSpace(integrationType)
			}
			appendRoute(strings.ToLower(strings.TrimSpace(integrationType)), target, "integrations")
		}
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Channel == out[j].Channel {
			return out[i].Target < out[j].Target
		}
		return out[i].Channel < out[j].Channel
	})
	return out
}

func prioritizeRoutes(routes []AlertRouteTarget, critical bool) []AlertRouteTarget {
	if len(routes) == 0 {
		return []AlertRouteTarget{}
	}
	priority := func(ch string) int {
		switch ch {
		case "on_call":
			return 0
		case "siem":
			return 1
		case "slack", "discord":
			return 2
		case "email":
			return 3
		default:
			return 4
		}
	}

	sorted := append([]AlertRouteTarget{}, routes...)
	sort.SliceStable(sorted, func(i, j int) bool {
		pi := priority(sorted[i].Channel)
		pj := priority(sorted[j].Channel)
		if pi == pj {
			return sorted[i].Target < sorted[j].Target
		}
		return pi < pj
	})

	maxRoutes := 6
	if !critical {
		maxRoutes = 4
	}
	if len(sorted) > maxRoutes {
		sorted = sorted[:maxRoutes]
	}
	return sorted
}

func formatPercent(v float64) string {
	return fmt.Sprintf("%.2f%%", round2(v))
}

func formatMillis(v float64) string {
	return fmt.Sprintf("%.2fms", round2(v))
}

func (h *Handler) buildActionableAlertRules(ctx context.Context, eval SLOEvaluation, routes []AlertRouteTarget) []ActionableAlertRule {
	criticalRoutes := prioritizeRoutes(routes, true)
	warningRoutes := prioritizeRoutes(routes, false)

	rules := make([]ActionableAlertRule, 0, 5)
	rules = append(rules, ActionableAlertRule{
		ID:   "slo_availability",
		Name: "Availability SLO",
		Severity: func() string {
			if eval.Availability.Breached {
				return "critical"
			}
			return "info"
		}(),
		Breached:     eval.Availability.Breached,
		Trigger:      fmt.Sprintf("Availability below target in last %d minutes", eval.WindowMinutes),
		Threshold:    fmt.Sprintf(">= %s", formatPercent(eval.Availability.Objective)),
		CurrentValue: formatPercent(eval.Availability.Current),
		Routes:       criticalRoutes,
		Actions: []string{
			"Acknowledge incident and notify on-call immediately.",
			"Validate /api/health and database connectivity before user impact grows.",
			"If breach persists beyond escalation window, execute rollback checklist.",
		},
	})
	rules = append(rules, ActionableAlertRule{
		ID:   "slo_latency_p95",
		Name: "Latency P95 SLO",
		Severity: func() string {
			if eval.LatencyP95.Breached {
				return "warning"
			}
			return "info"
		}(),
		Breached:     eval.LatencyP95.Breached,
		Trigger:      fmt.Sprintf("P95 latency above target in last %d minutes", eval.WindowMinutes),
		Threshold:    fmt.Sprintf("<= %s", formatMillis(eval.LatencyP95.Objective)),
		CurrentValue: formatMillis(eval.LatencyP95.Current),
		Routes:       warningRoutes,
		Actions: []string{
			"Inspect hot endpoints in Performance Advisor and check sequential scans.",
			"Apply index recommendations or rate-limit heavy clients.",
			"Monitor p95 every 5 minutes until returning below threshold.",
		},
	})
	rules = append(rules, ActionableAlertRule{
		ID:   "slo_error_rate",
		Name: "Error Rate SLO",
		Severity: func() string {
			if eval.ErrorRate.Breached {
				return "critical"
			}
			return "info"
		}(),
		Breached:     eval.ErrorRate.Breached,
		Trigger:      fmt.Sprintf("Server error rate above target in last %d minutes", eval.WindowMinutes),
		Threshold:    fmt.Sprintf("<= %s", formatPercent(eval.ErrorRate.Objective)),
		CurrentValue: formatPercent(eval.ErrorRate.Current),
		Routes:       criticalRoutes,
		Actions: []string{
			"Inspect failing endpoint classes in logs and recent deploy diff.",
			"Route traffic away from unhealthy path or rollback if needed.",
			"Open incident timeline and keep updates every 15 minutes.",
		},
	})

	var dlqCount int64
	_ = h.DB.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM _v_integration_deliveries WHERE status = 'dlq'`).Scan(&dlqCount)
	rules = append(rules, ActionableAlertRule{
		ID:   "integrations_dlq",
		Name: "Integration Delivery DLQ",
		Severity: func() string {
			if dlqCount > 0 {
				return "warning"
			}
			return "info"
		}(),
		Breached:     dlqCount > 0,
		Trigger:      "Failed alert deliveries exhausted retry policy",
		Threshold:    "DLQ backlog = 0",
		CurrentValue: fmt.Sprintf("%d items", dlqCount),
		Routes:       warningRoutes,
		Actions: []string{
			"Review /api/project/integrations/dlq and retry failed deliveries.",
			"Check webhook credentials and target endpoint availability.",
			"Adjust max_attempts/header config if recurrent transient failures continue.",
		},
	})

	var unresolvedAlerts int64
	_ = h.DB.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM _v_security_alerts WHERE is_resolved = false`).Scan(&unresolvedAlerts)
	rules = append(rules, ActionableAlertRule{
		ID:   "security_alert_backlog",
		Name: "Unresolved Security Alerts",
		Severity: func() string {
			if unresolvedAlerts > 0 {
				return "critical"
			}
			return "info"
		}(),
		Breached:     unresolvedAlerts > 0,
		Trigger:      "Pending security alerts awaiting operator response",
		Threshold:    "Unresolved alerts = 0",
		CurrentValue: fmt.Sprintf("%d alerts", unresolvedAlerts),
		Routes:       criticalRoutes,
		Actions: []string{
			"Review latest items in Security Alerts and classify blast radius.",
			"Apply firewall/session controls and contain suspicious sources.",
			"Close alert only after mitigation evidence is attached to runbook.",
		},
	})

	return rules
}

func (h *Handler) GetAlertRouting(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 6*time.Second)
	defer cancel()

	eval, evalErr := h.evaluateServiceSLO(ctx, false)
	if evalErr != nil {
		eval = SLOEvaluation{
			Status:      "unknown",
			Severity:    "warning",
			EvaluatedAt: time.Now().UTC(),
			Error:       evalErr.Error(),
			Thresholds:  loadSLOThresholdsFromEnv(),
		}
	}

	cfg, err := h.loadOnCallRoutingConfig(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "failed to load alert routing configuration",
		})
	}

	routes := h.collectAlertRouteTargets(ctx, cfg)
	rules := h.buildActionableAlertRules(ctx, eval, routes)
	warnings := make([]string, 0, 2)
	if len(routes) == 0 {
		warnings = append(warnings, "No active alert routes configured. Add notification recipients or integrations.")
	}
	if eval.Status == "insufficient_data" {
		warnings = append(warnings, "Insufficient request volume for strict SLO signal confidence.")
	}

	return c.JSON(http.StatusOK, map[string]any{
		"generated_at": time.Now().UTC(),
		"slo":          eval,
		"on_call":      cfg,
		"routes":       routes,
		"rules":        rules,
		"warnings":     warnings,
	})
}

func (h *Handler) UpdateAlertRouting(c echo.Context) error {
	var req OnCallRoutingConfig
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "invalid request body",
		})
	}
	cfg := normalizeOnCallRoutingConfig(req)
	if cfg.Enabled && cfg.PrimaryContact == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "primary_contact is required when on-call routing is enabled",
		})
	}
	if cfg.RunbookURL != "" {
		if parsed, err := url.ParseRequestURI(cfg.RunbookURL); err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "runbook_url must be a valid absolute URL",
			})
		}
	}

	cfgJSON, err := json.Marshal(cfg)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "failed to serialize on-call routing config",
		})
	}

	_, err = h.DB.Pool.Exec(c.Request().Context(), `
		INSERT INTO _v_security_policies (type, config, updated_at)
		VALUES ($1, $2::jsonb, NOW())
		ON CONFLICT (type)
		DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
	`, "on_call_routing", string(cfgJSON))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "failed to save on-call routing config",
		})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status":  "updated",
		"on_call": cfg,
	})
}
