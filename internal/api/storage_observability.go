package api

import (
	"context"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	ozystorage "github.com/Xangel0s/OzyBase/internal/storage"
	"github.com/labstack/echo/v4"
)

type storageObservabilityBucket struct {
	Name                     string  `json:"name"`
	Public                   bool    `json:"public"`
	ObjectCount              int64   `json:"object_count"`
	TotalSizeBytes           int64   `json:"total_size_bytes"`
	TotalSizeHuman           string  `json:"total_size_human"`
	MaxFileSizeBytes         int64   `json:"max_file_size_bytes"`
	MaxFileSizeHuman         string  `json:"max_file_size_human"`
	MaxTotalSizeBytes        int64   `json:"max_total_size_bytes"`
	MaxTotalSizeHuman        string  `json:"max_total_size_human"`
	UsageRatioPct            float64 `json:"usage_ratio_pct"`
	LifecycleDeleteAfterDays int     `json:"lifecycle_delete_after_days"`
	ReclaimableObjects       int64   `json:"reclaimable_objects"`
	ReclaimableBytes         int64   `json:"reclaimable_bytes"`
	ReclaimableHuman         string  `json:"reclaimable_human"`
}

type storageObservabilityAlert struct {
	Severity string `json:"severity"`
	Scope    string `json:"scope"`
	Title    string `json:"title"`
	Detail   string `json:"detail"`
}

type storageObservabilityHistoryPoint struct {
	Hour              time.Time `json:"hour"`
	CreatedObjects    int64     `json:"created_objects"`
	CreatedBytes      int64     `json:"created_bytes"`
	CreatedBytesHuman string    `json:"created_bytes_human"`
}

type storageObservabilitySummary struct {
	Provider                   string  `json:"provider"`
	BucketCount                int64   `json:"bucket_count"`
	ObjectCount                int64   `json:"object_count"`
	TotalSizeBytes             int64   `json:"total_size_bytes"`
	TotalSizeHuman             string  `json:"total_size_human"`
	QuotaEnabledBuckets        int64   `json:"quota_enabled_buckets"`
	TotalQuotaBytes            int64   `json:"total_quota_bytes"`
	TotalQuotaHuman            string  `json:"total_quota_human"`
	QuotaUsagePct              float64 `json:"quota_usage_pct"`
	LifecycleEnabledBuckets    int64   `json:"lifecycle_enabled_buckets"`
	ReclaimableObjects         int64   `json:"reclaimable_objects"`
	ReclaimableBytes           int64   `json:"reclaimable_bytes"`
	ReclaimableHuman           string  `json:"reclaimable_human"`
	OpenUploadSessions         int64   `json:"open_upload_sessions"`
	OpenMultipartSessions      int64   `json:"open_multipart_sessions"`
	ExpiredUploadSessions      int64   `json:"expired_upload_sessions"`
	ExpiredUploadSessionBytes  int64   `json:"expired_upload_session_bytes"`
	ExpiredUploadSessionHuman  string  `json:"expired_upload_session_human"`
	RecentUploads24h           int64   `json:"recent_uploads_24h"`
	RecentUploadBytes24h       int64   `json:"recent_upload_bytes_24h"`
	RecentUploadBytes24hHuman  string  `json:"recent_upload_bytes_24h_human"`
	MaintenanceIntervalMinutes int     `json:"maintenance_interval_minutes"`
}

type storageObservabilityPayload struct {
	Summary storageObservabilitySummary        `json:"summary"`
	Buckets []storageObservabilityBucket       `json:"buckets"`
	History []storageObservabilityHistoryPoint `json:"history"`
	Alerts  []storageObservabilityAlert        `json:"alerts"`
}

func (h *Handler) GetStorageObservability(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 8*time.Second)
	defer cancel()

	limit := 8
	if raw := c.QueryParam("limit"); raw != "" {
		if parsed, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil && parsed > 0 {
			if parsed > 50 {
				parsed = 50
			}
			limit = parsed
		}
	}

	payload, err := h.buildStorageObservability(ctx, limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "failed to load storage observability",
		})
	}
	return c.JSON(http.StatusOK, payload)
}

