// Package api provides HTTP handlers for the OzyBase Core.
package api

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"strconv"
	"sync"
	"time"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/mailer"
	"github.com/Xangel0s/OzyBase/internal/migrations"
	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/Xangel0s/OzyBase/internal/storage"
	"github.com/labstack/echo/v4"
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/mem"
)

var startTime = time.Now()

// LogEntry represents a single request log
type LogEntry struct {
	ID        string    `json:"id"`
	Time      string    `json:"time"`
	Method    string    `json:"method"`
	Path      string    `json:"path"`
	Status    int       `json:"status"`
	Latency   string    `json:"latency"`
	IP        string    `json:"ip"`
	Country   string    `json:"country,omitempty"`
	City      string    `json:"city,omitempty"`
	Timestamp time.Time `json:"timestamp"` // Exposed for frontend comparisons
}

// Metrics holds in-memory activity stats
type Metrics struct {
	sync.RWMutex
	DbRequests      int
	AuthRequests    int
	StorageRequests int
	DbHistory       []int
	AuthHistory     []int
	StorageHistory  []int
	RealtimeHistory []int
	CpuHistory      []float64
	RamHistory      []float64
}

// Handler holds dependencies for HTTP handlers
type Handler struct {
	DB           *data.DB
	Metrics      *Metrics
	Broker       *realtime.Broker
	Webhooks     *realtime.WebhookDispatcher
	Geo          *core.GeoService
	Mailer       mailer.Mailer
	Integrations *realtime.WebhookIntegration
	Auth         *core.AuthService
	Audit        *core.AuditService
	Storage      storage.Provider
	PubSub       realtime.PubSub
	Migrations   *migrations.Generator
	Applier      *migrations.Applier
	StartTime    time.Time

	projectInfoCacheMu    sync.RWMutex
	projectInfoCache      *ProjectInfo
	projectInfoCacheUntil time.Time

	healthIssuesCacheMu    sync.RWMutex
	healthIssuesCache      []HealthIssue
	healthIssuesCacheUntil time.Time

	siemFlushMu     sync.Mutex
	lastSIEMFlushAt time.Time
}

// NewHandler creates a new Handler with the given dependencies
func NewHandler(db *data.DB, broker *realtime.Broker, webhooks *realtime.WebhookDispatcher, mailSvc mailer.Mailer, storageSvc storage.Provider, ps realtime.PubSub, migrator *migrations.Generator, applier *migrations.Applier, audit *core.AuditService) *Handler {
	m := &Metrics{
		DbHistory:       make([]int, 60),
		AuthHistory:     make([]int, 60),
		StorageHistory:  make([]int, 60),
		RealtimeHistory: make([]int, 60),
		CpuHistory:      make([]float64, 60),
		RamHistory:      make([]float64, 60),
	}
	// Start background workers
	go m.rotateHistory(db)
	h := &Handler{
		DB:              db,
		Metrics:         m,
		Broker:          broker,
		Webhooks:        webhooks,
		Geo:             core.NewGeoService(db),
		Mailer:          mailSvc,
		Integrations:    realtime.NewWebhookIntegration(db.Pool),
		Audit:           audit,
		Storage:         storageSvc,
		PubSub:          ps,
		Migrations:      migrator,
		Applier:         applier,
		StartTime:       time.Now(),
		lastSIEMFlushAt: time.Now().UTC().Add(-30 * time.Second),
	}
	go h.StartLogCleaner(context.Background())

	return h
}

func (m *Metrics) rotateHistory(db *data.DB) {
	ticker := time.NewTicker(10 * time.Second)
	for range ticker.C {
		m.Lock()
		// Rotate all histories
		copy(m.DbHistory, m.DbHistory[1:])
		m.DbHistory[59] = m.DbRequests
		m.DbRequests = 0

		copy(m.AuthHistory, m.AuthHistory[1:])
		m.AuthHistory[59] = m.AuthRequests
		m.AuthRequests = 0

		copy(m.StorageHistory, m.StorageHistory[1:])
		m.StorageHistory[59] = m.StorageRequests
		m.StorageRequests = 0

		copy(m.RealtimeHistory, m.RealtimeHistory[1:])
		var active int
		if err := db.Pool.QueryRow(context.Background(), "SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active'").Scan(&active); err == nil {
			m.RealtimeHistory[59] = active
		}

		// System Stats
		copy(m.CpuHistory, m.CpuHistory[1:])
		if cpuPercentages, err := cpu.Percent(0, false); err == nil && len(cpuPercentages) > 0 {
			m.CpuHistory[59] = cpuPercentages[0]
		}

		copy(m.RamHistory, m.RamHistory[1:])
		if v, err := mem.VirtualMemory(); err == nil {
			m.RamHistory[59] = v.UsedPercent
		}

		m.Unlock()
	}
}

