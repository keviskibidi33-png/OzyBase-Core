package api

import (
	"fmt"
	"net/http"
	"runtime"
	"time"

	"github.com/labstack/echo/v4"
)

// GetPrometheusMetrics returns Go runtime statistics in Prometheus format
func (h *Handler) GetPrometheusMetrics(c echo.Context) error {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	// Build Prometheus payload
	metrics := ""

	// Memory Metrics
	metrics += "# HELP ozy_mem_alloc_bytes Number of bytes allocated and still in use\n"
	metrics += "# TYPE ozy_mem_alloc_bytes gauge\n"
	metrics += fmt.Sprintf("ozy_mem_alloc_bytes %d\n", m.Alloc)

	metrics += "# HELP ozy_mem_sys_bytes Total bytes of memory obtained from the OS\n"
	metrics += "# TYPE ozy_mem_sys_bytes gauge\n"
	metrics += fmt.Sprintf("ozy_mem_sys_bytes %d\n", m.Sys)

	metrics += "# HELP ozy_mem_heap_objects Number of allocated heap objects\n"
	metrics += "# TYPE ozy_mem_heap_objects gauge\n"
	metrics += fmt.Sprintf("ozy_mem_heap_objects %d\n", m.HeapObjects)

	// Runtime Metrics
	metrics += "# HELP ozy_goroutines_count Number of goroutines that currently exist\n"
	metrics += "# TYPE ozy_goroutines_count gauge\n"
	metrics += fmt.Sprintf("ozy_goroutines_count %d\n", runtime.NumGoroutine())

	// Project specific metrics (from cache)
	rows, err := h.DB.Pool.Query(c.Request().Context(), "SELECT id, value FROM _v_metrics_cache")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id string
			var val float64
			if err := rows.Scan(&id, &val); err == nil {
				metrics += fmt.Sprintf("# HELP ozy_custom_%s Custom project metric\n", id)
				metrics += fmt.Sprintf("# TYPE ozy_custom_%s gauge\n", id)
				metrics += fmt.Sprintf("ozy_custom_%s %f\n", id, val)
			}
		}
	}

	// Response time (Uptime)
	metrics += "# HELP ozy_uptime_seconds Seconds since the process started\n"
	metrics += "# TYPE ozy_uptime_seconds counter\n"
	metrics += fmt.Sprintf("ozy_uptime_seconds %d\n", int64(time.Since(h.StartTime).Seconds()))

	return c.String(http.StatusOK, metrics)
}

// PrometheusMiddleware is a placeholder for custom Prometheus request tracking (Enterprise Phase 1)
func PrometheusMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// In Phase 2, we would track request count and latency here
			return next(c)
		}
	}
}

// RegisterPrometheus registers the metrics endpoint (Enterprise Phase 1)
func RegisterPrometheus(e *echo.Echo) {
	// Already handled via Groups in setupEcho, but keeping for compatibility with main.go
}