func (h *Handler) buildStorageObservability(ctx context.Context, limit int) (storageObservabilityPayload, error) {
	buckets, summary, err := h.loadStorageBucketsSummary(ctx)
	if err != nil {
		return storageObservabilityPayload{}, err
	}

	var openSessions int64
	var openMultipartSessions int64
	var expiredSessions int64
	var expiredSessionBytes int64
	if err := h.DB.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE completed_at IS NULL)::bigint,
			COUNT(*) FILTER (WHERE mode = 'multipart' AND completed_at IS NULL)::bigint,
			COUNT(*) FILTER (WHERE completed_at IS NULL AND expires_at < NOW())::bigint,
			COALESCE(SUM(size) FILTER (WHERE completed_at IS NULL AND expires_at < NOW()), 0)::bigint
		FROM _v_storage_upload_sessions
	`).Scan(&openSessions, &openMultipartSessions, &expiredSessions, &expiredSessionBytes); err != nil {
		return storageObservabilityPayload{}, err
	}

	var recentUploads int64
	var recentUploadBytes int64
	if err := h.DB.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*)::bigint,
			COALESCE(SUM(size), 0)::bigint
		FROM _v_storage_objects
		WHERE created_at >= NOW() - INTERVAL '24 hours'
	`).Scan(&recentUploads, &recentUploadBytes); err != nil {
		return storageObservabilityPayload{}, err
	}

	history, err := h.loadStorageHistory(ctx)
	if err != nil {
		return storageObservabilityPayload{}, err
	}

	summary.Provider = detectStorageRuntime(h.Storage)
	summary.OpenUploadSessions = openSessions
	summary.OpenMultipartSessions = openMultipartSessions
	summary.ExpiredUploadSessions = expiredSessions
	summary.ExpiredUploadSessionBytes = expiredSessionBytes
	summary.ExpiredUploadSessionHuman = humanizeBytes(expiredSessionBytes)
	summary.RecentUploads24h = recentUploads
	summary.RecentUploadBytes24h = recentUploadBytes
	summary.RecentUploadBytes24hHuman = humanizeBytes(recentUploadBytes)
	summary.MaintenanceIntervalMinutes = parseEnvIntBounded("OZY_STORAGE_MAINTENANCE_INTERVAL_MINUTES", 60, 0, 1440)

	alerts := buildStorageAlerts(summary, buckets)
	if limit < len(buckets) {
		buckets = buckets[:limit]
	}

	return storageObservabilityPayload{
		Summary: summary,
		Buckets: buckets,
		History: history,
		Alerts:  alerts,
	}, nil
}

