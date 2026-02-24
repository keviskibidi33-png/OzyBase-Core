package realtime

import (
	"context"
	"encoding/json"

	"github.com/go-redis/redis/v8"
)

// PubSub interface defines methods for distributed event broadcasting
type PubSub interface {
	Publish(ctx context.Context, channel string, event Event) error
	Subscribe(ctx context.Context, channel string) (<-chan Event, error)
	Mode() string
	Health(ctx context.Context) error
}

// RedisPubSub implementation using Redis
type RedisPubSub struct {
	client *redis.Client
}

func NewRedisPubSub(addr, password string, db int) *RedisPubSub {
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})
	return &RedisPubSub{client: client}
}

func (r *RedisPubSub) Mode() string {
	return "redis"
}

func (r *RedisPubSub) Health(ctx context.Context) error {
	return r.client.Ping(ctx).Err()
}

func (r *RedisPubSub) Publish(ctx context.Context, channel string, event Event) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return r.client.Publish(ctx, channel, data).Err()
}

func (r *RedisPubSub) Subscribe(ctx context.Context, channel string) (<-chan Event, error) {
	pubsub := r.client.Subscribe(ctx, channel)
	if _, err := pubsub.Receive(ctx); err != nil {
		_ = pubsub.Close()
		return nil, err
	}
	eventChan := make(chan Event, 64)

	go func() {
		defer func() { _ = pubsub.Close() }()
		defer close(eventChan)
		ch := pubsub.Channel()
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				var event Event
				if err := json.Unmarshal([]byte(msg.Payload), &event); err == nil {
					select {
					case eventChan <- event:
					default:
						// Drop event when subscribers are saturated.
					}
				}
			}
		}
	}()

	return eventChan, nil
}

// LocalPubSub implementation for single-node deployments (default)
type LocalPubSub struct {
	broker *Broker
}

func NewLocalPubSub(broker *Broker) *LocalPubSub {
	return &LocalPubSub{broker: broker}
}

func (l *LocalPubSub) Mode() string {
	return "local"
}

func (l *LocalPubSub) Health(ctx context.Context) error {
	return nil
}

func (l *LocalPubSub) Publish(ctx context.Context, channel string, event Event) error {
	// Local deployments already receive events directly from the database listener.
	return nil
}

func (l *LocalPubSub) Subscribe(ctx context.Context, channel string) (<-chan Event, error) {
	out := make(chan Event)
	close(out)
	return out, nil
}
