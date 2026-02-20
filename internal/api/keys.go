package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

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
	WorkspaceID string     `json:"workspace_id,omitempty"`
}

const (
	APIKeyRoleAnon        = "anon"
	APIKeyRoleServiceRole = "service_role"
)

var apiKeyNamePattern = regexp.MustCompile(`^[a-zA-Z0-9 _.-]{3,64}$`)

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

	query := `SELECT id, name, prefix, role, is_active, expires_at, created_at, last_used_at, workspace_id 
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
		if err := rows.Scan(&k.ID, &k.Name, &k.Prefix, &k.Role, &k.IsActive, &k.ExpiresAt, &k.CreatedAt, &k.LastUsedAt, &workspaceID); err != nil {
			continue
		}
		if workspaceID != nil {
			k.WorkspaceID = *workspaceID
		}
		keys = append(keys, k)
	}
	return c.JSON(http.StatusOK, keys)
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

	var id string
	err = h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_api_keys (name, key_hash, prefix, role, workspace_id, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, req.Name, keyHash, prefix, req.Role, workspaceIDVal, expiresAt).Scan(&id)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

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
	_, err := h.DB.Pool.Exec(c.Request().Context(), "DELETE FROM _v_api_keys WHERE id = $1", id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
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

	_, err := h.DB.Pool.Exec(c.Request().Context(), "UPDATE _v_api_keys SET is_active = $1 WHERE id = $2", req.Active, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
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

	var currentName, role string
	var workspaceID *string
	var expiresAt *time.Time
	err = tx.QueryRow(ctx, `
		SELECT name, role, workspace_id, expires_at
		FROM _v_api_keys
		WHERE id = $1
		FOR UPDATE
	`, keyID).Scan(&currentName, &role, &workspaceID, &expiresAt)
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
	var workspaceIDVal any
	if workspaceID != nil && strings.TrimSpace(*workspaceID) != "" {
		workspaceIDVal = *workspaceID
	}

	err = tx.QueryRow(ctx, `
		INSERT INTO _v_api_keys (name, key_hash, prefix, role, workspace_id, expires_at, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, true)
		RETURNING id
	`, newName, keyHash, prefix, role, workspaceIDVal, expiresAt).Scan(&newID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create rotated key"})
	}

	if _, err := tx.Exec(ctx, `UPDATE _v_api_keys SET is_active = false WHERE id = $1`, keyID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to deactivate previous key"})
	}

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