func (h *Handler) loadStorageBucketsSummary(ctx context.Context) ([]storageObservabilityBucket, storageObservabilitySummary, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT
			b.name,
			b.public,
			b.max_file_size_bytes,
			b.max_total_size_bytes,
			b.lifecycle_delete_after_days,
			COUNT(o.id)::bigint AS object_count,
			COALESCE(SUM(o.size), 0)::bigint AS total_size,
			COUNT(o.id) FILTER (
				WHERE b.lifecycle_delete_after_days > 0
				  AND o.created_at < NOW() - (b.lifecycle_delete_after_days * INTERVAL '1 day')
			)::bigint AS reclaimable_objects,
			COALESCE(SUM(o.size) FILTER (
				WHERE b.lifecycle_delete_after_days > 0
				  AND o.created_at < NOW() - (b.lifecycle_delete_after_days * INTERVAL '1 day')
			), 0)::bigint AS reclaimable_bytes
		FROM _v_buckets b
		LEFT JOIN _v_storage_objects o ON o.bucket_id = b.id
		GROUP BY b.id, b.name, b.public, b.max_file_size_bytes, b.max_total_size_bytes, b.lifecycle_delete_after_days
		ORDER BY total_size DESC, b.name ASC
	`)
	if err != nil {
		return nil, storageObservabilitySummary{}, err
	}
	defer rows.Close()

	buckets := make([]storageObservabilityBucket, 0)
	summary := storageObservabilitySummary{}
	var quotaTrackedBytes int64
	for rows.Next() {
		var item storageObservabilityBucket
		if err := rows.Scan(
			&item.Name,
			&item.Public,
			&item.MaxFileSizeBytes,
			&item.MaxTotalSizeBytes,
			&item.LifecycleDeleteAfterDays,
			&item.ObjectCount,
			&item.TotalSizeBytes,
			&item.ReclaimableObjects,
			&item.ReclaimableBytes,
		); err != nil {
			return nil, storageObservabilitySummary{}, err
		}
		item.TotalSizeHuman = humanizeBytes(item.TotalSizeBytes)
		item.MaxFileSizeHuman = humanizeBytes(item.MaxFileSizeBytes)
		item.MaxTotalSizeHuman = humanizeBytes(item.MaxTotalSizeBytes)
		item.ReclaimableHuman = humanizeBytes(item.ReclaimableBytes)
		item.UsageRatioPct = bucketUsageRatio(bucketRecord{
			TotalSize:         item.TotalSizeBytes,
			MaxTotalSizeBytes: item.MaxTotalSizeBytes,
		})

		summary.BucketCount++
		summary.ObjectCount += item.ObjectCount
		summary.TotalSizeBytes += item.TotalSizeBytes
		if item.MaxTotalSizeBytes > 0 {
			summary.QuotaEnabledBuckets++
			summary.TotalQuotaBytes += item.MaxTotalSizeBytes
			quotaTrackedBytes += item.TotalSizeBytes
		}
		if item.LifecycleDeleteAfterDays > 0 {
			summary.LifecycleEnabledBuckets++
		}
		summary.ReclaimableObjects += item.ReclaimableObjects
		summary.ReclaimableBytes += item.ReclaimableBytes
		buckets = append(buckets, item)
	}
	if err := rows.Err(); err != nil {
		return nil, storageObservabilitySummary{}, err
	}

	summary.TotalSizeHuman = humanizeBytes(summary.TotalSizeBytes)
	summary.TotalQuotaHuman = humanizeBytes(summary.TotalQuotaBytes)
	summary.ReclaimableHuman = humanizeBytes(summary.ReclaimableBytes)
	if summary.TotalQuotaBytes > 0 {
		summary.QuotaUsagePct = bucketUsageRatio(bucketRecord{
			TotalSize:         quotaTrackedBytes,
			MaxTotalSizeBytes: summary.TotalQuotaBytes,
		})
	}
	return buckets, summary, nil
}

func (h *Handler) loadStorageHistory(ctx context.Context) ([]storageObservabilityHistoryPoint, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		WITH series AS (
			SELECT generate_series(
				date_trunc('hour', NOW()) - INTERVAL '23 hours',
				date_trunc('hour', NOW()),
				INTERVAL '1 hour'
			) AS hour_bucket
		)
		SELECT
			s.hour_bucket,
			COUNT(o.id)::bigint AS created_objects,
			COALESCE(SUM(o.size), 0)::bigint AS created_bytes
		FROM series s
		LEFT JOIN _v_storage_objects o
			ON o.created_at >= s.hour_bucket
			AND o.created_at < s.hour_bucket + INTERVAL '1 hour'
		GROUP BY s.hour_bucket
		ORDER BY s.hour_bucket ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	history := make([]storageObservabilityHistoryPoint, 0, 24)
	for rows.Next() {
		var item storageObservabilityHistoryPoint
		if err := rows.Scan(&item.Hour, &item.CreatedObjects, &item.CreatedBytes); err != nil {
			return nil, err
		}
		item.CreatedBytesHuman = humanizeBytes(item.CreatedBytes)
		history = append(history, item)
	}
	return history, rows.Err()
}

func buildStorageAlerts(summary storageObservabilitySummary, buckets []storageObservabilityBucket) []storageObservabilityAlert {
	alerts := make([]storageObservabilityAlert, 0)
	for _, bucket := range buckets {
		switch {
		case bucket.MaxTotalSizeBytes > 0 && bucket.UsageRatioPct >= 95:
			alerts = append(alerts, storageObservabilityAlert{
				Severity: "critical",
				Scope:    bucket.Name,
				Title:    "Bucket quota is nearly exhausted",
				Detail:   bucket.Name + " is using " + bucket.TotalSizeHuman + " of " + bucket.MaxTotalSizeHuman,
			})
		case bucket.MaxTotalSizeBytes > 0 && bucket.UsageRatioPct >= 80:
			alerts = append(alerts, storageObservabilityAlert{
				Severity: "warning",
				Scope:    bucket.Name,
				Title:    "Bucket quota is trending hot",
				Detail:   bucket.Name + " is at " + humanizePercent(bucket.UsageRatioPct) + " of its configured quota",
			})
		}
		if bucket.LifecycleDeleteAfterDays > 0 && bucket.ReclaimableBytes > 0 {
			alerts = append(alerts, storageObservabilityAlert{
				Severity: "info",
				Scope:    bucket.Name,
				Title:    "Lifecycle can reclaim cold storage",
				Detail:   bucket.ReclaimableHuman + " is already eligible for cleanup in " + bucket.Name,
			})
		}
	}
	if summary.ExpiredUploadSessions > 0 {
		alerts = append(alerts, storageObservabilityAlert{
			Severity: "warning",
			Scope:    "multipart",
			Title:    "Expired upload sessions detected",
			Detail:   humanizeBytes(summary.ExpiredUploadSessionBytes) + " remains tied to expired upload sessions and will be cleaned by maintenance",
		})
	}
	if summary.OpenMultipartSessions > 0 {
		alerts = append(alerts, storageObservabilityAlert{
			Severity: "info",
			Scope:    "multipart",
			Title:    "Multipart uploads are active",
			Detail:   humanizeCount(summary.OpenMultipartSessions, "open multipart session", "open multipart sessions"),
		})
	}

	sort.SliceStable(alerts, func(i, j int) bool {
		return storageAlertRank(alerts[i].Severity) < storageAlertRank(alerts[j].Severity)
	})
	if len(alerts) > 8 {
		alerts = alerts[:8]
	}
	return alerts
}

func storageAlertRank(severity string) int {
	switch severity {
	case "critical":
		return 0
	case "warning":
		return 1
	default:
		return 2
	}
}

func detectStorageRuntime(provider ozystorage.Provider) string {
	switch provider.(type) {
	case *ozystorage.S3Provider:
		return "s3"
	case *ozystorage.LocalProvider:
		return "local"
	default:
		return normalizeRuntimeValue(strings.TrimSpace(os.Getenv("OZY_STORAGE_PROVIDER")), "local")
	}
}

func humanizePercent(value float64) string {
	return strconv.FormatFloat(round2(value), 'f', 2, 64) + "%"
}

func humanizeCount(value int64, singular, plural string) string {
	if value == 1 {
		return "1 " + singular
	}
	return strconv.FormatInt(value, 10) + " " + plural
}