// StartLogCleaner removes logs older than 30 days every 24 hours
func (h *Handler) StartLogCleaner(ctx context.Context) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	// Run once at startup
	h.cleanOldLogs(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.cleanOldLogs(ctx)
		}
	}
}

func (h *Handler) cleanOldLogs(ctx context.Context) {
	// 30 days retention
	res, err := h.DB.Pool.Exec(ctx, "DELETE FROM _v_audit_logs WHERE created_at < NOW() - INTERVAL '30 days'")
	if err != nil {
		fmt.Printf("⚠️ [Log Cleaner] Failed to purge old logs: %v\n", err)
		return
	}
	count := res.RowsAffected()
	if count > 0 {
		fmt.Printf("🧹 [Log Cleaner] Purged %d logs older than 30 days\n", count)
	}
}

// StartLogExporter starts a background worker to flush logs to SIEM
func (h *Handler) StartLogExporter(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second) // Flush every 30s
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.flushLogsToSIEM(ctx)
		}
	}
}

func (h *Handler) flushLogsToSIEM(ctx context.Context) {
	if h == nil || h.Integrations == nil {
		return
	}

	h.siemFlushMu.Lock()
	from := h.lastSIEMFlushAt
	to := time.Now().UTC()
	h.lastSIEMFlushAt = to
	h.siemFlushMu.Unlock()

	rows, err := h.DB.Pool.Query(ctx, `
		SELECT id, method, path, status, latency_ms, ip_address, created_at
		FROM _v_audit_logs
		WHERE created_at > $1 AND created_at <= $2
		ORDER BY created_at ASC
		LIMIT 500
	`, from, to)
	if err != nil {
		fmt.Printf("⚠️ [SIEM Export] failed to query logs: %v\n", err)
		return
	}
	defer rows.Close()

	logs := make([]map[string]any, 0, 128)
	for rows.Next() {
		var id, method, path, ip string
		var status int
		var latency int64
		var createdAt time.Time
		if scanErr := rows.Scan(&id, &method, &path, &status, &latency, &ip, &createdAt); scanErr != nil {
			continue
		}
		logs = append(logs, map[string]any{
			"id":         id,
			"method":     method,
			"path":       path,
			"status":     status,
			"latency_ms": latency,
			"ip_address": ip,
			"created_at": createdAt.UTC().Format(time.RFC3339),
		})
	}
	if len(logs) == 0 {
		return
	}
	if err := h.Integrations.SendLogBatch(ctx, logs); err != nil {
		fmt.Printf("⚠️ [SIEM Export] failed to enqueue SIEM batch: %v\n", err)
	}
}

// HealthResponse represents the health check response
type HealthResponse struct {
	Status    string `json:"status"`
	Database  string `json:"database"`
	Timestamp string `json:"timestamp"`
	Uptime    string `json:"uptime"`
	SLO       struct {
		Database   HealthCheck `json:"database"`
		Migrations HealthCheck `json:"migrations"`
		Storage    HealthCheck `json:"storage"`
		KeyEvents  HealthCheck `json:"key_events"`
	} `json:"slo"`
	Memory struct {
		Alloc      uint64 `json:"alloc_mb"`
		TotalAlloc uint64 `json:"total_alloc_mb"`
		Sys        uint64 `json:"sys_mb"`
		NumGC      uint32 `json:"num_gc"`
	} `json:"memory"`
}

type HealthCheck struct {
	Status    string `json:"status"`
	LatencyMS int64  `json:"latency_ms"`
	Error     string `json:"error,omitempty"`
}

