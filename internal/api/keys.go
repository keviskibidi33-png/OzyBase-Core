package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
)

type APIKey struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Prefix         string     `json:"prefix"`
	Role           string     `json:"role"`
	IsActive       bool       `json:"is_active"`
	ExpiresAt      *time.Time `json:"expires_at"`
	CreatedAt      time.Time  `json:"created_at"`
	LastUsedAt     *time.Time `json:"last_used_at"`
	CreatedBy      string     `json:"created_by_user_id,omitempty"`
	WorkspaceID    string     `json:"workspace_id,omitempty"`
	KeyGroupID     string     `json:"key_group_id,omitempty"`
	KeyVersion     int        `json:"key_version"`
	RotatedToKeyID string     `json:"rotated_to_key_id,omitempty"`
	GraceUntil     *time.Time `json:"grace_until,omitempty"`
	IsPrevious     bool       `json:"is_previous"`
}

type APIKeyEvent struct {
	ID          string         `json:"id"`
	APIKeyID    string         `json:"api_key_id,omitempty"`
	WorkspaceID string         `json:"workspace_id,omitempty"`
	Action      string         `json:"action"`
	ActorUserID string         `json:"actor_user_id,omitempty"`
	Details     map[string]any `json:"details"`
	CreatedAt   time.Time      `json:"created_at"`
}

const (
	APIKeyRoleAnon        = "anon"
	APIKeyRoleServiceRole = "service_role"
)

func defaultAPIKeyGraceMinutes() int {
	raw := strings.TrimSpace(os.Getenv("API_KEY_ROTATION_GRACE_MINUTES"))
	if raw == "" {
		return 15
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 15
	}
	if v < 0 {
		return 0
	}
	if v > 10080 {
		return 10080
	}
	return v
}

func actorUserIDFromContext(c echo.Context) *string {
	s, ok := c.Get("user_id").(string)
	if !ok {
		return nil
	}
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	if _, err := uuid.Parse(s); err != nil {
		return nil
	}
	return &s
}

