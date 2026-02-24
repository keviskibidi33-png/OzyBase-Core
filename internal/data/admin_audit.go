package data

import (
	"context"
	"encoding/json"
	"time"
)

// AdminAuditEvent stores normalized traceability records for privileged operations.
type AdminAuditEvent struct {
	RequestID  string
	Action     string
	Target     string
	ActorUser  *string
	ActorRole  string
	Workspace  *string
	Method     string
	Path       string
	Route      string
	Status     int
	Success    bool
	DurationMS int64
	SourceIP   string
	UserAgent  string
	Metadata   map[string]any
	CreatedAt  time.Time
}

// InsertAdminAuditEvent writes one privileged operation audit record.
func (db *DB) InsertAdminAuditEvent(ctx context.Context, event AdminAuditEvent) error {
	metadata := event.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		metadataJSON = []byte("{}")
	}

	_, err = db.Pool.Exec(ctx, `
		INSERT INTO _v_admin_audit_events (
			request_id, action, target, actor_user_id, actor_role, workspace_id,
			method, path, route, status, success, duration_ms, source_ip, user_agent, metadata, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16)
	`,
		event.RequestID, event.Action, event.Target, event.ActorUser, event.ActorRole, event.Workspace,
		event.Method, event.Path, event.Route, event.Status, event.Success, event.DurationMS, event.SourceIP, event.UserAgent, string(metadataJSON), event.CreatedAt,
	)
	return err
}