// Health handles GET /api/health
func (h *Handler) Health(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 4*time.Second)
	defer cancel()

	dbCheck := runHealthCheck(ctx, func(checkCtx context.Context) error {
		return h.DB.Health(checkCtx)
	})
	migrationsCheck := runHealthCheck(ctx, func(checkCtx context.Context) error {
		return h.checkMigrationsHealth(checkCtx)
	})
	storageCheck := runHealthCheck(ctx, func(checkCtx context.Context) error {
		return h.checkStorageHealth(checkCtx)
	})
	keyEventsCheck := runHealthCheck(ctx, func(checkCtx context.Context) error {
		return h.checkAPIKeyEventsHealth(checkCtx)
	})

	dbStatus := "connected"
	if dbCheck.Status != "ok" {
		dbStatus = "disconnected"
	}

	status := "ok"
	if dbCheck.Status != "ok" || migrationsCheck.Status != "ok" || storageCheck.Status != "ok" || keyEventsCheck.Status != "ok" {
		status = "degraded"
	}

	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	resp := HealthResponse{
		Status:    status,
		Database:  dbStatus,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Uptime:    time.Since(startTime).String(),
	}
	resp.SLO.Database = dbCheck
	resp.SLO.Migrations = migrationsCheck
	resp.SLO.Storage = storageCheck
	resp.SLO.KeyEvents = keyEventsCheck
	resp.Memory.Alloc = m.Alloc / 1024 / 1024
	resp.Memory.TotalAlloc = m.TotalAlloc / 1024 / 1024
	resp.Memory.Sys = m.Sys / 1024 / 1024
	resp.Memory.NumGC = m.NumGC

	return c.JSON(http.StatusOK, resp)
}

func runHealthCheck(ctx context.Context, fn func(context.Context) error) HealthCheck {
	start := time.Now()
	err := fn(ctx)
	check := HealthCheck{
		Status:    "ok",
		LatencyMS: time.Since(start).Milliseconds(),
	}
	if err != nil {
		check.Status = "fail"
		check.Error = err.Error()
	}
	return check
}

func (h *Handler) checkMigrationsHealth(ctx context.Context) error {
	var exists bool
	if err := h.DB.Pool.QueryRow(ctx, "SELECT to_regclass('public._v_migrations_history') IS NOT NULL").Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("migrations table is missing")
	}

	var count int
	return h.DB.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM _v_migrations_history").Scan(&count)
}

func (h *Handler) checkAPIKeyEventsHealth(ctx context.Context) error {
	var exists bool
	if err := h.DB.Pool.QueryRow(ctx, "SELECT to_regclass('public._v_api_key_events') IS NOT NULL").Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("api key events table is missing")
	}

	var count int
	return h.DB.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM _v_api_key_events").Scan(&count)
}

func (h *Handler) checkStorageHealth(ctx context.Context) error {
	if h.Storage == nil {
		return fmt.Errorf("storage provider is not configured")
	}
	return h.Storage.Health(ctx)
}

// GetStats handles GET /api/project/stats
func (h *Handler) GetStats(c echo.Context) error {
	h.Metrics.RLock()
	defer h.Metrics.RUnlock()

	return c.JSON(http.StatusOK, map[string]any{
		"db":       h.Metrics.DbHistory,
		"auth":     h.Metrics.AuthHistory,
		"storage":  h.Metrics.StorageHistory,
		"realtime": h.Metrics.RealtimeHistory,
		"cpu":      h.Metrics.CpuHistory,
		"ram":      h.Metrics.RamHistory,
		"summary": map[string]int{
			"db":      h.Metrics.DbRequests,
			"auth":    h.Metrics.AuthRequests,
			"storage": h.Metrics.StorageRequests,
		},
	})
}

// GetLogs handles GET /api/project/logs
// Supports ?source=memory for real-time live tail (in-memory buffer)
// Defaults to database source for historical explorer view
func (h *Handler) GetLogs(c echo.Context) error {
	limitStr := c.QueryParam("limit")
	limit := 100
	if limitStr != "" {
		if val, err := strconv.Atoi(limitStr); err == nil {
			limit = val
		}
	}

	statusFilter := c.QueryParam("status")

	// Always use database for reliability
	// DB is indexed and fast enough for dashboard usage

	// Database source: canonical, persistent, for explorer/history
	query := `SELECT id, created_at, method, path, status, latency_ms, ip_address, country, city FROM _v_audit_logs `
	var params []any

	switch statusFilter {
	case "success":
		query += `WHERE status < 400 `
	case "error":
		query += `WHERE status >= 400 `
	}

	query += `ORDER BY created_at DESC LIMIT $1`
	params = append(params, limit)

	rows, err := h.DB.Pool.Query(c.Request().Context(), query, params...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var logs []LogEntry
	for rows.Next() {
		var l LogEntry
		var createdAt time.Time
		var latencyMs int64
		if err := rows.Scan(&l.ID, &createdAt, &l.Method, &l.Path, &l.Status, &latencyMs, &l.IP, &l.Country, &l.City); err == nil {
			l.Timestamp = createdAt.UTC()
			l.Time = createdAt.UTC().Format("15:04:05")
			l.Latency = fmt.Sprintf("%dms", latencyMs)
			logs = append(logs, l)
		}
	}

	if logs == nil {
		logs = []LogEntry{}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"logs":        logs,
		"server_time": time.Now().UTC(),
	})
}

