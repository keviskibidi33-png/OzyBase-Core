package data

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/jackc/pgx/v5"
)

// ListenDB connects to Postgres using a dedicated connection and listens for notifications.
func ListenDB(ctx context.Context, databaseURL string, broker *realtime.Broker) {
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		log.Fatalf("Realtime listener failed to connect: %v", err)
	}
	defer conn.Close(ctx)

	_, err = conn.Exec(ctx, "LISTEN OzyBase_events")
	if err != nil {
		log.Fatalf("Realtime listener failed to execute LISTEN: %v", err)
	}

	log.Println("Realtime listener active on channel 'OzyBase_events'")

	for {
		select {
		case <-ctx.Done():
			return
		default:
			// Wait for a notification.
			notification, err := conn.WaitForNotification(ctx)
			if err != nil {
				log.Printf("Realtime listener error: %v. Retrying in 5s...", err)
				time.Sleep(5 * time.Second)
				// Reconnect logic could be added here.
				continue
			}

			var payload map[string]any
			if err := json.Unmarshal([]byte(notification.Payload), &payload); err != nil {
				log.Printf("Failed to parse notification payload: %v", err)
				continue
			}

			// Ideally the payload should contain info about which table it came from.
			broker.Broadcast(realtime.Event{
				Table:  payload["table"].(string),
				Action: payload["action"].(string),
				Record: payload["record"],
				Old:    payload["old"],
			})
		}
	}
}
