package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/Xangel0s/OzyBase/internal/data"
	ozystorage "github.com/Xangel0s/OzyBase/internal/storage"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
)

const defaultBucketRLSRule = "auth.uid() = owner_id"
const storageUploadSessionTTL = 15 * time.Minute
const storageMultipartChunkSize int64 = 8 * 1024 * 1024
const storageMultipartThreshold int64 = 64 * 1024 * 1024
const storageMultipartKeepAliveTTL = 30 * time.Minute
const storageMultipartMinSessionTTL = 45 * time.Minute
const storageMultipartMaxSessionTTL = 12 * time.Hour
const storageMultipartTempBucket = "ozy-upload-parts"

var bucketNamePattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9._-]{1,61}[a-z0-9])?$`)

type storageAction string

const (
	storageActionRead  storageAction = "read"
	storageActionWrite storageAction = "write"
	storageActionAdmin storageAction = "admin"
)

type bucketRecord struct {
	ID                       string
	Name                     string
	Public                   bool
	RLSEnabled               bool
	RLSRule                  string
	MaxFileSizeBytes         int64
	MaxTotalSizeBytes        int64
	LifecycleDeleteAfterDays int
	CreatedAt                any
	ObjectCount              int64
	TotalSize                int64
}

type storedObject struct {
	ID          string
	Name        string
	Size        int64
	ContentType string
	StoragePath string
	CreatedAt   any
}

type storageUploadSession struct {
	ID             string
	BucketID       string
	BucketName     string
	OwnerID        *string
	Name           string
	Size           int64
	ContentType    string
	StorageKey     string
	Mode           string
	ChunkSizeBytes int64
	ExpiresAt      time.Time
	UsedAt         *time.Time
	CompletedAt    *time.Time
}

type storageUploadPart struct {
	PartNumber int
	Size       int64
	StorageKey string
}

type storageUploadClaims struct {
	SessionID string `json:"sid"`
	Scope     string `json:"scope"`
	jwt.RegisteredClaims
}

// FileHandler handles file uploads and storage policies.
type FileHandler struct {
	DB         *data.DB
	Storage    ozystorage.Provider
	StorageDir string
	UploadKey  string
}

// NewFileHandler creates a new instance of FileHandler.
func NewFileHandler(db *data.DB, storageSvc ozystorage.Provider, storageDir string, uploadKey string) *FileHandler {
	return &FileHandler{
		DB:         db,
		Storage:    storageSvc,
		StorageDir: storageDir,
		UploadKey:  strings.TrimSpace(uploadKey),
	}
}

// Upload handles POST /api/files
func (h *FileHandler) Upload(c echo.Context) error {
	bucketName := normalizeBucketName(c.QueryParam("bucket"))
	bucket, err := h.getBucket(c.Request().Context(), bucketName)
	if err != nil {
		return storageErrorResponse(c, err)
	}

	if _, err := h.authorizeBucket(c, bucket, storageActionWrite); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Failed to get file from request: " + err.Error(),
		})
	}

	source, err := fileHeader.Open()
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Failed to open uploaded file: " + err.Error(),
		})
	}
	defer source.Close()

	displayName := cleanObjectName(fileHeader.Filename)
	objectKey := buildObjectStorageKey(displayName)
	contentType := strings.TrimSpace(fileHeader.Header.Get("Content-Type"))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	if err := validateBucketUploadSize(bucket, fileHeader.Size); err != nil {
		return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"error": err.Error()})
	}
	if err := validateBucketTotalQuota(bucket, fileHeader.Size); err != nil {
		return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"error": err.Error()})
	}

	if err := h.Storage.Upload(c.Request().Context(), bucket.Name, objectKey, source, fileHeader.Size, contentType, storageObjectACL(bucket)); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to store file: " + err.Error(),
		})
	}

	payload, err := h.createStoredObjectRecord(c.Request().Context(), bucket, uuidPointerFromContext(c), displayName, objectKey, fileHeader.Size, contentType)
	if err != nil {
		_ = h.Storage.Delete(c.Request().Context(), bucket.Name, objectKey)
		return storageUploadMetadataError(c, err)
	}

	return c.JSON(http.StatusCreated, payload)
}

// CreateUploadSession handles POST /api/files/uploads/session
func (h *FileHandler) CreateUploadSession(c echo.Context) error {
	var req struct {
		BucketName  string `json:"bucket"`
		FileName    string `json:"filename"`
		ContentType string `json:"content_type"`
		Size        int64  `json:"size"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid upload session request"})
	}

	bucketName := normalizeBucketName(req.BucketName)
	bucket, err := h.getBucket(c.Request().Context(), bucketName)
	if err != nil {
		return storageErrorResponse(c, err)
	}
	if _, err := h.authorizeBucket(c, bucket, storageActionWrite); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
	}
	if req.Size < 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "File size must be zero or greater"})
	}
	if err := validateBucketUploadSize(bucket, req.Size); err != nil {
		return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"error": err.Error()})
	}
	if err := validateBucketTotalQuota(bucket, req.Size); err != nil {
		return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"error": err.Error()})
	}

	displayName := cleanObjectName(req.FileName)
	if strings.TrimSpace(displayName) == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Filename is required"})
	}
	contentType := strings.TrimSpace(req.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	ownerID := uuidPointerFromContext(c)
	expiresAt := time.Now().UTC().Add(storageUploadSessionTTL)
	objectKey := buildObjectStorageKey(displayName)
	var sessionID string
	err = h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_storage_upload_sessions (bucket_id, owner_id, name, size, content_type, storage_key, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`, bucket.ID, ownerID, displayName, req.Size, contentType, objectKey, expiresAt).Scan(&sessionID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create upload session: " + err.Error()})
	}

	token, err := issueStorageUploadToken(h.UploadKey, sessionID, time.Now().UTC(), expiresAt)
	if err != nil {
		_, _ = h.DB.Pool.Exec(c.Request().Context(), `DELETE FROM _v_storage_upload_sessions WHERE id = $1`, sessionID)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to sign upload session"})
	}

	return c.JSON(http.StatusCreated, map[string]any{
		"upload_url":           "/api/files/uploads",
		"upload_token":         token,
		"bucket":               bucket.Name,
		"filename":             displayName,
		"content_type":         contentType,
		"size":                 req.Size,
		"storage_key":          objectKey,
		"expires_at":           expiresAt,
		"max_file_size_bytes":  bucket.MaxFileSizeBytes,
		"streaming":            true,
		"body_limit_bypassed":  true,
		"recommended_protocol": "same-origin-put",
	})
}

// CreateMultipartUploadSession handles POST /api/files/uploads/multipart/session
func (h *FileHandler) CreateMultipartUploadSession(c echo.Context) error {
	var req struct {
		BucketName     string `json:"bucket"`
		FileName       string `json:"filename"`
		ContentType    string `json:"content_type"`
		Size           int64  `json:"size"`
		ChunkSizeBytes int64  `json:"chunk_size_bytes"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid multipart upload request"})
	}

	bucketName := normalizeBucketName(req.BucketName)
	bucket, err := h.getBucket(c.Request().Context(), bucketName)
	if err != nil {
		return storageErrorResponse(c, err)
	}
	if _, err := h.authorizeBucket(c, bucket, storageActionWrite); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
	}
	if req.Size < 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "File size must be zero or greater"})
	}
	if err := validateBucketUploadSize(bucket, req.Size); err != nil {
		return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"error": err.Error()})
	}
	if err := validateBucketTotalQuota(bucket, req.Size); err != nil {
		return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"error": err.Error()})
	}

	chunkSize := req.ChunkSizeBytes
	if chunkSize <= 0 {
		chunkSize = recommendedMultipartChunkSize(req.Size)
	}
	if chunkSize > storageMultipartThreshold {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("chunk_size_bytes must be <= %d", storageMultipartThreshold)})
	}

	displayName := cleanObjectName(req.FileName)
	if strings.TrimSpace(displayName) == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Filename is required"})
	}
	contentType := strings.TrimSpace(req.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	ownerID := uuidPointerFromContext(c)
	expiresAt := time.Now().UTC().Add(multipartSessionTTL(req.Size, chunkSize))
	objectKey := buildObjectStorageKey(displayName)
	var sessionID string
	err = h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_storage_upload_sessions (bucket_id, owner_id, name, size, content_type, storage_key, mode, chunk_size_bytes, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'multipart', $7, $8)
		RETURNING id
	`, bucket.ID, ownerID, displayName, req.Size, contentType, objectKey, chunkSize, expiresAt).Scan(&sessionID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create multipart upload session: " + err.Error()})
	}

	totalParts := multipartTotalParts(req.Size, chunkSize)
	return c.JSON(http.StatusCreated, map[string]any{
		"session_id":            sessionID,
		"mode":                  "multipart",
		"bucket":                bucket.Name,
		"filename":              displayName,
		"content_type":          contentType,
		"size":                  req.Size,
		"storage_key":           objectKey,
		"chunk_size_bytes":      chunkSize,
		"total_parts":           totalParts,
		"expires_at":            expiresAt,
		"max_file_size_bytes":   bucket.MaxFileSizeBytes,
		"max_total_size_bytes":  bucket.MaxTotalSizeBytes,
		"recommended_threshold": storageMultipartThreshold,
	})
}

// GetMultipartUploadSession handles GET /api/files/uploads/multipart/:id
func (h *FileHandler) GetMultipartUploadSession(c echo.Context) error {
	session, err := h.getStorageUploadSession(c.Request().Context(), strings.TrimSpace(c.Param("id")))
	if err != nil {
		return storageErrorResponse(c, err)
	}
	if err := authorizeMultipartSession(c, session); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
	}
	if session.Mode != "multipart" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "upload session is not multipart"})
	}

	parts, err := h.listMultipartUploadParts(c.Request().Context(), session.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list multipart parts: " + err.Error()})
	}
	uploadedParts := make([]int, 0, len(parts))
	var receivedBytes int64
	for _, part := range parts {
		uploadedParts = append(uploadedParts, part.PartNumber)
		receivedBytes += part.Size
	}

	return c.JSON(http.StatusOK, map[string]any{
		"session_id":       session.ID,
		"mode":             session.Mode,
		"bucket":           session.BucketName,
		"filename":         session.Name,
		"size":             session.Size,
		"chunk_size_bytes": session.ChunkSizeBytes,
		"total_parts":      multipartTotalParts(session.Size, session.ChunkSizeBytes),
		"uploaded_parts":   uploadedParts,
		"received_bytes":   receivedBytes,
		"expires_at":       session.ExpiresAt,
		"completed_at":     session.CompletedAt,
	})
}

// UploadMultipartPart handles PUT /api/files/uploads/multipart/:id/parts/:part
func (h *FileHandler) UploadMultipartPart(c echo.Context) error {
	session, err := h.getStorageUploadSession(c.Request().Context(), strings.TrimSpace(c.Param("id")))
	if err != nil {
		return storageErrorResponse(c, err)
	}
	if err := authorizeMultipartSession(c, session); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
	}
	if session.Mode != "multipart" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "upload session is not multipart"})
	}
	if session.CompletedAt != nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": "multipart upload session is already complete"})
	}
	if time.Now().UTC().After(session.ExpiresAt) {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "upload session expired"})
	}

	partNumber, expectedSize, totalParts, err := parseMultipartPartRequest(c, session)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if c.Request().ContentLength >= 0 && c.Request().ContentLength != expectedSize {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("Content length mismatch for part %d: expected %d bytes, got %d", partNumber, expectedSize, c.Request().ContentLength),
		})
	}

	partKey := multipartPartStorageKey(session.ID, partNumber)
	if err := h.Storage.Upload(c.Request().Context(), storageMultipartTempBucket, partKey, c.Request().Body, expectedSize, "application/octet-stream", ozystorage.ACLPrivate); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to store multipart chunk: " + err.Error()})
	}

	_, err = h.DB.Pool.Exec(c.Request().Context(), `
		INSERT INTO _v_storage_upload_session_parts (session_id, part_number, size, storage_path, uploaded_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (session_id, part_number) DO UPDATE
		SET size = EXCLUDED.size, storage_path = EXCLUDED.storage_path, uploaded_at = NOW()
	`, session.ID, partNumber, expectedSize, partKey)
	if err != nil {
		_ = h.Storage.Delete(c.Request().Context(), storageMultipartTempBucket, partKey)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to record multipart chunk: " + err.Error()})
	}
	_, _ = h.DB.Pool.Exec(c.Request().Context(), `
		UPDATE _v_storage_upload_sessions
		SET expires_at = GREATEST(expires_at, $2)
		WHERE id = $1
	`, session.ID, time.Now().UTC().Add(storageMultipartKeepAliveTTL))

	return c.JSON(http.StatusCreated, map[string]any{
		"session_id":    session.ID,
		"part_number":   partNumber,
		"expected_size": expectedSize,
		"total_parts":   totalParts,
	})
}

// CompleteMultipartUpload handles POST /api/files/uploads/multipart/:id/complete
func (h *FileHandler) CompleteMultipartUpload(c echo.Context) error {
	session, err := h.getStorageUploadSession(c.Request().Context(), strings.TrimSpace(c.Param("id")))
	if err != nil {
		return storageErrorResponse(c, err)
	}
	if err := authorizeMultipartSession(c, session); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
	}
	if session.Mode != "multipart" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "upload session is not multipart"})
	}
	if session.CompletedAt != nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": "multipart upload session is already complete"})
	}
	if time.Now().UTC().After(session.ExpiresAt) {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "upload session expired"})
	}

	bucket, err := h.getBucket(c.Request().Context(), session.BucketName)
	if err != nil {
		return storageErrorResponse(c, err)
	}
	if err := validateBucketUploadSize(bucket, session.Size); err != nil {
		return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"error": err.Error()})
	}
	if err := validateBucketTotalQuota(bucket, session.Size); err != nil {
		return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"error": err.Error()})
	}

	parts, err := h.listMultipartUploadParts(c.Request().Context(), session.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load multipart chunks: " + err.Error()})
	}
	totalParts := multipartTotalParts(session.Size, session.ChunkSizeBytes)
	if len(parts) != totalParts {
		return c.JSON(http.StatusConflict, map[string]string{"error": fmt.Sprintf("multipart upload is incomplete: expected %d parts, got %d", totalParts, len(parts))})
	}

	readers := make([]io.Reader, 0, len(parts))
	closers := make([]io.Closer, 0, len(parts))
	var combinedSize int64
	for index, part := range parts {
		expectedSize := multipartPartSize(session.Size, session.ChunkSizeBytes, index+1)
		if part.PartNumber != index+1 || part.Size != expectedSize {
			return c.JSON(http.StatusConflict, map[string]string{"error": "multipart upload parts are incomplete or out of order"})
		}
		reader, err := h.Storage.Download(c.Request().Context(), storageMultipartTempBucket, part.StorageKey)
		if err != nil {
			for _, closer := range closers {
				_ = closer.Close()
			}
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to read multipart chunk: " + err.Error()})
		}
		readers = append(readers, reader)
		closers = append(closers, reader)
		combinedSize += part.Size
	}
	defer func() {
		for _, closer := range closers {
			_ = closer.Close()
		}
	}()
	if combinedSize != session.Size {
		return c.JSON(http.StatusConflict, map[string]string{"error": "multipart upload size does not match the declared file size"})
	}

	commandTag, err := h.DB.Pool.Exec(c.Request().Context(), `
		UPDATE _v_storage_upload_sessions
		SET used_at = NOW(), completed_at = NOW()
		WHERE id = $1 AND completed_at IS NULL AND expires_at > NOW()
	`, session.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to finalize multipart session: " + err.Error()})
	}
	if commandTag.RowsAffected() == 0 {
		return c.JSON(http.StatusConflict, map[string]string{"error": "multipart upload session is no longer available"})
	}

	if err := h.Storage.Upload(c.Request().Context(), bucket.Name, session.StorageKey, io.MultiReader(readers...), session.Size, session.ContentType, storageObjectACL(bucket)); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to assemble multipart upload: " + err.Error()})
	}

	payload, err := h.createStoredObjectRecord(c.Request().Context(), bucket, session.OwnerID, session.Name, session.StorageKey, session.Size, session.ContentType)
	if err != nil {
		_ = h.Storage.Delete(c.Request().Context(), bucket.Name, session.StorageKey)
		return storageUploadMetadataError(c, err)
	}

	_ = h.deleteMultipartUploadParts(c.Request().Context(), session.ID, parts)
	_, _ = h.DB.Pool.Exec(c.Request().Context(), `DELETE FROM _v_storage_upload_sessions WHERE id = $1`, session.ID)
	return c.JSON(http.StatusCreated, payload)
}

// AbortMultipartUpload handles DELETE /api/files/uploads/multipart/:id
func (h *FileHandler) AbortMultipartUpload(c echo.Context) error {
	session, err := h.getStorageUploadSession(c.Request().Context(), strings.TrimSpace(c.Param("id")))
	if err != nil {
		return storageErrorResponse(c, err)
	}
	if err := authorizeMultipartSession(c, session); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
	}
	if session.Mode != "multipart" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "upload session is not multipart"})
	}

	parts, err := h.listMultipartUploadParts(c.Request().Context(), session.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load multipart chunks: " + err.Error()})
	}
	_ = h.deleteMultipartUploadParts(c.Request().Context(), session.ID, parts)
	_, _ = h.DB.Pool.Exec(c.Request().Context(), `DELETE FROM _v_storage_upload_sessions WHERE id = $1`, session.ID)

	return c.JSON(http.StatusOK, map[string]any{
		"session_id":    session.ID,
		"deleted_parts": len(parts),
		"message":       "Multipart upload aborted",
	})
}

// UploadStream handles PUT /api/files/uploads
func (h *FileHandler) UploadStream(c echo.Context) error {
	token := strings.TrimSpace(c.Request().Header.Get("X-Ozy-Upload-Token"))
	if token == "" {
		token = strings.TrimSpace(c.QueryParam("token"))
	}
	if token == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Upload token is required"})
	}

	claims, err := validateStorageUploadToken(h.UploadKey, token, time.Now().UTC())
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Upload token is invalid or expired"})
	}

	session, err := h.getStorageUploadSession(c.Request().Context(), claims.SessionID)
	if err != nil {
		return storageErrorResponse(c, err)
	}
	if session.UsedAt != nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": "Upload session was already used"})
	}
	if time.Now().UTC().After(session.ExpiresAt) {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Upload session expired"})
	}

	bucket, err := h.getBucket(c.Request().Context(), session.BucketName)
	if err != nil {
		return storageErrorResponse(c, err)
	}
	if err := validateBucketUploadSize(bucket, session.Size); err != nil {
		return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"error": err.Error()})
	}
	if err := validateBucketTotalQuota(bucket, session.Size); err != nil {
		return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"error": err.Error()})
	}

	contentLength := c.Request().ContentLength
	if contentLength >= 0 && contentLength != session.Size {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("Content length mismatch: expected %d bytes, got %d", session.Size, contentLength),
		})
	}

	if err := h.ensureUploadObjectDoesNotExist(c.Request().Context(), session); err != nil {
		return storageUploadMetadataError(c, err)
	}

	commandTag, err := h.DB.Pool.Exec(c.Request().Context(), `
		UPDATE _v_storage_upload_sessions
		SET used_at = NOW()
		WHERE id = $1 AND used_at IS NULL AND expires_at > NOW()
	`, session.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to claim upload session: " + err.Error()})
	}
	if commandTag.RowsAffected() == 0 {
		return c.JSON(http.StatusConflict, map[string]string{"error": "Upload session is no longer available"})
	}

	if err := h.Storage.Upload(c.Request().Context(), bucket.Name, session.StorageKey, c.Request().Body, session.Size, session.ContentType, storageObjectACL(bucket)); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to stream file into storage: " + err.Error()})
	}

	payload, err := h.createStoredObjectRecord(c.Request().Context(), bucket, session.OwnerID, session.Name, session.StorageKey, session.Size, session.ContentType)
	if err != nil {
		_ = h.Storage.Delete(c.Request().Context(), bucket.Name, session.StorageKey)
		return storageUploadMetadataError(c, err)
	}

	_, _ = h.DB.Pool.Exec(c.Request().Context(), `DELETE FROM _v_storage_upload_sessions WHERE id = $1`, session.ID)
	return c.JSON(http.StatusCreated, payload)
}

// List handles GET /api/files
func (h *FileHandler) List(c echo.Context) error {
	bucketName := normalizeBucketName(c.QueryParam("bucket"))
	bucket, err := h.getBucket(c.Request().Context(), bucketName)
	if err != nil {
		return storageErrorResponse(c, err)
	}

	ownerFilter, err := h.authorizeBucket(c, bucket, storageActionRead)
	if err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
	}

	query := `
		SELECT id, name, size, content_type, path, created_at
		FROM _v_storage_objects
		WHERE bucket_id = $1
	`
	args := []any{bucket.ID}
	if ownerFilter != "" {
		query += ` AND owner_id = $2`
		args = append(args, ownerFilter)
	}
	query += ` ORDER BY created_at DESC, name ASC`

	rows, err := h.DB.Pool.Query(c.Request().Context(), query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	files := make([]map[string]any, 0)
	for rows.Next() {
		var object storedObject
		if err := rows.Scan(&object.ID, &object.Name, &object.Size, &object.ContentType, &object.StoragePath, &object.CreatedAt); err != nil {
			continue
		}

		storageKey, _ := resolveObjectStorageKey(bucket.Name, object.StoragePath)
		downloadURL := buildObjectURL(bucket.Name, storageKey)
		files = append(files, map[string]any{
			"id":           object.ID,
			"name":         object.Name,
			"size":         object.Size,
			"content_type": object.ContentType,
			"path":         downloadURL,
			"download_url": downloadURL,
			"storage_key":  storageKey,
			"created_at":   object.CreatedAt,
		})
	}

	return c.JSON(http.StatusOK, files)
}

// Download handles GET /api/files/:bucket/*
func (h *FileHandler) Download(c echo.Context) error {
	bucketName := normalizeBucketName(c.Param("bucket"))
	objectKey := strings.TrimSpace(c.Param("*"))
	if objectKey == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Object key is required"})
	}

	bucket, err := h.getBucket(c.Request().Context(), bucketName)
	if err != nil {
		return storageErrorResponse(c, err)
	}

	ownerFilter, err := h.authorizeBucket(c, bucket, storageActionRead)
	if err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
	}

	object, err := h.findObject(c.Request().Context(), bucket, objectKey, ownerFilter)
	if err != nil {
		return storageErrorResponse(c, err)
	}

	reader, err := h.openObject(c.Request().Context(), bucket.Name, object.StoragePath)
	if err != nil {
		return storageErrorResponse(c, err)
	}
	defer reader.Close()

	contentType := strings.TrimSpace(object.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	if bucket.Public && !bucket.RLSEnabled {
		c.Response().Header().Set("Cache-Control", "public, max-age=300")
	} else {
		c.Response().Header().Set("Cache-Control", "private, no-store")
	}
	c.Response().Header().Set(echo.HeaderContentType, contentType)
	c.Response().Header().Set(echo.HeaderContentLength, strconv.FormatInt(object.Size, 10))
	c.Response().Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, escapeContentDispositionFilename(object.Name)))

	return c.Stream(http.StatusOK, contentType, reader)
}

// DeleteObject handles DELETE /api/files/:bucket/*
func (h *FileHandler) DeleteObject(c echo.Context) error {
	bucketName := normalizeBucketName(c.Param("bucket"))
	objectKey := strings.TrimSpace(c.Param("*"))
	if objectKey == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Object key is required"})
	}

	bucket, err := h.getBucket(c.Request().Context(), bucketName)
	if err != nil {
		return storageErrorResponse(c, err)
	}

	ownerFilter, err := h.authorizeBucket(c, bucket, storageActionWrite)
	if err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
	}

	object, err := h.findObject(c.Request().Context(), bucket, objectKey, ownerFilter)
	if err != nil {
		return storageErrorResponse(c, err)
	}

	if err := h.deleteStoredObject(c.Request().Context(), bucket.Name, object.StoragePath); err != nil {
		return storageErrorResponse(c, err)
	}

	commandTag, err := h.DB.Pool.Exec(c.Request().Context(), `
		DELETE FROM _v_storage_objects
		WHERE id = $1
	`, object.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete object metadata: " + err.Error()})
	}
	if commandTag.RowsAffected() == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Object not found"})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "Object deleted"})
}

// ListBuckets handles GET /api/files/buckets
func (h *FileHandler) ListBuckets(c echo.Context) error {
	if err := h.ensureDefaultBucket(c.Request().Context()); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	rows, err := h.DB.Pool.Query(c.Request().Context(), `
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
		GROUP BY b.id, b.name, b.public, b.rls_enabled, b.rls_rule, b.max_file_size_bytes, b.max_total_size_bytes, b.lifecycle_delete_after_days, b.created_at
		ORDER BY b.created_at ASC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	buckets := make([]map[string]any, 0)
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
			continue
		}
		buckets = append(buckets, serializeBucket(bucket))
	}

	return c.JSON(http.StatusOK, buckets)
}