// ExportLogs handles GET /api/project/logs/export
func (h *Handler) ExportLogs(c echo.Context) error {
	ctx := c.Request().Context()

	// Fetch last 1000 logs for export
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT created_at, method, path, status, latency_ms, ip_address, country, city, user_agent 
		FROM _v_audit_logs 
		ORDER BY created_at DESC 
		LIMIT 1000
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)

	// Write header
	_ = writer.Write([]string{"Timestamp", "Method", "Path", "Status", "Latency", "IP", "Country", "City", "UserAgent"})

	for rows.Next() {
		var createdAt time.Time
		var method, path, ip, country, city, userAgent string
		var status int
		var latency int64
		if err := rows.Scan(&createdAt, &method, &path, &status, &latency, &ip, &country, &city, &userAgent); err == nil {
			_ = writer.Write([]string{
				createdAt.Format(time.RFC3339),
				method,
				path,
				strconv.Itoa(status),
				fmt.Sprintf("%dms", latency),
				ip,
				country,
				city,
				userAgent,
			})
		}
	}
	writer.Flush()

	c.Response().Header().Set(echo.HeaderContentDisposition, "attachment; filename=ozy_logs_export.csv")
	return c.Blob(http.StatusOK, "text/csv", buf.Bytes())
}

// GetSecurityPolicies handles GET /api/project/security/policies
func (h *Handler) GetSecurityPolicies(c echo.Context) error {
	rows, err := h.DB.Pool.Query(c.Request().Context(), "SELECT type, config FROM _v_security_policies")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	policies := make(map[string]any)
	for rows.Next() {
		var pType string
		var config []byte
		if err := rows.Scan(&pType, &config); err == nil {
			var configMap any
			_ = json.Unmarshal(config, &configMap)
			policies[pType] = configMap
		}
	}

	// Default geo_fencing if not exists
	if _, ok := policies["geo_fencing"]; !ok {
		policies["geo_fencing"] = map[string]any{
			"enabled":           false,
			"allowed_countries": []string{},
		}
	}

	return c.JSON(http.StatusOK, policies)
}

// UpdateSecurityPolicy handles POST /api/project/security/policies
func (h *Handler) UpdateSecurityPolicy(c echo.Context) error {
	var req struct {
		Type   string         `json:"type"`
		Config map[string]any `json:"config"`
	}

	if err := c.Bind(&req); err != nil {
		return err
	}

	configJSON, _ := json.Marshal(req.Config)

	_, err := h.DB.Pool.Exec(c.Request().Context(), `
		INSERT INTO _v_security_policies (type, config, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (type) DO UPDATE SET config = $2, updated_at = NOW()
	`, req.Type, configJSON)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Invalidate cache if it's geo_fencing
	if req.Type == "geo_fencing" {
		h.Geo.InvalidatePolicy()
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "updated"})
}

// SecurityStats represents data for the security dashboard
type SecurityStats struct {
	TotalChecks     int64           `json:"total_checks"`
	AllowedRequests int64           `json:"allowed_requests"`
	BlockedRequests int64           `json:"blocked_requests"`
	TopCountries    []GeoStat       `json:"top_countries"`
	TopIPs          []IPStat        `json:"top_ips"`
	AlertsTimeline  []TimelineEvent `json:"alerts_timeline"`
	TotalBreaches   int64           `json:"total_breaches"`
	LastBreachAt    string          `json:"last_breach_at"`
}

type GeoStat struct {
	Country string `json:"country"`
	Count   int64  `json:"count"`
}

type IPStat struct {
	IP    string `json:"ip"`
	Count int64  `json:"count"`
}

type TimelineEvent struct {
	Time  string `json:"time"`
	Count int64  `json:"count"`
}

