package realtime

import (
	"context"
	"encoding/json"
	"log"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func ListenForEvents(ctx context.Context, pool *pgxpool.Pool, broker *Broker, dispatcher *WebhookDispatcher, pubsub PubSub, nodeID string, channel string) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		log.Fatalf("Unable to acquire connection for listening: %v", err)
	}
	defer conn.Release()

	_, err = conn.Exec(ctx, "LISTEN ozy_events")
	if err != nil {
		log.Fatalf("Unable to listen on ozy_events channel: %v", err)
	}

	log.Println("🔔 Listening for database events...")

	for {
		notification, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			log.Printf("Error waiting for notification: %v", err)
			return
		}

		var event Event
		err = json.Unmarshal([]byte(notification.Payload), &event)
		if err != nil {
			log.Printf("Error unmarshaling event: %v", err)
			continue
		}
		event.NodeID = strings.TrimSpace(nodeID)
		event.Source = "postgres"

		broker.Broadcast(event)
		if pubsub != nil {
			if err := pubsub.Publish(ctx, channel, event); err != nil {
				log.Printf("Failed to publish distributed realtime event: %v", err)
			}
		}

		// Dispatch to Webhooks
		if dispatcher != nil {
			dispatcher.Dispatch(event)
		}
	}
}
