package realtime

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/Xangel0s/OzyBase/internal/security"
	"github.com/jackc/pgx/v5/pgxpool"
)

type WebhookDispatcher struct {
	pool *pgxpool.Pool
}

func NewWebhookDispatcher(pool *pgxpool.Pool) *WebhookDispatcher {
	return &WebhookDispatcher{pool: pool}
}

func (d *WebhookDispatcher) Dispatch(event Event) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 1. Get all active webhooks for this event type
	rows, err := d.pool.Query(ctx, `
		SELECT url, secret FROM _v_webhooks
		WHERE is_active = TRUE
		AND (events = '*' OR events LIKE '%' || $1 || '%')
	`, event.Table)
	if err != nil {
		log.Printf("Failed to fetch webhooks: %v", err)
		return
	}
	defer rows.Close()

	type hookTarget struct {
		URL    string
		Secret string
	}
	var targets []hookTarget
	for rows.Next() {
		var t hookTarget
		var secret *string
		if err := rows.Scan(&t.URL, &secret); err == nil {
			if secret != nil {
				t.Secret = *secret
			}
			targets = append(targets, t)
		}
	}

	// 2. Send payload to each URL
	payload, _ := json.Marshal(event)
	for _, target := range targets {
		go func(t hookTarget) {
			if _, err := security.ValidateOutboundURL(t.URL, security.OutboundURLOptions{
				AllowHTTP:           false,
				AllowPrivateNetwork: security.AllowPrivateOutboundFromEnv(),
			}); err != nil {
				log.Printf("Webhook blocked for %q: %v", t.URL, err)
				return
			}

			req, err := http.NewRequest("POST", t.URL, bytes.NewBuffer(payload))
			if err != nil {
				log.Printf("Failed to create webhook request: %v", err)
				return
			}

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("User-Agent", "OzyBase-Webhook/1.0")

			// Add HMAC signature if secret is present
			if t.Secret != "" {
				h := hmac.New(sha256.New, []byte(t.Secret))
				h.Write(payload)
				signature := hex.EncodeToString(h.Sum(nil))
				req.Header.Set("X-Ozy-Signature", "sha256="+signature)
			}

			client := &http.Client{Timeout: 10 * time.Second}
			// #nosec G704 -- URL is validated with security.ValidateOutboundURL above.
			resp, err := client.Do(req)
			if err != nil {
				log.Printf("Webhook failed to %s: %v", t.URL, err)
				return
			}
			defer func() {
				if closeErr := resp.Body.Close(); closeErr != nil {
					log.Printf("Failed to close webhook response body for %s: %v", t.URL, closeErr)
				}
			}()
			log.Printf("Webhook sent to %s with status %d", t.URL, resp.StatusCode)
		}(target)
	}
}