// GetBucket handles GET /api/files/buckets/:name
func (h *FileHandler) GetBucket(c echo.Context) error {
	bucket, err := h.getBucket(c.Request().Context(), normalizeBucketName(c.Param("name")))
	if err != nil {
		return storageErrorResponse(c, err)
	}
	return c.JSON(http.StatusOK, serializeBucket(bucket))
}

// CreateBucket handles POST /api/files/buckets
func (h *FileHandler) CreateBucket(c echo.Context) error {
	var req struct {
		Name                     string `json:"name"`
		Public                   bool   `json:"public"`
		RLSEnabled               bool   `json:"rls_enabled"`
		RLSRule                  string `json:"rls_rule"`
		MaxFileSizeBytes         int64  `json:"max_file_size_bytes"`
		MaxTotalSizeBytes        int64  `json:"max_total_size_bytes"`
		LifecycleDeleteAfterDays int    `json:"lifecycle_delete_after_days"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	req.Name = normalizeBucketName(req.Name)
	if err := validateBucketName(req.Name); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	req.RLSRule = normalizeRLSRule(req.RLSEnabled, req.RLSRule)
	if req.MaxFileSizeBytes < 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "max_file_size_bytes must be zero or greater"})
	}
	if req.MaxTotalSizeBytes < 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "max_total_size_bytes must be zero or greater"})
	}
	if req.LifecycleDeleteAfterDays < 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "lifecycle_delete_after_days must be zero or greater"})
	}

	var bucket bucketRecord
	err := h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_buckets (name, public, rls_enabled, rls_rule, max_file_size_bytes, max_total_size_bytes, lifecycle_delete_after_days)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, name, public, rls_enabled, rls_rule, max_file_size_bytes, max_total_size_bytes, lifecycle_delete_after_days, created_at
	`, req.Name, req.Public, req.RLSEnabled, req.RLSRule, req.MaxFileSizeBytes, req.MaxTotalSizeBytes, req.LifecycleDeleteAfterDays).Scan(
		&bucket.ID,
		&bucket.Name,
		&bucket.Public,
		&bucket.RLSEnabled,
		&bucket.RLSRule,
		&bucket.MaxFileSizeBytes,
		&bucket.MaxTotalSizeBytes,
		&bucket.LifecycleDeleteAfterDays,
		&bucket.CreatedAt,
	)
	if err != nil {
		if isDuplicateConstraintError(err) {
			return c.JSON(http.StatusConflict, map[string]string{"error": "Bucket already exists"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create bucket: " + err.Error()})
	}

	return c.JSON(http.StatusCreated, serializeBucket(bucket))
}

// UpdateBucket handles PATCH /api/files/buckets/:name
func (h *FileHandler) UpdateBucket(c echo.Context) error {
	bucket, err := h.getBucket(c.Request().Context(), normalizeBucketName(c.Param("name")))
	if err != nil {
		return storageErrorResponse(c, err)
	}

	var req struct {
		Public                   *bool   `json:"public"`
		RLSEnabled               *bool   `json:"rls_enabled"`
		RLSRule                  *string `json:"rls_rule"`
		MaxFileSizeBytes         *int64  `json:"max_file_size_bytes"`
		MaxTotalSizeBytes        *int64  `json:"max_total_size_bytes"`
		LifecycleDeleteAfterDays *int    `json:"lifecycle_delete_after_days"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	if req.Public == nil && req.RLSEnabled == nil && req.RLSRule == nil && req.MaxFileSizeBytes == nil && req.MaxTotalSizeBytes == nil && req.LifecycleDeleteAfterDays == nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "No bucket updates provided"})
	}

	publicValue := bucket.Public
	if req.Public != nil {
		publicValue = *req.Public
	}

	rlsEnabledValue := bucket.RLSEnabled
	if req.RLSEnabled != nil {
		rlsEnabledValue = *req.RLSEnabled
	}

	rlsRuleValue := bucket.RLSRule
	if req.RLSRule != nil {
		rlsRuleValue = *req.RLSRule
	}
	rlsRuleValue = normalizeRLSRule(rlsEnabledValue, rlsRuleValue)

	maxFileSizeBytes := bucket.MaxFileSizeBytes
	if req.MaxFileSizeBytes != nil {
		if *req.MaxFileSizeBytes < 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "max_file_size_bytes must be zero or greater"})
		}
		maxFileSizeBytes = *req.MaxFileSizeBytes
	}
	maxTotalSizeBytes := bucket.MaxTotalSizeBytes
	if req.MaxTotalSizeBytes != nil {
		if *req.MaxTotalSizeBytes < 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "max_total_size_bytes must be zero or greater"})
		}
		maxTotalSizeBytes = *req.MaxTotalSizeBytes
	}
	lifecycleDeleteAfterDays := bucket.LifecycleDeleteAfterDays
	if req.LifecycleDeleteAfterDays != nil {
		if *req.LifecycleDeleteAfterDays < 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "lifecycle_delete_after_days must be zero or greater"})
		}
		lifecycleDeleteAfterDays = *req.LifecycleDeleteAfterDays
	}

	err = h.DB.Pool.QueryRow(c.Request().Context(), `
		UPDATE _v_buckets
		SET public = $2, rls_enabled = $3, rls_rule = $4, max_file_size_bytes = $5, max_total_size_bytes = $6, lifecycle_delete_after_days = $7, updated_at = NOW()
		WHERE id = $1
		RETURNING id, name, public, rls_enabled, rls_rule, max_file_size_bytes, max_total_size_bytes, lifecycle_delete_after_days, created_at
	`, bucket.ID, publicValue, rlsEnabledValue, rlsRuleValue, maxFileSizeBytes, maxTotalSizeBytes, lifecycleDeleteAfterDays).Scan(
		&bucket.ID,
		&bucket.Name,
		&bucket.Public,
		&bucket.RLSEnabled,
		&bucket.RLSRule,
		&bucket.MaxFileSizeBytes,
		&bucket.MaxTotalSizeBytes,
		&bucket.LifecycleDeleteAfterDays,
		&bucket.CreatedAt,
	)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update bucket: " + err.Error()})
	}

	return c.JSON(http.StatusOK, serializeBucket(bucket))
}

// DeleteBucket handles DELETE /api/files/buckets/:name
func (h *FileHandler) DeleteBucket(c echo.Context) error {
	bucketName := normalizeBucketName(c.Param("name"))
	if bucketName == "default" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "The default bucket cannot be deleted"})
	}

	bucket, err := h.getBucket(c.Request().Context(), bucketName)
	if err != nil {
		return storageErrorResponse(c, err)
	}

	rows, err := h.DB.Pool.Query(c.Request().Context(), `
		SELECT id, name, size, content_type, path, created_at
		FROM _v_storage_objects
		WHERE bucket_id = $1
	`, bucket.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load bucket objects: " + err.Error()})
	}
	defer rows.Close()

	objects := make([]storedObject, 0)
	for rows.Next() {
		var object storedObject
		if err := rows.Scan(&object.ID, &object.Name, &object.Size, &object.ContentType, &object.StoragePath, &object.CreatedAt); err == nil {
			objects = append(objects, object)
		}
	}

	for _, object := range objects {
		if err := h.deleteStoredObject(c.Request().Context(), bucket.Name, object.StoragePath); err != nil {
			return storageErrorResponse(c, err)
		}
	}

	commandTag, err := h.DB.Pool.Exec(c.Request().Context(), `
		DELETE FROM _v_buckets
		WHERE id = $1
	`, bucket.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to delete bucket: " + err.Error()})
	}
	if commandTag.RowsAffected() == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Bucket not found"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"message":       "Bucket deleted",
		"deleted_files": len(objects),
	})
}

func (h *FileHandler) authorizeBucket(c echo.Context, bucket bucketRecord, action storageAction) (string, error) {
	if isPrivilegedStorageRequest(c) {
		return "", nil
	}

	userID, _ := c.Get("user_id").(string)
	role, _ := c.Get("role").(string)

	switch action {
	case storageActionAdmin:
		if userID == "" {
			return "", fmt.Errorf("authentication required")
		}
	case storageActionRead:
		if !bucket.Public && userID == "" {
			return "", fmt.Errorf("authentication required")
		}
	case storageActionWrite:
		if userID == "" {
			return "", fmt.Errorf("authentication required")
		}
	}

	if !bucket.RLSEnabled {
		return "", nil
	}

	rule := strings.TrimSpace(bucket.RLSRule)
	switch rule {
	case "", "true":
		return "", nil
	case "false":
		return "", fmt.Errorf("access denied by policy")
	case defaultBucketRLSRule:
		if userID == "" {
			return "", fmt.Errorf("policy requires authentication")
		}
		if _, err := uuid.Parse(userID); err != nil {
			return "", fmt.Errorf("policy requires a valid authenticated user")
		}
		return userID, nil
	case "auth.role() = 'admin'":
		if role != "admin" {
			return "", fmt.Errorf("policy requires admin role")
		}
		return "", nil
	default:
		if strings.Contains(rule, defaultBucketRLSRule) {
			if userID == "" {
				return "", fmt.Errorf("policy requires authentication")
			}
			if _, err := uuid.Parse(userID); err != nil {
				return "", fmt.Errorf("policy requires a valid authenticated user")
			}
			return userID, nil
		}
		if strings.Contains(rule, "auth.role() = 'admin'") {
			if role != "admin" {
				return "", fmt.Errorf("policy requires admin role")
			}
			return "", nil
		}
		return "", fmt.Errorf("unsupported bucket policy")
	}
}

func (h *FileHandler) getBucket(ctx context.Context, bucketName string) (bucketRecord, error) {
	bucketName = normalizeBucketName(bucketName)
	if bucketName == "default" {
		if err := h.ensureDefaultBucket(ctx); err != nil {
			return bucketRecord{}, err
		}
	}

	var bucket bucketRecord
	err := h.DB.Pool.QueryRow(ctx, `
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
		WHERE b.name = $1
		GROUP BY b.id, b.name, b.public, b.rls_enabled, b.rls_rule, b.max_file_size_bytes, b.max_total_size_bytes, b.lifecycle_delete_after_days, b.created_at
	`, bucketName).Scan(
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
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return bucketRecord{}, fmt.Errorf("bucket not found")
		}
		return bucketRecord{}, err
	}

	return bucket, nil
}

func (h *FileHandler) ensureDefaultBucket(ctx context.Context) error {
	_, err := h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_buckets (name, public, rls_enabled, rls_rule, max_file_size_bytes, max_total_size_bytes, lifecycle_delete_after_days)
		VALUES ('default', true, false, 'true', 0, 0, 0)
		ON CONFLICT (name) DO UPDATE
		SET
			public = EXCLUDED.public,
			rls_enabled = EXCLUDED.rls_enabled,
			rls_rule = EXCLUDED.rls_rule,
			max_file_size_bytes = EXCLUDED.max_file_size_bytes,
			max_total_size_bytes = EXCLUDED.max_total_size_bytes,
			lifecycle_delete_after_days = EXCLUDED.lifecycle_delete_after_days,
			updated_at = NOW()
		WHERE
			_v_buckets.name = 'default'
			AND _v_buckets.public = true
			AND _v_buckets.rls_enabled = true
			AND _v_buckets.rls_rule = $1
	`, defaultBucketRLSRule)
	return err
}

func (h *FileHandler) findObject(ctx context.Context, bucket bucketRecord, objectKey, ownerFilter string) (storedObject, error) {
	objectKey = strings.TrimSpace(objectKey)
	query := `
		SELECT id, name, size, content_type, path, created_at
		FROM _v_storage_objects
		WHERE bucket_id = $1
			AND (
				path = $2
				OR path = $3
				OR path = $4
				OR path = $5
				OR name = $6
			)
	`
	args := []any{
		bucket.ID,
		objectKey,
		bucket.Name + "/" + objectKey,
		buildObjectURL(bucket.Name, objectKey),
		"/api/files/" + objectKey,
		objectKey,
	}
	if ownerFilter != "" {
		query += ` AND owner_id = $7`
		args = append(args, ownerFilter)
	}
	query += ` ORDER BY created_at DESC LIMIT 1`

	var object storedObject
	err := h.DB.Pool.QueryRow(ctx, query, args...).Scan(
		&object.ID,
		&object.Name,
		&object.Size,
		&object.ContentType,
		&object.StoragePath,
		&object.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return storedObject{}, fmt.Errorf("object not found")
		}
		return storedObject{}, err
	}

	return object, nil
}

func (h *FileHandler) openObject(ctx context.Context, bucketName, storedPath string) (io.ReadCloser, error) {
	objectKey, isLegacy := resolveObjectStorageKey(bucketName, storedPath)
	if objectKey == "" {
		return nil, fmt.Errorf("object not found")
	}
	if isLegacy {
		return os.Open(filepath.Join(h.StorageDir, filepath.Base(objectKey)))
	}
	return h.Storage.Download(ctx, bucketName, objectKey)
}

func (h *FileHandler) deleteStoredObject(ctx context.Context, bucketName, storedPath string) error {
	objectKey, isLegacy := resolveObjectStorageKey(bucketName, storedPath)
	if objectKey == "" {
		return fmt.Errorf("object not found")
	}
	if isLegacy {
		err := os.Remove(filepath.Join(h.StorageDir, filepath.Base(objectKey)))
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	err := h.Storage.Delete(ctx, bucketName, objectKey)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func storageObjectACL(bucket bucketRecord) ozystorage.ACL {
	objectACL := ozystorage.ACLPrivate
	if bucket.Public && !bucket.RLSEnabled {
		objectACL = ozystorage.ACLPublicRead
	} else if bucket.RLSEnabled {
		objectACL = ozystorage.ACLAuthRead
	}
	return objectACL
}

func (h *FileHandler) createStoredObjectRecord(ctx context.Context, bucket bucketRecord, ownerID *string, displayName, objectKey string, size int64, contentType string) (map[string]any, error) {
	var objectID string
	err := h.DB.Pool.QueryRow(ctx, `
		INSERT INTO _v_storage_objects (bucket_id, owner_id, name, size, content_type, path)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, bucket.ID, ownerID, displayName, size, contentType, objectKey).Scan(&objectID)
	if err != nil {
		return nil, err
	}
	return buildStoredObjectPayload(bucket.Name, objectID, displayName, objectKey, size, contentType), nil
}

func buildStoredObjectPayload(bucketName, objectID, displayName, objectKey string, size int64, contentType string) map[string]any {
	downloadURL := buildObjectURL(bucketName, objectKey)
	return map[string]any{
		"id":           objectID,
		"name":         displayName,
		"filename":     displayName,
		"size":         size,
		"storage_key":  objectKey,
		"content_type": contentType,
		"url":          downloadURL,
		"path":         downloadURL,
		"download_url": downloadURL,
	}
}

func validateBucketUploadSize(bucket bucketRecord, size int64) error {
	if size < 0 {
		return fmt.Errorf("file size must be zero or greater")
	}
	if bucket.MaxFileSizeBytes > 0 && size > bucket.MaxFileSizeBytes {
		return fmt.Errorf("file exceeds bucket limit of %s", humanizeBytes(bucket.MaxFileSizeBytes))
	}
	return nil
}

func validateBucketTotalQuota(bucket bucketRecord, incomingSize int64) error {
	if incomingSize < 0 {
		return fmt.Errorf("file size must be zero or greater")
	}
	if bucket.MaxTotalSizeBytes > 0 && bucket.TotalSize+incomingSize > bucket.MaxTotalSizeBytes {
		return fmt.Errorf("bucket exceeds total quota of %s", humanizeBytes(bucket.MaxTotalSizeBytes))
	}
	return nil
}

func bucketUsageRatio(bucket bucketRecord) float64 {
	if bucket.MaxTotalSizeBytes <= 0 {
		return 0
	}
	ratio := (float64(bucket.TotalSize) / float64(bucket.MaxTotalSizeBytes)) * 100
	if ratio < 0 {
		return 0
	}
	if ratio > 100 {
		return 100
	}
	return ratio
}

func humanizeBytes(bytes int64) string {
	if bytes <= 0 {
		return "0 B"
	}
	units := []string{"B", "KB", "MB", "GB", "TB"}
	value := float64(bytes)
	unitIndex := 0
	for value >= 1024 && unitIndex < len(units)-1 {
		value /= 1024
		unitIndex++
	}
	if value >= 100 || unitIndex == 0 {
		return fmt.Sprintf("%.0f %s", value, units[unitIndex])
	}
	return fmt.Sprintf("%.1f %s", value, units[unitIndex])
}

func storageUploadMetadataError(c echo.Context, err error) error {
	if isDuplicateConstraintError(err) {
		return c.JSON(http.StatusConflict, map[string]string{"error": "A file with this name already exists in the bucket"})
	}
	if strings.Contains(strings.ToLower(err.Error()), "already exists") {
		return c.JSON(http.StatusConflict, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusInternalServerError, map[string]string{
		"error": "Failed to save file metadata: " + err.Error(),
	})
}

func issueStorageUploadToken(secret, sessionID string, now time.Time, expiresAt time.Time) (string, error) {
	if strings.TrimSpace(secret) == "" {
		return "", errors.New("upload signing key is required")
	}
	claims := storageUploadClaims{
		SessionID: sessionID,
		Scope:     "storage-upload",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   sessionID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func validateStorageUploadToken(secret, tokenString string, now time.Time) (storageUploadClaims, error) {
	claims := storageUploadClaims{}
	if strings.TrimSpace(secret) == "" {
		return claims, errors.New("upload signing key is required")
	}
	token, err := jwt.ParseWithClaims(tokenString, &claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method %v", token.Header["alg"])
		}
		return []byte(secret), nil
	}, jwt.WithTimeFunc(func() time.Time { return now }))
	if err != nil {
		return claims, err
	}
	if !token.Valid {
		return claims, errors.New("upload token is invalid")
	}
	if claims.Scope != "storage-upload" {
		return claims, errors.New("upload token scope is invalid")
	}
	if strings.TrimSpace(claims.SessionID) == "" {
		return claims, errors.New("upload token session is missing")
	}
	return claims, nil
}

func (h *FileHandler) getStorageUploadSession(ctx context.Context, sessionID string) (storageUploadSession, error) {
	var session storageUploadSession
	var ownerID string
	err := h.DB.Pool.QueryRow(ctx, `
		SELECT
			s.id,
			s.bucket_id,
			b.name,
			COALESCE(s.owner_id::text, ''),
			s.name,
			s.size,
			s.content_type,
			s.storage_key,
			s.mode,
			s.chunk_size_bytes,
			s.expires_at,
			s.used_at,
			s.completed_at
		FROM _v_storage_upload_sessions s
		JOIN _v_buckets b ON b.id = s.bucket_id
		WHERE s.id = $1
	`, sessionID).Scan(
		&session.ID,
		&session.BucketID,
		&session.BucketName,
		&ownerID,
		&session.Name,
		&session.Size,
		&session.ContentType,
		&session.StorageKey,
		&session.Mode,
		&session.ChunkSizeBytes,
		&session.ExpiresAt,
		&session.UsedAt,
		&session.CompletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return storageUploadSession{}, fmt.Errorf("upload session not found")
		}
		return storageUploadSession{}, err
	}
	if strings.TrimSpace(ownerID) != "" {
		session.OwnerID = &ownerID
	}
	return session, nil
}

func authorizeMultipartSession(c echo.Context, session storageUploadSession) error {
	if isPrivilegedStorageRequest(c) {
		return nil
	}
	userID, _ := c.Get("user_id").(string)
	if strings.TrimSpace(userID) == "" {
		return fmt.Errorf("authentication required")
	}
	if session.OwnerID == nil {
		return fmt.Errorf("upload session belongs to a privileged actor")
	}
	if strings.TrimSpace(*session.OwnerID) != strings.TrimSpace(userID) {
		return fmt.Errorf("upload session belongs to another user")
	}
	return nil
}

func multipartTotalParts(totalSize, chunkSize int64) int {
	if totalSize <= 0 || chunkSize <= 0 {
		return 1
	}
	return int((totalSize + chunkSize - 1) / chunkSize)
}

func multipartPartSize(totalSize, chunkSize int64, partNumber int) int64 {
	if chunkSize <= 0 || partNumber < 1 {
		return 0
	}
	start := int64(partNumber-1) * chunkSize
	if start >= totalSize {
		return 0
	}
	remaining := totalSize - start
	if remaining < chunkSize {
		return remaining
	}
	return chunkSize
}

func multipartPartStorageKey(sessionID string, partNumber int) string {
	return fmt.Sprintf("%s/part-%06d", strings.TrimSpace(sessionID), partNumber)
}

func recommendedMultipartChunkSize(totalSize int64) int64 {
	switch {
	case totalSize >= 4*1024*1024*1024:
		return storageMultipartThreshold
	case totalSize >= 1024*1024*1024:
		return 32 * 1024 * 1024
	case totalSize >= 256*1024*1024:
		return 16 * 1024 * 1024
	default:
		return storageMultipartChunkSize
	}
}

func multipartSessionTTL(totalSize, chunkSize int64) time.Duration {
	if chunkSize <= 0 {
		chunkSize = recommendedMultipartChunkSize(totalSize)
	}
	ttl := storageUploadSessionTTL + time.Duration(multipartTotalParts(totalSize, chunkSize))*30*time.Second
	if ttl < storageMultipartMinSessionTTL {
		return storageMultipartMinSessionTTL
	}
	if ttl > storageMultipartMaxSessionTTL {
		return storageMultipartMaxSessionTTL
	}
	return ttl
}

func parseMultipartPartRequest(c echo.Context, session storageUploadSession) (int, int64, int, error) {
	partNumber, err := strconv.Atoi(strings.TrimSpace(c.Param("part")))
	if err != nil || partNumber < 1 {
		return 0, 0, 0, fmt.Errorf("part number must be a positive integer")
	}
	totalParts := multipartTotalParts(session.Size, session.ChunkSizeBytes)
	if partNumber > totalParts {
		return 0, 0, 0, fmt.Errorf("part number exceeds total parts (%d)", totalParts)
	}
	expectedSize := multipartPartSize(session.Size, session.ChunkSizeBytes, partNumber)
	if expectedSize <= 0 {
		return 0, 0, 0, fmt.Errorf("part number exceeds the expected file size")
	}
	return partNumber, expectedSize, totalParts, nil
}

func (h *FileHandler) listMultipartUploadParts(ctx context.Context, sessionID string) ([]storageUploadPart, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT part_number, size, storage_path
		FROM _v_storage_upload_session_parts
		WHERE session_id = $1
		ORDER BY part_number ASC
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	parts := make([]storageUploadPart, 0)
	for rows.Next() {
		var part storageUploadPart
		if err := rows.Scan(&part.PartNumber, &part.Size, &part.StorageKey); err != nil {
			return nil, err
		}
		parts = append(parts, part)
	}
	return parts, rows.Err()
}

func (h *FileHandler) deleteMultipartUploadParts(ctx context.Context, sessionID string, parts []storageUploadPart) error {
	for _, part := range parts {
		err := h.Storage.Delete(ctx, storageMultipartTempBucket, part.StorageKey)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	_, err := h.DB.Pool.Exec(ctx, `DELETE FROM _v_storage_upload_session_parts WHERE session_id = $1`, sessionID)
	return err
}

func (h *FileHandler) ensureUploadObjectDoesNotExist(ctx context.Context, session storageUploadSession) error {
	var existingID string
	err := h.DB.Pool.QueryRow(ctx, `
		SELECT id
		FROM _v_storage_objects
		WHERE bucket_id = $1
		  AND (name = $2 OR path = $3)
		LIMIT 1
	`, session.BucketID, session.Name, session.StorageKey).Scan(&existingID)
	if err == nil {
		return fmt.Errorf("A file with this name already exists in the bucket")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}

func serializeBucket(bucket bucketRecord) map[string]any {
	return map[string]any{
		"id":                          bucket.ID,
		"name":                        bucket.Name,
		"public":                      bucket.Public,
		"rls_enabled":                 bucket.RLSEnabled,
		"rls_rule":                    bucket.RLSRule,
		"max_file_size_bytes":         bucket.MaxFileSizeBytes,
		"max_total_size_bytes":        bucket.MaxTotalSizeBytes,
		"lifecycle_delete_after_days": bucket.LifecycleDeleteAfterDays,
		"usage_ratio_pct":             bucketUsageRatio(bucket),
		"created_at":                  bucket.CreatedAt,
		"object_count":                bucket.ObjectCount,
		"total_size":                  bucket.TotalSize,
	}
}

func normalizeBucketName(name string) string {
	trimmed := strings.TrimSpace(strings.ToLower(name))
	if trimmed == "" {
		return "default"
	}
	return trimmed
}

func validateBucketName(name string) error {
	if name == "" {
		return fmt.Errorf("Bucket name is required")
	}
	if !bucketNamePattern.MatchString(name) {
		return fmt.Errorf("Bucket names must be 3-63 chars and use lowercase letters, numbers, dots, dashes or underscores")
	}
	return nil
}

func normalizeRLSRule(enabled bool, rule string) string {
	if !enabled {
		return "true"
	}
	trimmed := strings.TrimSpace(rule)
	if trimmed == "" {
		return defaultBucketRLSRule
	}
	return trimmed
}

func cleanObjectName(name string) string {
	base := strings.TrimSpace(filepath.Base(name))
	if base == "" || base == "." {
		return "object"
	}
	return base
}

func buildObjectStorageKey(name string) string {
	base := cleanObjectName(name)
	var builder strings.Builder
	for _, char := range base {
		switch {
		case unicode.IsLetter(char), unicode.IsDigit(char):
			builder.WriteRune(unicode.ToLower(char))
		case char == '.', char == '-', char == '_':
			builder.WriteRune(char)
		default:
			builder.WriteRune('-')
		}
	}
	safeName := strings.Trim(builder.String(), "-.")
	if safeName == "" {
		safeName = "object"
	}
	return uuid.NewString() + "_" + safeName
}

func resolveObjectStorageKey(bucketName, storedPath string) (string, bool) {
	trimmed := strings.TrimSpace(storedPath)
	if trimmed == "" {
		return "", false
	}
	if strings.HasPrefix(trimmed, "/api/files/") {
		rest := strings.TrimPrefix(trimmed, "/api/files/")
		parts := strings.SplitN(rest, "/", 2)
		if len(parts) == 2 && parts[0] == bucketName {
			return parts[1], false
		}
		return path.Base(rest), true
	}
	if strings.HasPrefix(trimmed, bucketName+"/") {
		return strings.TrimPrefix(trimmed, bucketName+"/"), false
	}
	return trimmed, false
}

func buildObjectURL(bucketName, objectKey string) string {
	return "/api/files/" + bucketName + "/" + objectKey
}

func isPrivilegedStorageRequest(c echo.Context) bool {
	if role, ok := c.Get("role").(string); ok && role == "admin" {
		return true
	}
	if isServiceRole, ok := c.Get("is_service_role").(bool); ok && isServiceRole {
		return true
	}
	return false
}

func uuidPointerFromContext(c echo.Context) *string {
	userID, _ := c.Get("user_id").(string)
	if _, err := uuid.Parse(userID); err != nil {
		return nil
	}
	return &userID
}

func escapeContentDispositionFilename(name string) string {
	return strings.NewReplacer(`\`, `_`, `"`, `'`).Replace(name)
}

func isDuplicateConstraintError(err error) bool {
	return strings.Contains(strings.ToLower(err.Error()), "duplicate key")
}

func storageErrorResponse(c echo.Context, err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Resource not found"})
	case os.IsNotExist(err):
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Object not found"})
	case strings.Contains(strings.ToLower(err.Error()), "not found"):
		return c.JSON(http.StatusNotFound, map[string]string{"error": err.Error()})
	default:
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}