// GetSecurityStats handles GET /api/project/security/stats
func (h *Handler) GetSecurityStats(c echo.Context) error {
	ctx := c.Request().Context()
	var stats SecurityStats

	// 1. Total Checks
	_ = h.DB.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM _v_audit_logs").Scan(&stats.TotalChecks)

	// 2. Blocked vs Allowed (Rough estimate from alerts)
	_ = h.DB.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM _v_security_alerts").Scan(&stats.BlockedRequests)
	stats.AllowedRequests = stats.TotalChecks - stats.BlockedRequests
	stats.TotalBreaches = stats.BlockedRequests

	// 3. Top Countries
	rows, _ := h.DB.Pool.Query(ctx, `
		SELECT country, COUNT(*) as count
		FROM _v_audit_logs
		WHERE country != 'Localhost' AND country != 'Internal'
		GROUP BY country
		ORDER BY count DESC
		LIMIT 5
	`)
	for rows.Next() {
		var g GeoStat
		if err := rows.Scan(&g.Country, &g.Count); err == nil {
			stats.TopCountries = append(stats.TopCountries, g)
		}
	}
	rows.Close()

	// 4. Top IPs
	rows, _ = h.DB.Pool.Query(ctx, `
		SELECT ip_address, COUNT(*) as count
		FROM _v_audit_logs
		GROUP BY ip_address
		ORDER BY count DESC
		LIMIT 5
	`)
	for rows.Next() {
		var i IPStat
		if err := rows.Scan(&i.IP, &i.Count); err == nil {
			stats.TopIPs = append(stats.TopIPs, i)
		}
	}
	rows.Close()

	// 5. Timeline (Last 24 hours of alerts)
	rows, _ = h.DB.Pool.Query(ctx, `
		SELECT TO_CHAR(created_at, 'HH24:00') as hour, COUNT(*)
		FROM _v_security_alerts
		WHERE created_at > NOW() - INTERVAL '24 hours'
		GROUP BY hour
		ORDER BY hour ASC
	`)
	for rows.Next() {
		var t TimelineEvent
		if err := rows.Scan(&t.Time, &t.Count); err == nil {
			stats.AlertsTimeline = append(stats.AlertsTimeline, t)
		}
	}
	rows.Close()

	// 6. Last Breach
	_ = h.DB.Pool.QueryRow(ctx, "SELECT created_at FROM _v_security_alerts ORDER BY created_at DESC LIMIT 1").Scan(&stats.LastBreachAt)

	return c.JSON(http.StatusOK, stats)
}

// GetSecurityAlerts handles GET /api/project/security/alerts
func (h *Handler) GetSecurityAlerts(c echo.Context) error {
	rows, err := h.DB.Pool.Query(c.Request().Context(), `
		SELECT id, created_at, type, severity, message, metadata
		FROM _v_security_alerts
		ORDER BY created_at DESC
		LIMIT 100
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var alerts []map[string]any
	for rows.Next() {
		var id, aType, severity, message string
		var createdAt time.Time
		var metadata []byte
		if err := rows.Scan(&id, &createdAt, &aType, &severity, &message, &metadata); err == nil {
			var metaMap any
			_ = json.Unmarshal(metadata, &metaMap)
			alerts = append(alerts, map[string]any{
				"id":         id,
				"time":       createdAt.Format("15:04:05"),
				"type":       aType,
				"severity":   severity,
				"message":    message,
				"metadata":   metaMap,
				"created_at": createdAt,
			})
		}
	}

	if alerts == nil {
		alerts = []map[string]any{}
	}

	return c.JSON(http.StatusOK, alerts)
}

// GetNotificationRecipients handles GET /api/project/security/notifications
func (h *Handler) GetNotificationRecipients(c echo.Context) error {
	rows, err := h.DB.Pool.Query(c.Request().Context(), `
		SELECT id, email, alert_types, is_active, created_at
		FROM _v_security_notification_recipients
		ORDER BY created_at DESC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type Recipient struct {
		ID         string   `json:"id"`
		Email      string   `json:"email"`
		AlertTypes []string `json:"alert_types"`
		IsActive   bool     `json:"is_active"`
		CreatedAt  string   `json:"created_at"`
	}

	var recipients []Recipient
	for rows.Next() {
		var r Recipient
		if err := rows.Scan(&r.ID, &r.Email, &r.AlertTypes, &r.IsActive, &r.CreatedAt); err == nil {
			recipients = append(recipients, r)
		}
	}

	return c.JSON(http.StatusOK, recipients)
}

// AddNotificationRecipient handles POST /api/project/security/notifications
func (h *Handler) AddNotificationRecipient(c echo.Context) error {
	var req struct {
		Email      string   `json:"email"`
		AlertTypes []string `json:"alert_types"`
	}

	if err := c.Bind(&req); err != nil {
		return err
	}

	if req.Email == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "email is required"})
	}

	_, err := h.DB.Pool.Exec(c.Request().Context(), `
		INSERT INTO _v_security_notification_recipients (email, alert_types)
		VALUES ($1, $2)
	`, req.Email, req.AlertTypes)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]string{"status": "created"})
}

// DeleteNotificationRecipient handles DELETE /api/project/security/notifications/:id
func (h *Handler) DeleteNotificationRecipient(c echo.Context) error {
	id := c.Param("id")

	_, err := h.DB.Pool.Exec(c.Request().Context(), `
		DELETE FROM _v_security_notification_recipients WHERE id = $1
	`, id)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "deleted"})
}

// Forced update
