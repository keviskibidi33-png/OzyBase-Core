package realtime

import (
	"os"
	"strconv"
	"strings"
	"sync"
)

// Event represents a realtime event data matching Postgres trigger payload
type Event struct {
	Table  string `json:"table"`
	Action string `json:"action"`
	Record any    `json:"record"`
	Old    any    `json:"old,omitempty"`
	NodeID string `json:"node_id,omitempty"`
	Source string `json:"source,omitempty"`
}

// Broker manages connected clients and broadcasts events
type Broker struct {
	notifier       chan Event
	newClients     chan chan Event
	closingClients chan chan Event
	clients        map[chan Event]bool
	mu             sync.Mutex
	Dispatcher     *WebhookDispatcher
	NodeID         string
}

// NewBroker creates a new event broker
func NewBroker() *Broker {
	broker := &Broker{
		notifier:       make(chan Event, 1),
		newClients:     make(chan chan Event),
		closingClients: make(chan chan Event),
		clients:        make(map[chan Event]bool),
		NodeID:         DefaultNodeID(),
	}

	go broker.listen()
	return broker
}

func (b *Broker) listen() {
	for {
		select {
		case s := <-b.newClients:
			b.mu.Lock()
			b.clients[s] = true
			b.mu.Unlock()
		case s := <-b.closingClients:
			b.mu.Lock()
			delete(b.clients, s)
			b.mu.Unlock()
		case event := <-b.notifier:
			b.mu.Lock()
			for clientChan := range b.clients {
				select {
				case clientChan <- event:
				default:
					// Slow clients are skipped to avoid stalling all realtime consumers.
				}
			}
			b.mu.Unlock()
		}
	}
}

// Subscribe adds a new client and returns their event channel
func (b *Broker) Subscribe() chan Event {
	clientChan := make(chan Event, 64)
	b.newClients <- clientChan
	return clientChan
}

// Unsubscribe removes a client channel
func (b *Broker) Unsubscribe(clientChan chan Event) {
	b.closingClients <- clientChan
}

// Broadcast sends an event to all connected clients
func (b *Broker) Broadcast(event Event) {
	b.notifier <- event
	if b.Dispatcher != nil {
		b.Dispatcher.Dispatch(event)
	}
}

// ClientCount returns the number of active realtime subscribers.
func (b *Broker) ClientCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.clients)
}

// SetNodeID overrides the broker node identifier for distributed fan-out.
func (b *Broker) SetNodeID(nodeID string) {
	nodeID = strings.TrimSpace(nodeID)
	if nodeID == "" {
		return
	}
	b.NodeID = nodeID
}

// DefaultNodeID builds a deterministic node identifier for cluster fan-out.
func DefaultNodeID() string {
	host, _ := os.Hostname()
	host = strings.TrimSpace(host)
	if host == "" {
		host = "ozy-node"
	}
	return host + "-" + strconv.Itoa(os.Getpid())
}
