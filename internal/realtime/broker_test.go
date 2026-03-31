package realtime

import (
	"testing"
	"time"
)

func TestBrokerSuppressesDuplicateEventPayloadsAcrossNodes(t *testing.T) {
	broker := NewBroker()
	broker.dedupeWindow = 250 * time.Millisecond
	sub := broker.Subscribe()
	defer broker.Unsubscribe(sub)

	first := Event{
		Table:  "qa_events",
		Action: "INSERT",
		Record: map[string]any{"id": "row-1", "title": "hello"},
		NodeID: "node-a",
		Source: "postgres",
	}
	second := Event{
		Table:  "qa_events",
		Action: "INSERT",
		Record: map[string]any{"id": "row-1", "title": "hello"},
		NodeID: "node-b",
		Source: "pubsub",
	}

	broker.Broadcast(first)
	select {
	case <-sub:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("expected first event to be delivered")
	}

	broker.Broadcast(second)
	select {
	case evt := <-sub:
		t.Fatalf("did not expect duplicate event to be delivered: %+v", evt)
	case <-time.After(120 * time.Millisecond):
	}
}

func TestBrokerAllowsSamePayloadAfterDedupeWindow(t *testing.T) {
	broker := NewBroker()
	broker.dedupeWindow = 10 * time.Millisecond
	sub := broker.Subscribe()
	defer broker.Unsubscribe(sub)

	event := Event{
		Table:  "qa_events",
		Action: "UPDATE",
		Record: map[string]any{"id": "row-2", "title": "fresh"},
		NodeID: "node-a",
		Source: "postgres",
	}

	broker.Broadcast(event)
	select {
	case <-sub:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("expected first event to be delivered")
	}

	time.Sleep(20 * time.Millisecond)

	broker.Broadcast(event)
	select {
	case <-sub:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("expected event after dedupe window to be delivered")
	}
}
