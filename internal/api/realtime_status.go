package api

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/labstack/echo/v4"
)

// GetRealtimeStatus handles GET /api/project/realtime/status.
func (h *Handler) GetRealtimeStatus(c echo.Context) error {
	mode := "unknown"
	health := "unknown"
	healthErr := ""

	channel := strings.TrimSpace(os.Getenv("OZY_REALTIME_CHANNEL"))
	if channel == "" {
		channel = realtime.DefaultClusterChannel
	}

	nodeID := ""
	clients := 0
	if h.Broker != nil {
		nodeID = strings.TrimSpace(h.Broker.NodeID)
		clients = h.Broker.ClientCount()
	}

	if h.PubSub != nil {
		mode = h.PubSub.Mode()
		ctx, cancel := context.WithTimeout(c.Request().Context(), 2*time.Second)
		defer cancel()
		if err := h.PubSub.Health(ctx); err != nil {
			health = "degraded"
			healthErr = err.Error()
		} else {
			health = "ok"
		}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"mode":                mode,
		"health":              health,
		"health_error":        healthErr,
		"distributed_enabled": mode == "redis",
		"channel":             channel,
		"node_id":             nodeID,
		"active_clients":      clients,
	})
}
