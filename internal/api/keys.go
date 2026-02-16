package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
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
		if err := rows.Scan(&k.ID, &k.Name, &k.Prefix, &k.Role, &k.IsActive, &k.ExpiresAt, &k.CreatedAt, &k.LastUsedAt, &k.WorkspaceID); err != nil {
			continue
		}
		keys = append(keys, k)
	}
	return c.JSON(http.StatusOK, keys)
}

func (h *Handler) CreateAPIKey(c echo.Context) error {
	var req struct {
		Name string `json:"name"`
		Role string `json:"role"` // 'anon' or 'service_role'
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

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

	var id string
	err = h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_api_keys (name, key_hash, prefix, role, workspace_id)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, req.Name, keyHash, prefix, req.Role, workspaceID).Scan(&id)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]any{
		"id":      id,
		"key":     fullKey,
		"name":    req.Name,
		"role":    req.Role,
		"warning": "Copy this key now, it will not be shown again!",
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
