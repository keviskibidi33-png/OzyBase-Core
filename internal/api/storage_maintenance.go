package api

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

type storageLifecycleSweepResult struct {
	BucketName     string
	RetentionDays  int
	DeletedObjects int
	ReclaimedBytes int64
}

type storageMaintenanceSummary struct {
	SweptBuckets    int
	DeletedObjects  int
	ReclaimedBytes  int64
	ExpiredSessions int
	DeletedParts    int
}

func (h *FileHandler) StartMaintenanceLoop(ctx context.Context, interval time.Duration) {
	if h == nil || h.DB == nil || h.DB.Pool == nil || h.Storage == nil || interval <= 0 {
		return
	}

	runPass := func(trigger string) {
		runCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
		defer cancel()

		summary, err := h.runMaintenancePass(runCtx)
		if err != nil {
			log.Printf("[storage] maintenance pass failed (%s): %v", trigger, err)
			return
		}
		if summary.DeletedObjects > 0 || summary.ExpiredSessions > 0 || summary.DeletedParts > 0 {
			log.Printf(
				"[storage] maintenance pass complete (%s): swept_buckets=%d deleted_objects=%d reclaimed_bytes=%d expired_sessions=%d deleted_parts=%d",
				trigger,
				summary.SweptBuckets,
				summary.DeletedObjects,
				summary.ReclaimedBytes,
				summary.ExpiredSessions,
				summary.DeletedParts,
			)
		}
	}

	log.Printf("[storage] maintenance loop enabled interval=%s", interval)
	runPass("startup")

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runPass("ticker")
		}
	}
}

func (h *FileHandler) runMaintenancePass(ctx context.Context) (storageMaintenanceSummary, error) {
	results, err := h.sweepLifecycleBuckets(ctx)
	if err != nil {
		return storageMaintenanceSummary{}, err
	}

	summary := storageMaintenanceSummary{
		SweptBuckets: len(results),
	}
	for _, result := range results {
		summary.DeletedObjects += result.DeletedObjects
		summary.ReclaimedBytes += result.ReclaimedBytes
	}

	expiredSessions, deletedParts, err := h.cleanupExpiredUploadSessions(ctx)
	if err != nil {
		return storageMaintenanceSummary{}, err
	}
	summary.ExpiredSessions = expiredSessions
	summary.DeletedParts = deletedParts
	return summary, nil
}

func (h *FileHandler) sweepLifecycleBuckets(ctx context.Context) ([]storageLifecycleSweepResult, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT
			b.id,
			b.name,
			b.public,
			b.rls_enabled,
			b.rls_rule,
			b.max_file_size_bytes,
			b.max_total_size_bytes,
			b.lifecycle_delete_after_days,
			b.created_at,
			COUNT(o.id) AS object_count,
			COALESCE(SUM(o.size), 0) AS total_size
		FROM _v_buckets b
		LEFT JOIN _v_storage_objects o ON o.bucket_id = b.id
		WHERE b.lifecycle_delete_after_days > 0
		GROUP BY b.id, b.name, b.public, b.rls_enabled, b.rls_rule, b.max_file_size_bytes, b.max_total_size_bytes, b.lifecycle_delete_after_days, b.created_at
		ORDER BY b.name ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]storageLifecycleSweepResult, 0)
	for rows.Next() {
		var bucket bucketRecord
		if err := rows.Scan(
			&bucket.ID,
			&bucket.Name,
			&bucket.Public,
			&bucket.RLSEnabled,
			&bucket.RLSRule,
			&bucket.MaxFileSizeBytes,
			&bucket.MaxTotalSizeBytes,
			&bucket.LifecycleDeleteAfterDays,
			&bucket.CreatedAt,
			&bucket.ObjectCount,
			&bucket.TotalSize,
		); err != nil {
			return nil, err
		}

		result, err := h.runLifecycleSweepForBucket(ctx, bucket)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	return results, rows.Err()
}

func (h *FileHandler) runLifecycleSweepForBucket(ctx context.Context, bucket bucketRecord) (storageLifecycleSweepResult, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT id, name, size, content_type, path, created_at
		FROM _v_storage_objects
		WHERE bucket_id = $1
		  AND created_at < NOW() - ($2 * INTERVAL '1 day')
	`, bucket.ID, bucket.LifecycleDeleteAfterDays)
	if err != nil {
		return storageLifecycleSweepResult{}, err
	}
	defer rows.Close()

	objects := make([]storedObject, 0)
	var reclaimedBytes int64
	for rows.Next() {
		var object storedObject
		if err := rows.Scan(&object.ID, &object.Name, &object.Size, &object.ContentType, &object.StoragePath, &object.CreatedAt); err != nil {
			return storageLifecycleSweepResult{}, err
		}
		reclaimedBytes += object.Size
		objects = append(objects, object)
	}
	if err := rows.Err(); err != nil {
		return storageLifecycleSweepResult{}, err
	}

	for _, object := range objects {
		if err := h.deleteStoredObject(ctx, bucket.Name, object.StoragePath); err != nil {
			return storageLifecycleSweepResult{}, err
		}
		if _, err := h.DB.Pool.Exec(ctx, `DELETE FROM _v_storage_objects WHERE id = $1`, object.ID); err != nil {
			return storageLifecycleSweepResult{}, err
		}
	}

	return storageLifecycleSweepResult{
		BucketName:     bucket.Name,
		RetentionDays:  bucket.LifecycleDeleteAfterDays,
		DeletedObjects: len(objects),
		ReclaimedBytes: reclaimedBytes,
	}, nil
}

func (h *FileHandler) cleanupExpiredUploadSessions(ctx context.Context) (int, int, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT id, mode
		FROM _v_storage_upload_sessions
		WHERE completed_at IS NULL
		  AND expires_at < NOW()
		ORDER BY expires_at ASC
	`)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()

	type expiredSession struct {
		ID   string
		Mode string
	}
	sessions := make([]expiredSession, 0)
	for rows.Next() {
		var session expiredSession
		if err := rows.Scan(&session.ID, &session.Mode); err != nil {
			return 0, 0, err
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}

	deletedParts := 0
	for _, session := range sessions {
		if session.Mode == "multipart" {
			parts, err := h.listMultipartUploadParts(ctx, session.ID)
			if err != nil {
				return 0, deletedParts, err
			}
			if err := h.deleteMultipartUploadParts(ctx, session.ID, parts); err != nil {
				return 0, deletedParts, err
			}
			deletedParts += len(parts)
		}
		if _, err := h.DB.Pool.Exec(ctx, `DELETE FROM _v_storage_upload_sessions WHERE id = $1`, session.ID); err != nil {
			return 0, deletedParts, err
		}
	}

	return len(sessions), deletedParts, nil
}

func (h *FileHandler) RunLifecycleSweep(c echo.Context) error {
	bucket, err := h.getBucket(c.Request().Context(), normalizeBucketName(c.Param("name")))
	if err != nil {
		return storageErrorResponse(c, err)
	}
	if bucket.LifecycleDeleteAfterDays <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Bucket lifecycle retention is not configured"})
	}

	result, err := h.runLifecycleSweepForBucket(c.Request().Context(), bucket)
	if err != nil {
		return storageErrorResponse(c, err)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"bucket":               result.BucketName,
		"retention_days":       result.RetentionDays,
		"deleted_objects":      result.DeletedObjects,
		"reclaimed_bytes":      result.ReclaimedBytes,
		"reclaimed_size_human": humanizeBytes(result.ReclaimedBytes),
	})
}
