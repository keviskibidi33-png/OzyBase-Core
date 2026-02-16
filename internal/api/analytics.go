package api

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

// AnalyticsHandler handles high-performance analytics queries
type AnalyticsHandler struct {
	Handler *Handler
}

// GetTrafficStats returns aggregated traffic data (requests per minute/hour)
// This leverages PostgreSQL's speed instead of JS client-side processing
func (h *Handler) GetTrafficStats(c echo.Context) error {
	ctx := c.Request().Context()

	// 1. Calculate Request Rate (Last 24h, grouped by hour)
	// Using PostgreSQL's date_trunc for high efficient grouping
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT
			date_trunc('hour', created_at) as bucket,
			COUNT(*) as count,
			AVG(latency_ms) as avg_latency,
			COUNT(*) FILTER (WHERE status >= 400) as errors
		FROM _v_audit_logs
		WHERE created_at > NOW() - INTERVAL '24 hours'
		GROUP BY bucket
		ORDER BY bucket ASC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type TimePoint struct {
		Time       time.Time `json:"time"`
		Requests   int       `json:"requests"`
		AvgLatency float64   `json:"avg_latency"`
		Errors     int       `json:"errors"`
	}
	var stats []TimePoint

	for rows.Next() {
		var t TimePoint
		var latency sql.NullFloat64
		if err := rows.Scan(&t.Time, &t.Requests, &latency, &t.Errors); err == nil {
			t.AvgLatency = latency.Float64
			stats = append(stats, t)
		}
	}

	return c.JSON(http.StatusOK, stats)
}

// GetGeoStats returns traffic distribution by country
func (h *Handler) GetGeoStats(c echo.Context) error {
	ctx := c.Request().Context()

	rows, err := h.DB.Pool.Query(ctx, `
		SELECT
			country,
			COUNT(*) as count
		FROM _v_audit_logs
		WHERE created_at > NOW() - INTERVAL '7 days'
		AND country IS NOT NULL
		GROUP BY country
		ORDER BY count DESC
		LIMIT 10
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	type GeoPoint struct {
		Country string `json:"country"`
		Count   int    `json:"count"`
	}
	var geoStats []GeoPoint

	for rows.Next() {
		var g GeoPoint
		if err := rows.Scan(&g.Country, &g.Count); err == nil {
			geoStats = append(geoStats, g)
		}
	}

	return c.JSON(http.StatusOK, geoStats)
}
