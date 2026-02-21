package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
)

type APIKey struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Prefix      string     `json:"prefix"`
	Role        string     `json:"role"`
	IsActive    bool       `json:"is_active"`
	ExpiresAt   *time.Time `json:"expires_at"`
	CreatedAt   time.Time  `json:"created_at"`
	LastUsedAt  *time.Time `json:"last_used_at"`
	CreatedBy   string     `json:"created_by_user_id,omitempty"`
	WorkspaceID string     `json:"workspace_id,omitempty"`
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

var apiKeyNamePattern = regexp.MustCompile(`^[a-zA-Z0-9 _.-]{3,64}$`)

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

	query := `SELECT id, name, prefix, role, is_active, expires_at, created_at, last_used_at, workspace_id, created_by_user_id
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
		if err := rows.Scan(&k.ID, &k.Name, &k.Prefix, &k.Role, &k.IsActive, &k.ExpiresAt, &k.CreatedAt, &k.LastUsedAt, &workspaceID, &createdBy); err != nil {
			continue
		}
		if workspaceID != nil {
			k.WorkspaceID = *workspaceID
		}
		if createdBy != nil {
			k.CreatedBy = *createdBy
		}
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
	var req struct {
		Name          string `json:"name"`
		Role          string `json:"role"` // 'anon' or 'service_role'
		ExpiresInDays *int   `json:"expires_in_days,omitempty"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Role = strings.ToLower(strings.TrimSpace(req.Role))
	if req.Name == "" || !apiKeyNamePattern.MatchString(req.Name) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid key name"})
	}
	if req.Role != APIKeyRoleAnon && req.Role != APIKeyRoleServiceRole {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "role must be 'anon' or 'service_role'"})
	}
	defaultDays := 90
	if req.Role == APIKeyRoleAnon {
		defaultDays = 30
	}
	expiresInDays := defaultDays
	if req.ExpiresInDays != nil {
		if *req.ExpiresInDays < 1 || *req.ExpiresInDays > 365 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "expires_in_days must be between 1 and 365"})
		}
		expiresInDays = *req.ExpiresInDays
	}
	expiresAt := time.Now().UTC().Add(time.Duration(expiresInDays) * 24 * time.Hour)

	rawKey, err := GenerateRandomKey()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to generate key"})
	}

	// Format: ozy_prefix_secret
	prefix := "ozy_" + rawKey[:4]
	fullKey := fmt.Sprintf("%s_%s", prefix, rawKey)

	// Hash for storage (we use SHA256 for fast lookup, then bcrypt for final verification if needed,
	// but usually sha256 + prefix is enough for API keys if stored securely)
	hash := sha256.Sum256([]byte(fullKey))
	keyHash := hex.EncodeToString(hash[:])

	workspaceID, _ := c.Get("workspace_id").(string)
	var workspaceIDVal any
	if strings.TrimSpace(workspaceID) != "" {
		workspaceIDVal = workspaceID
	}
	actorUserID := actorUserIDFromContext(c)
	var actorUserIDVal any
	if actorUserID != nil {
		actorUserIDVal = *actorUserID
	}

	var id string
	err = h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_api_keys (name, key_hash, prefix, role, workspace_id, expires_at, created_by_user_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`, req.Name, keyHash, prefix, req.Role, workspaceIDVal, expiresAt, actorUserIDVal).Scan(&id)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	h.logAPIKeyEvent(c.Request().Context(), &id, &workspaceID, "create", actorUserID, map[string]any{
		"name":            req.Name,
		"role":            req.Role,
		"prefix":          prefix,
		"expires_at":      expiresAt.Format(time.RFC3339),
		"expires_in_days": expiresInDays,
	})

	return c.JSON(http.StatusCreated, map[string]any{
		"id":              id,
		"key":             fullKey,
		"name":            req.Name,
		"role":            req.Role,
		"expires_at":      expiresAt,
		"expires_in_days": expiresInDays,
		"warning":         "Copy this key now, it will not be shown again!",
	})
}

func (h *Handler) DeleteAPIKey(c echo.Context) error {
	id := c.Param("id")
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

	ctx := c.Request().Context()
	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to start transaction"})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var currentName, role, currentPrefix string
	var workspaceID *string
	var expiresAt *time.Time
	err = tx.QueryRow(ctx, `
		SELECT name, role, prefix, workspace_id, expires_at
		FROM _v_api_keys
		WHERE id = $1
		FOR UPDATE
	`, keyID).Scan(&currentName, &role, &currentPrefix, &workspaceID, &expiresAt)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "api key not found"})
	}

	rawKey, err := GenerateRandomKey()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to generate key"})
	}
	prefix := "ozy_" + rawKey[:4]
	fullKey := fmt.Sprintf("%s_%s", prefix, rawKey)
	hash := sha256.Sum256([]byte(fullKey))
	keyHash := hex.EncodeToString(hash[:])

	newName := fmt.Sprintf("%s (rotated %s)", currentName, time.Now().UTC().Format("2006-01-02"))
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
		INSERT INTO _v_api_keys (name, key_hash, prefix, role, workspace_id, expires_at, is_active, created_by_user_id)
		VALUES ($1, $2, $3, $4, $5, $6, true, $7)
		RETURNING id
	`, newName, keyHash, prefix, role, workspaceIDVal, expiresAt, actorUserIDVal).Scan(&newID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create rotated key"})
	}

	if _, err := tx.Exec(ctx, `UPDATE _v_api_keys SET is_active = false WHERE id = $1`, keyID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to deactivate previous key"})
	}

	detailsJSON, _ := json.Marshal(map[string]any{
		"old_id":     keyID,
		"new_id":     newID,
		"old_prefix": currentPrefix,
		"new_prefix": prefix,
		"old_name":   currentName,
		"new_name":   newName,
		"role":       role,
		"expires_at": expiresAt,
	})
	_, _ = tx.Exec(ctx, `
		INSERT INTO _v_api_key_events (api_key_id, workspace_id, action, actor_user_id, details)
		VALUES ($1, $2, 'rotate', $3, $4::jsonb)
	`, newID, workspaceIDVal, actorUserIDVal, string(detailsJSON))

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit key rotation"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"old_id":  keyID,
		"new_id":  newID,
		"key":     fullKey,
		"role":    role,
		"warning": "Rotation complete. Old key was deactivated. Copy this new key now.",
	})
}
