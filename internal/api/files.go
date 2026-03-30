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
	"unicode"

	"github.com/Xangel0s/OzyBase/internal/data"
	ozystorage "github.com/Xangel0s/OzyBase/internal/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
)

const defaultBucketRLSRule = "auth.uid() = owner_id"

var bucketNamePattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9._-]{1,61}[a-z0-9])?$`)

type storageAction string

const (
	storageActionRead  storageAction = "read"
	storageActionWrite storageAction = "write"
	storageActionAdmin storageAction = "admin"
)

type bucketRecord struct {
	ID          string
	Name        string
	Public      bool
	RLSEnabled  bool
	RLSRule     string
	CreatedAt   any
	ObjectCount int64
	TotalSize   int64
}

type storedObject struct {
	ID          string
	Name        string
	Size        int64
	ContentType string
	StoragePath string
	CreatedAt   any
}

// FileHandler handles file uploads and storage policies.
type FileHandler struct {
	DB         *data.DB
	Storage    ozystorage.Provider
	StorageDir string
}

// NewFileHandler creates a new instance of FileHandler.
func NewFileHandler(db *data.DB, storageSvc ozystorage.Provider, storageDir string) *FileHandler {
	return &FileHandler{
		DB:         db,
		Storage:    storageSvc,
		StorageDir: storageDir,
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

	objectACL := ozystorage.ACLPrivate
	if bucket.Public && !bucket.RLSEnabled {
		objectACL = ozystorage.ACLPublicRead
	} else if bucket.RLSEnabled {
		objectACL = ozystorage.ACLAuthRead
	}

	if err := h.Storage.Upload(c.Request().Context(), bucket.Name, objectKey, source, fileHeader.Size, contentType, objectACL); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to store file: " + err.Error(),
		})
	}

	ownerID := uuidPointerFromContext(c)
	var objectID string
	err = h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_storage_objects (bucket_id, owner_id, name, size, content_type, path)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, bucket.ID, ownerID, displayName, fileHeader.Size, contentType, objectKey).Scan(&objectID)
	if err != nil {
		_ = h.Storage.Delete(c.Request().Context(), bucket.Name, objectKey)
		if isDuplicateConstraintError(err) {
			return c.JSON(http.StatusConflict, map[string]string{"error": "A file with this name already exists in the bucket"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to save file metadata: " + err.Error(),
		})
	}

	downloadURL := buildObjectURL(bucket.Name, objectKey)
	return c.JSON(http.StatusCreated, map[string]any{
		"id":           objectID,
		"name":         displayName,
		"filename":     displayName,
		"storage_key":  objectKey,
		"content_type": contentType,
		"url":          downloadURL,
		"path":         downloadURL,
		"download_url": downloadURL,
	})
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
			b.created_at,
			COUNT(o.id) AS object_count,
			COALESCE(SUM(o.size), 0) AS total_size
		FROM _v_buckets b
		LEFT JOIN _v_storage_objects o ON o.bucket_id = b.id
		GROUP BY b.id, b.name, b.public, b.rls_enabled, b.rls_rule, b.created_at
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
		Name       string `json:"name"`
		Public     bool   `json:"public"`
		RLSEnabled bool   `json:"rls_enabled"`
		RLSRule    string `json:"rls_rule"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	req.Name = normalizeBucketName(req.Name)
	if err := validateBucketName(req.Name); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	req.RLSRule = normalizeRLSRule(req.RLSEnabled, req.RLSRule)

	var bucket bucketRecord
	err := h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_buckets (name, public, rls_enabled, rls_rule)
		VALUES ($1, $2, $3, $4)
		RETURNING id, name, public, rls_enabled, rls_rule, created_at
	`, req.Name, req.Public, req.RLSEnabled, req.RLSRule).Scan(
		&bucket.ID,
		&bucket.Name,
		&bucket.Public,
		&bucket.RLSEnabled,
		&bucket.RLSRule,
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
		Public     *bool   `json:"public"`
		RLSEnabled *bool   `json:"rls_enabled"`
		RLSRule    *string `json:"rls_rule"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	if req.Public == nil && req.RLSEnabled == nil && req.RLSRule == nil {
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

	err = h.DB.Pool.QueryRow(c.Request().Context(), `
		UPDATE _v_buckets
		SET public = $2, rls_enabled = $3, rls_rule = $4, updated_at = NOW()
		WHERE id = $1
		RETURNING id, name, public, rls_enabled, rls_rule, created_at
	`, bucket.ID, publicValue, rlsEnabledValue, rlsRuleValue).Scan(
		&bucket.ID,
		&bucket.Name,
		&bucket.Public,
		&bucket.RLSEnabled,
		&bucket.RLSRule,
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
			b.created_at,
			COUNT(o.id) AS object_count,
			COALESCE(SUM(o.size), 0) AS total_size
		FROM _v_buckets b
		LEFT JOIN _v_storage_objects o ON o.bucket_id = b.id
		WHERE b.name = $1
		GROUP BY b.id, b.name, b.public, b.rls_enabled, b.rls_rule, b.created_at
	`, bucketName).Scan(
		&bucket.ID,
		&bucket.Name,
		&bucket.Public,
		&bucket.RLSEnabled,
		&bucket.RLSRule,
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
		INSERT INTO _v_buckets (name, public, rls_enabled, rls_rule)
		VALUES ('default', true, false, 'true')
		ON CONFLICT (name) DO UPDATE
		SET
			public = EXCLUDED.public,
			rls_enabled = EXCLUDED.rls_enabled,
			rls_rule = EXCLUDED.rls_rule,
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

func serializeBucket(bucket bucketRecord) map[string]any {
	return map[string]any{
		"id":           bucket.ID,
		"name":         bucket.Name,
		"public":       bucket.Public,
		"rls_enabled":  bucket.RLSEnabled,
		"rls_rule":     bucket.RLSRule,
		"created_at":   bucket.CreatedAt,
		"object_count": bucket.ObjectCount,
		"total_size":   bucket.TotalSize,
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