func (h *Handler) logAPIKeyEvent(ctx context.Context, apiKeyID *string, workspaceID *string, action string, actorUserID *string, details map[string]any) {
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		return
	}

	var apiKeyIDVal any
	if apiKeyID != nil && strings.TrimSpace(*apiKeyID) != "" {
		apiKeyIDVal = *apiKeyID
	}
	var workspaceIDVal any
	if workspaceID != nil && strings.TrimSpace(*workspaceID) != "" {
		workspaceIDVal = *workspaceID
	}
	var actorIDVal any
	if actorUserID != nil && strings.TrimSpace(*actorUserID) != "" {
		actorIDVal = *actorUserID
	}

	_, _ = h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_api_key_events (api_key_id, workspace_id, action, actor_user_id, details)
		VALUES ($1, $2, $3, $4, $5::jsonb)
	`, apiKeyIDVal, workspaceIDVal, action, actorIDVal, string(detailsJSON))
}

// GenerateRandomKey creates a new random secure key
func GenerateRandomKey() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (h *Handler) ListAPIKeys(c echo.Context) error {
	workspaceID, _ := c.Get("workspace_id").(string)

	query := `SELECT id, name, prefix, role, is_active, expires_at, created_at, last_used_at, workspace_id, created_by_user_id, COALESCE(key_group_id::text, ''), key_version, COALESCE(rotated_to_key_id::text, ''), grace_until
		FROM _v_api_keys`

	var rows pgx.Rows
	var err error
	if workspaceID != "" {
		rows, err = h.DB.Pool.Query(c.Request().Context(), query+" WHERE workspace_id = $1 ORDER BY created_at DESC", workspaceID)
	} else {
		rows, err = h.DB.Pool.Query(c.Request().Context(), query+" ORDER BY created_at DESC")
	}

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var keys []APIKey
	for rows.Next() {
		var k APIKey
		var workspaceID *string
		var createdBy *string
		if err := rows.Scan(&k.ID, &k.Name, &k.Prefix, &k.Role, &k.IsActive, &k.ExpiresAt, &k.CreatedAt, &k.LastUsedAt, &workspaceID, &createdBy, &k.KeyGroupID, &k.KeyVersion, &k.RotatedToKeyID, &k.GraceUntil); err != nil {
			continue
		}
		if workspaceID != nil {
			k.WorkspaceID = *workspaceID
		}
		if createdBy != nil {
			k.CreatedBy = *createdBy
		}
		k.IsPrevious = strings.TrimSpace(k.RotatedToKeyID) != ""
		keys = append(keys, k)
	}
	return c.JSON(http.StatusOK, keys)
}

func (h *Handler) ListAPIKeyEvents(c echo.Context) error {
	workspaceID, _ := c.Get("workspace_id").(string)
	limit := 100
	if v := strings.TrimSpace(c.QueryParam("limit")); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 && parsed <= 500 {
			limit = parsed
		}
	}

	query := `
		SELECT id, COALESCE(api_key_id::text, ''), COALESCE(workspace_id::text, ''), action, COALESCE(actor_user_id::text, ''), details, created_at
		FROM _v_api_key_events
	`

	var rows pgx.Rows
	var err error
	if workspaceID != "" {
		rows, err = h.DB.Pool.Query(c.Request().Context(), query+" WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2", workspaceID, limit)
	} else {
		rows, err = h.DB.Pool.Query(c.Request().Context(), query+" ORDER BY created_at DESC LIMIT $1", limit)
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to list api key events"})
	}
	defer rows.Close()

	events := make([]APIKeyEvent, 0, limit)
	for rows.Next() {
		var e APIKeyEvent
		var detailsRaw []byte
		if scanErr := rows.Scan(&e.ID, &e.APIKeyID, &e.WorkspaceID, &e.Action, &e.ActorUserID, &detailsRaw, &e.CreatedAt); scanErr != nil {
			continue
		}
		_ = json.Unmarshal(detailsRaw, &e.Details)
		if e.Details == nil {
			e.Details = map[string]any{}
		}
		events = append(events, e)
	}

	return c.JSON(http.StatusOK, events)
}

func (h *Handler) CreateAPIKey(c echo.Context) error {
	return c.JSON(http.StatusForbidden, map[string]string{
		"error": "manual api key creation is disabled; use the essential key rotation flow instead",
	})
}

func (h *Handler) DeleteAPIKey(c echo.Context) error {
	id := c.Param("id")
	var managedKind string
	if err := h.DB.Pool.QueryRow(c.Request().Context(), `SELECT COALESCE(managed_kind, $2) FROM _v_api_keys WHERE id = $1`, id, apiKeyManagedKindCustom).Scan(&managedKind); err == nil {
		if managedKind == apiKeyManagedKindEssential {
			return c.JSON(http.StatusForbidden, map[string]string{"error": "essential api keys cannot be deleted"})
		}
	}
	var deletedID, deletedName, deletedPrefix string
	var workspaceID *string
	err := h.DB.Pool.QueryRow(c.Request().Context(), `
		DELETE FROM _v_api_keys
		WHERE id = $1
		RETURNING id, name, prefix, workspace_id
	`, id).Scan(&deletedID, &deletedName, &deletedPrefix, &workspaceID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "api key not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	actorUserID := actorUserIDFromContext(c)
	h.logAPIKeyEvent(c.Request().Context(), &deletedID, workspaceID, "delete", actorUserID, map[string]any{
		"name":   deletedName,
		"prefix": deletedPrefix,
	})

	return c.NoContent(http.StatusOK)
}

func (h *Handler) ToggleAPIKey(c echo.Context) error {
	id := c.Param("id")
	var req struct {
		Active bool `json:"active"`
	}
	if err := c.Bind(&req); err != nil {
		return err
	}
	var managedKind string
	if err := h.DB.Pool.QueryRow(c.Request().Context(), `SELECT COALESCE(managed_kind, $2) FROM _v_api_keys WHERE id = $1`, id, apiKeyManagedKindCustom).Scan(&managedKind); err == nil {
		if managedKind == apiKeyManagedKindEssential {
			return c.JSON(http.StatusForbidden, map[string]string{"error": "essential api keys cannot be toggled"})
		}
	}

	var updatedID, updatedName, updatedPrefix string
	var workspaceID *string
	err := h.DB.Pool.QueryRow(c.Request().Context(), `
		UPDATE _v_api_keys
		SET is_active = $1
		WHERE id = $2
		RETURNING id, name, prefix, workspace_id
	`, req.Active, id).Scan(&updatedID, &updatedName, &updatedPrefix, &workspaceID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "api key not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	actorUserID := actorUserIDFromContext(c)
	h.logAPIKeyEvent(c.Request().Context(), &updatedID, workspaceID, "toggle", actorUserID, map[string]any{
		"name":   updatedName,
		"prefix": updatedPrefix,
		"active": req.Active,
	})

	return c.JSON(http.StatusOK, map[string]string{"status": "updated"})
}

func (h *Handler) RotateAPIKey(c echo.Context) error {
	keyID := strings.TrimSpace(c.Param("id"))
	if keyID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "key id is required"})
	}
	var req struct {
		GraceMinutes *int   `json:"grace_minutes"`
		Reason       string `json:"reason"`
	}
	if c.Request().ContentLength > 0 {
		if err := c.Bind(&req); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		}
	}
	graceMinutes := defaultAPIKeyGraceMinutes()
	if req.GraceMinutes != nil {
		if *req.GraceMinutes < 0 || *req.GraceMinutes > 10080 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "grace_minutes must be between 0 and 10080"})
		}
		graceMinutes = *req.GraceMinutes
	}
	rotationTime := time.Now().UTC()
	graceUntil := rotationTime
	if graceMinutes > 0 {
		graceUntil = rotationTime.Add(time.Duration(graceMinutes) * time.Minute)
	}

	ctx := c.Request().Context()
	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to start transaction"})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var currentName, role, currentPrefix, keyGroupID, rotatedToID, managedKind string
	var currentVersion int
	var isActive bool
	var revokedAt *time.Time
	var workspaceID *string
	var expiresAt *time.Time
	err = tx.QueryRow(ctx, `
		SELECT name, role, prefix, workspace_id, expires_at, COALESCE(key_group_id::text, ''), key_version, COALESCE(rotated_to_key_id::text, ''), is_active, revoked_at, COALESCE(managed_kind, $2)
		FROM _v_api_keys
		WHERE id = $1
		FOR UPDATE
	`, keyID, apiKeyManagedKindCustom).Scan(&currentName, &role, &currentPrefix, &workspaceID, &expiresAt, &keyGroupID, &currentVersion, &rotatedToID, &isActive, &revokedAt, &managedKind)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "api key not found"})
	}
	if managedKind == apiKeyManagedKindEssential {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "use the dedicated essential key rotation endpoint for this key"})
	}
	if !isActive {
		return c.JSON(http.StatusConflict, map[string]string{"error": "cannot rotate an inactive key"})
	}
	if strings.TrimSpace(rotatedToID) != "" {
		return c.JSON(http.StatusConflict, map[string]string{"error": "cannot rotate a previous key; rotate the active head key"})
	}
	if revokedAt != nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": "cannot rotate a revoked key"})
	}
	if expiresAt != nil && expiresAt.Before(rotationTime) {
		return c.JSON(http.StatusConflict, map[string]string{"error": "cannot rotate an expired key"})
	}
	if strings.TrimSpace(keyGroupID) == "" {
		keyGroupID = keyID
	}

	rawKey, err := GenerateRandomKey()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to generate key"})
	}
	prefix := "ozy_" + rawKey[:4]
	fullKey := fmt.Sprintf("%s_%s", prefix, rawKey)
	hash := sha256.Sum256([]byte(fullKey))
	keyHash := hex.EncodeToString(hash[:])

	newVersion := currentVersion + 1
	newName := fmt.Sprintf("%s (rotated %s)", currentName, rotationTime.Format("2006-01-02"))
	var newID string
	actorUserID := actorUserIDFromContext(c)
	var workspaceIDVal any
	if workspaceID != nil && strings.TrimSpace(*workspaceID) != "" {
		workspaceIDVal = *workspaceID
	}
	var actorUserIDVal any
	if actorUserID != nil {
		actorUserIDVal = *actorUserID
	}

	err = tx.QueryRow(ctx, `
		INSERT INTO _v_api_keys (name, key_hash, prefix, role, workspace_id, expires_at, is_active, created_by_user_id, key_group_id, key_version, valid_after)
		VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, NOW())
		RETURNING id
	`, newName, keyHash, prefix, role, workspaceIDVal, expiresAt, actorUserIDVal, keyGroupID, newVersion).Scan(&newID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create rotated key"})
	}

	previousStillActive := graceMinutes > 0
	if _, err := tx.Exec(ctx, `
		UPDATE _v_api_keys
		SET rotated_to_key_id = $2,
		    grace_until = $3,
		    is_active = $4
		WHERE id = $1
	`, keyID, newID, graceUntil, previousStillActive); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to update previous key state"})
	}

	detailsJSON, _ := json.Marshal(map[string]any{
		"old_id":        keyID,
		"new_id":        newID,
		"old_prefix":    currentPrefix,
		"new_prefix":    prefix,
		"old_name":      currentName,
		"new_name":      newName,
		"role":          role,
		"expires_at":    expiresAt,
		"key_group":     keyGroupID,
		"old_version":   currentVersion,
		"new_version":   newVersion,
		"grace_minutes": graceMinutes,
		"grace_until":   graceUntil.Format(time.RFC3339),
		"reason":        strings.TrimSpace(req.Reason),
	})
	_, _ = tx.Exec(ctx, `
		INSERT INTO _v_api_key_events (api_key_id, workspace_id, action, actor_user_id, details)
		VALUES ($1, $2, 'rotate', $3, $4::jsonb)
	`, newID, workspaceIDVal, actorUserIDVal, string(detailsJSON))

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit key rotation"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"old_id":          keyID,
		"new_id":          newID,
		"key":             fullKey,
		"role":            role,
		"key_group_id":    keyGroupID,
		"key_version":     newVersion,
		"grace_minutes":   graceMinutes,
		"grace_until":     graceUntil,
		"previous_active": previousStillActive,
		"warning":         "Rotation complete. Old key is accepted only during grace window. Copy this new key now.",
	})
}
