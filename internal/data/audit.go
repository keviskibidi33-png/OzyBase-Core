package data

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// AuditLog represents a simplified log entry for database persistence
type AuditLog struct {
	UserID    *string
	IP        string
	Method    string
	Path      string
	Status    int
	Latency   int64
	Country   string
	City      string
	UserAgent string
	CreatedAt time.Time
}

// InsertAuditLog inserts a single audit log
func (db *DB) InsertAuditLog(ctx context.Context, log AuditLog) error {
	_, err := db.Pool.Exec(ctx, `
		INSERT INTO _v_audit_logs (user_id, ip_address, method, path, status, latency_ms, country, city, user_agent, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, log.UserID, log.IP, log.Method, log.Path, log.Status, log.Latency, log.Country, log.City, log.UserAgent, log.CreatedAt)
	return err
}

// BulkInsertAuditLogs efficiently inserts multiple logs using CopyFrom
func (db *DB) BulkInsertAuditLogs(ctx context.Context, logs []AuditLog) error {
	if len(logs) == 0 {
		return nil
	}

	rows := make([][]any, len(logs))
	for i, log := range logs {
		rows[i] = []any{
			log.UserID,
			log.IP,
			log.Method,
			log.Path,
			log.Status,
			log.Latency,
			log.Country,
			log.City,
			log.UserAgent,
			log.CreatedAt,
		}
	}

	_, err := db.Pool.CopyFrom(
		ctx,
		pgx.Identifier{"_v_audit_logs"},
		[]string{"user_id", "ip_address", "method", "path", "status", "latency_ms", "country", "city", "user_agent", "created_at"},
		pgx.CopyFromRows(rows),
	)
	return err
}
