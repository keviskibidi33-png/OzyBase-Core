package api

import (
	"encoding/json"
	"fmt"

	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/labstack/echo/v4"
)

// RealtimeHandler handles the SSE connection
type RealtimeHandler struct {
	Broker *realtime.Broker
}

// NewRealtimeHandler creates a new instances of RealtimeHandler
func NewRealtimeHandler(broker *realtime.Broker) *RealtimeHandler {
	return &RealtimeHandler{Broker: broker}
}

// Stream handles GET /api/realtime
func (h *RealtimeHandler) Stream(c echo.Context) error {
	w := c.Response()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Subscribe to events
	eventChan := h.Broker.Subscribe()
	defer h.Broker.Unsubscribe(eventChan)

	// Send initial comment to keep connection alive
	if _, err := fmt.Fprintf(w, ": welcome to OzyBase realtime\n\n"); err != nil {
		return nil
	}
	w.Flush()

	ctx := c.Request().Context()

	for {
		select {
		case event := <-eventChan:
			msg, err := json.Marshal(event)
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(w, "data: %s\n\n", msg); err != nil {
				return nil
			}
			w.Flush()
		case <-ctx.Done():
			return nil
		}
	}
}
