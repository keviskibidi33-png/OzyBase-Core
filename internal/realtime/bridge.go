package realtime

import (
	"context"
	"fmt"
	"log"
	"strings"
)

const (
	// DefaultClusterChannel is the distributed event channel used for global SSE fan-out.
	DefaultClusterChannel = "ozy_events_cluster"
)

// StartPubSubBridge fans in distributed events from PubSub to the local broker.
// It is safe to call in local mode; the local backend returns a closed channel.
func StartPubSubBridge(ctx context.Context, pubsub PubSub, broker *Broker, nodeID string, channel string) error {
	if pubsub == nil {
		return fmt.Errorf("pubsub is nil")
	}
	if broker == nil {
		return fmt.Errorf("broker is nil")
	}
	nodeID = strings.TrimSpace(nodeID)
	if nodeID == "" {
		return fmt.Errorf("nodeID is required")
	}
	channel = strings.TrimSpace(channel)
	if channel == "" {
		channel = DefaultClusterChannel
	}

	events, err := pubsub.Subscribe(ctx, channel)
	if err != nil {
		return err
	}

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case evt, ok := <-events:
				if !ok {
					return
				}
				if strings.TrimSpace(evt.NodeID) == nodeID {
					// Ignore events originated from this node to avoid duplication.
					continue
				}
				evt.Source = "pubsub"
				broker.Broadcast(evt)
			}
		}
	}()
	log.Printf("Realtime PubSub bridge active (mode=%s, channel=%s, node=%s)", pubsub.Mode(), channel, nodeID)
	return nil
}
