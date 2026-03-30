package api

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

const (
	apiKeyManagedKindCustom    = "custom"
	apiKeyManagedKindEssential = "essential"
	adminVerifyScopeEssential  = "essential_api_keys"
	adminVerifyTTL             = 10 * time.Minute
)

type EssentialAPIKeyBootstrap struct {
	AnonKey        string
	ServiceRoleKey string
}

type EssentialAPIKeySummary struct {
	ID         string     `json:"id"`
	Role       string     `json:"role"`
	Label      string     `json:"label"`
	Prefix     string     `json:"prefix"`
	KeyVersion int        `json:"key_version"`
	IsActive   bool       `json:"is_active"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at"`
}

type adminVerificationClaims struct {
	Scope string `json:"scope"`
	jwt.RegisteredClaims
}

func apiKeyLabel(role string) string {
	switch role {
	case APIKeyRoleAnon:
		return "Publishable key"
	case APIKeyRoleServiceRole:
		return "Secret key"
	default:
		return role
	}
}

func apiKeySecretEncryptionSecret() string {
	if secret := strings.TrimSpace(os.Getenv("OZY_API_KEY_ENCRYPTION_SECRET")); secret != "" {
		return secret
	}
	return strings.TrimSpace(os.Getenv("JWT_SECRET"))
}

func adminVerificationSecret() string {
	if secret := strings.TrimSpace(os.Getenv("OZY_ADMIN_REAUTH_SECRET")); secret != "" {
		return secret
	}
	return strings.TrimSpace(os.Getenv("JWT_SECRET"))
}

func deriveKeyMaterialKey(secret string) ([]byte, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return nil, errors.New("missing encryption secret")
	}
	sum := sha256.Sum256([]byte(secret))
	return sum[:], nil
}

func encryptKeyMaterial(secret, plaintext string) (string, error) {
	key, err := deriveKeyMaterialKey(secret)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

func decryptKeyMaterial(secret, ciphertext string) (string, error) {
	key, err := deriveKeyMaterialKey(secret)
	if err != nil {
		return "", err
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimSpace(ciphertext))
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("ciphertext is too short")
	}
	nonce := raw[:gcm.NonceSize()]
	payload := raw[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, payload, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func managedAPIKeyPrefix(role, fullKey string) string {
	fullKey = strings.TrimSpace(fullKey)
	if fullKey == "" {
		return ""
	}
	if len(fullKey) <= 10 {
		return fullKey
	}
	switch role {
	case APIKeyRoleAnon:
		return "ozy_anon"
	case APIKeyRoleServiceRole:
		return "ozy_srv"
	default:
		return fullKey[:10]
	}
}

func generateManagedAPIKey(role string) (string, string, error) {
	rawKey, err := GenerateRandomKey()
	if err != nil {
		return "", "", err
	}
	marker := "a"
	if role == APIKeyRoleServiceRole {
		marker = "s"
	}
	prefix := fmt.Sprintf("ozy%s_%s", marker, rawKey[:4])
	return fmt.Sprintf("%s_%s", prefix, rawKey), prefix, nil
}

func issueAdminVerificationToken(secret, userID, scope string, now time.Time, ttl time.Duration) (string, time.Time, error) {
	expiresAt := now.Add(ttl)
	claims := adminVerificationClaims{
		Scope: scope,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, expiresAt, nil
}

func validateAdminVerificationToken(secret, tokenString, userID, scope string, now time.Time) error {
	claims := adminVerificationClaims{}
	token, err := jwt.ParseWithClaims(tokenString, &claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method %v", token.Header["alg"])
		}
		return []byte(secret), nil
	}, jwt.WithTimeFunc(func() time.Time { return now }))
	if err != nil {
		return err
	}
	if !token.Valid {
		return errors.New("verification token is invalid")
	}
	if claims.Scope != scope {
		return errors.New("verification token scope is invalid")
	}
	if strings.TrimSpace(claims.Subject) != strings.TrimSpace(userID) {
		return errors.New("verification token subject mismatch")
	}
	return nil
}

func verifyAdminPassword(ctx context.Context, db *data.DB, userID string, password string) error {
	userID = strings.TrimSpace(userID)
	password = strings.TrimSpace(password)
	if userID == "" || password == "" {
		return errors.New("password is required")
	}
	if _, err := uuid.Parse(userID); err != nil {
		return errors.New("invalid admin session")
	}

	var passwordHash string
	var role string
	if err := db.Pool.QueryRow(ctx, `
		SELECT password_hash, role
		FROM _v_users
		WHERE id = $1
	`, userID).Scan(&passwordHash, &role); err != nil {
		if err == pgx.ErrNoRows {
			return errors.New("admin account not found")
		}
		return err
	}
	if role != "admin" {
		return errors.New("admin privileges required")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		return errors.New("invalid password")
	}
	return nil
}

func normalizeEssentialRole(raw string) (string, error) {
	role := strings.ToLower(strings.TrimSpace(raw))
	switch role {
	case APIKeyRoleAnon, APIKeyRoleServiceRole:
		return role, nil
	default:
		return "", errors.New("role must be 'anon' or 'service_role'")
	}
}

func projectAPIBaseURL(c echo.Context) string {
	return resolveProjectAPIURL(c)
}

func buildMCPConfigPayload(c echo.Context, serviceRoleKey string) map[string]any {
	baseURL := projectAPIBaseURL(c)
	toolsURL := strings.TrimRight(baseURL, "/") + "/api/project/mcp/tools"
	invokeURL := strings.TrimRight(baseURL, "/") + "/api/project/mcp/invoke"

	return map[string]any{
		"runtime":      "native",
		"tools_url":    toolsURL,
		"invoke_url":   invokeURL,
		"auth_header":  "apikey",
		"tool_count":   len(buildMCPTools()),
		"sample_tools": fmt.Sprintf("curl -s %q -H %q", toolsURL, "apikey: "+serviceRoleKey),
		"sample_invoke": fmt.Sprintf(
			"curl -s %q -H %q -H %q -d %q",
			invokeURL,
			"apikey: "+serviceRoleKey,
			"Content-Type: application/json",
			`{"tool":"system.health","arguments":{}}`,
		),
	}
}

func (h *Handler) currentEssentialAPIKey(ctx context.Context, role string) (APIKey, string, error) {
	var key APIKey
	var secretCiphertext string
	err := h.DB.Pool.QueryRow(ctx, `
		SELECT id, name, prefix, role, is_active, created_at, last_used_at, key_version, COALESCE(secret_ciphertext, '')
		FROM _v_api_keys
		WHERE role = $1
		  AND managed_kind = $2
		  AND is_active = TRUE
		  AND revoked_at IS NULL
		  AND rotated_to_key_id IS NULL
		ORDER BY key_version DESC, created_at DESC
		LIMIT 1
	`, role, apiKeyManagedKindEssential).Scan(&key.ID, &key.Name, &key.Prefix, &key.Role, &key.IsActive, &key.CreatedAt, &key.LastUsedAt, &key.KeyVersion, &secretCiphertext)
	if err != nil {
		return APIKey{}, "", err
	}
	return key, secretCiphertext, nil
}

func (h *Handler) ListEssentialAPIKeys(c echo.Context) error {
	ctx := c.Request().Context()
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT id, name, prefix, role, is_active, created_at, last_used_at, key_version
		FROM _v_api_keys
		WHERE managed_kind = $1
		  AND is_active = TRUE
		  AND revoked_at IS NULL
		  AND rotated_to_key_id IS NULL
		  AND role IN ($2, $3)
		ORDER BY CASE role WHEN 'anon' THEN 0 ELSE 1 END, created_at DESC
	`, apiKeyManagedKindEssential, APIKeyRoleAnon, APIKeyRoleServiceRole)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to load essential api keys"})
	}
	defer rows.Close()

	keys := make([]EssentialAPIKeySummary, 0, 2)
	for rows.Next() {
		var item EssentialAPIKeySummary
		if scanErr := rows.Scan(&item.ID, &item.Label, &item.Prefix, &item.Role, &item.IsActive, &item.CreatedAt, &item.LastUsedAt, &item.KeyVersion); scanErr != nil {
			continue
		}
		item.Label = apiKeyLabel(item.Role)
		keys = append(keys, item)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"verification_required": true,
		"keys":                  keys,
	})
}

func (h *Handler) VerifyEssentialAPIKeyAccess(c echo.Context) error {
	userID, _ := c.Get("user_id").(string)
	var req struct {
		Password string `json:"password"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}
	if err := verifyAdminPassword(c.Request().Context(), h.DB, userID, req.Password); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": err.Error()})
	}

	signingSecret := adminVerificationSecret()
	now := time.Now().UTC()
	token, expiresAt, err := issueAdminVerificationToken(signingSecret, userID, adminVerifyScopeEssential, now, adminVerifyTTL)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to issue verification token"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"verification_token": token,
		"verified_until":     expiresAt,
		"ttl_seconds":        int(adminVerifyTTL.Seconds()),
	})
}

func (h *Handler) RevealEssentialAPIKey(c echo.Context) error {
	userID, _ := c.Get("user_id").(string)
	role, err := normalizeEssentialRole(c.Param("role"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	var req struct {
		VerificationToken string `json:"verification_token"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}
	if err := validateAdminVerificationToken(adminVerificationSecret(), req.VerificationToken, userID, adminVerifyScopeEssential, time.Now().UTC()); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "admin verification expired; confirm password again"})
	}

	currentKey, ciphertext, err := h.currentEssentialAPIKey(c.Request().Context(), role)
	if err != nil {
		if err == pgx.ErrNoRows {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "essential api key not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to load essential api key"})
	}
	if strings.TrimSpace(ciphertext) == "" {
		return c.JSON(http.StatusConflict, map[string]string{"error": "essential api key material is unavailable"})
	}

	keyMaterial, err := decryptKeyMaterial(apiKeySecretEncryptionSecret(), ciphertext)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to decrypt essential api key"})
	}

	payload := map[string]any{
		"id":           currentKey.ID,
		"role":         currentKey.Role,
		"label":        apiKeyLabel(currentKey.Role),
		"key":          keyMaterial,
		"prefix":       currentKey.Prefix,
		"key_version":  currentKey.KeyVersion,
		"created_at":   currentKey.CreatedAt,
		"last_used_at": currentKey.LastUsedAt,
	}
	if role == APIKeyRoleServiceRole {
		payload["mcp"] = buildMCPConfigPayload(c, keyMaterial)
	}
	return c.JSON(http.StatusOK, payload)
}

func (h *Handler) RotateEssentialAPIKey(c echo.Context) error {
	userID, _ := c.Get("user_id").(string)
	role, err := normalizeEssentialRole(c.Param("role"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	var req struct {
		VerificationToken string `json:"verification_token"`
		Reason            string `json:"reason"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}
	if err := validateAdminVerificationToken(adminVerificationSecret(), req.VerificationToken, userID, adminVerifyScopeEssential, time.Now().UTC()); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "admin verification expired; confirm password again"})
	}

	ctx := c.Request().Context()
	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to start transaction"})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var currentID, currentPrefix, keyGroupID string
	var currentVersion int
	var workspaceID *string
	if err := tx.QueryRow(ctx, `
		SELECT id, prefix, COALESCE(key_group_id::text, ''), key_version, workspace_id
		FROM _v_api_keys
		WHERE role = $1
		  AND managed_kind = $2
		  AND is_active = TRUE
		  AND revoked_at IS NULL
		  AND rotated_to_key_id IS NULL
		ORDER BY key_version DESC, created_at DESC
		LIMIT 1
		FOR UPDATE
	`, role, apiKeyManagedKindEssential).Scan(&currentID, &currentPrefix, &keyGroupID, &currentVersion, &workspaceID); err != nil {
		if err == pgx.ErrNoRows {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "essential api key not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to lock essential api key"})
	}
	if strings.TrimSpace(keyGroupID) == "" {
		keyGroupID = currentID
	}

	newKey, prefix, err := generateManagedAPIKey(role)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to generate key"})
	}
	ciphertext, err := encryptKeyMaterial(apiKeySecretEncryptionSecret(), newKey)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to protect key material"})
	}
	hash := sha256.Sum256([]byte(newKey))
	keyHash := hex.EncodeToString(hash[:])
	newVersion := currentVersion + 1
	newID := uuid.NewString()

	var actorUserIDVal any
	if actor := actorUserIDFromContext(c); actor != nil {
		actorUserIDVal = *actor
	}
	var workspaceIDVal any
	if workspaceID != nil && strings.TrimSpace(*workspaceID) != "" {
		workspaceIDVal = *workspaceID
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO _v_api_keys (id, name, key_hash, prefix, role, is_active, created_by_user_id, key_group_id, key_version, valid_after, workspace_id, managed_kind, secret_ciphertext)
		VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, $8, NOW(), $9, $10, $11)
	`, newID, apiKeyLabel(role), keyHash, prefix, role, actorUserIDVal, keyGroupID, newVersion, workspaceIDVal, apiKeyManagedKindEssential, ciphertext); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create rotated key"})
	}

	if _, err := tx.Exec(ctx, `
		UPDATE _v_api_keys
		SET rotated_to_key_id = $2,
		    grace_until = NULL,
		    is_active = FALSE,
		    revoked_at = NOW()
		WHERE id = $1
	`, currentID, newID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to revoke previous key"})
	}

	if _, err := tx.Exec(ctx, `
		UPDATE _v_api_keys
		SET is_active = TRUE
		WHERE id = $1
	`, newID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to activate rotated key"})
	}

	details := map[string]any{
		"old_id":         currentID,
		"new_id":         newID,
		"old_prefix":     currentPrefix,
		"new_prefix":     prefix,
		"role":           role,
		"key_group_id":   keyGroupID,
		"old_version":    currentVersion,
		"new_version":    newVersion,
		"reason":         strings.TrimSpace(req.Reason),
		"rotation_model": "immediate_cutover",
	}
	detailsJSON, _ := json.Marshal(details)
	if _, err := tx.Exec(ctx, `
		INSERT INTO _v_api_key_events (api_key_id, workspace_id, action, actor_user_id, details)
		VALUES ($1, $2, 'rotate', $3, $4::jsonb)
	`, newID, workspaceIDVal, actorUserIDVal, string(detailsJSON)); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to audit rotation"})
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit key rotation"})
	}

	payload := map[string]any{
		"id":                newID,
		"role":              role,
		"label":             apiKeyLabel(role),
		"key":               newKey,
		"prefix":            prefix,
		"key_version":       newVersion,
		"previous_key_id":   currentID,
		"previous_disabled": true,
		"warning":           "Rotation complete. The previous key stopped working immediately.",
	}
	if role == APIKeyRoleServiceRole {
		payload["mcp"] = buildMCPConfigPayload(c, newKey)
	}
	return c.JSON(http.StatusOK, payload)
}

func EnsureEssentialAPIKeys(ctx context.Context, db *data.DB, bootstrap EssentialAPIKeyBootstrap) error {
	if db == nil || db.Pool == nil {
		return errors.New("database is required")
	}
	encryptionSecret := apiKeySecretEncryptionSecret()
	if strings.TrimSpace(encryptionSecret) == "" {
		return errors.New("JWT_SECRET or OZY_API_KEY_ENCRYPTION_SECRET is required for essential api keys")
	}

	specs := []struct {
		role string
		key  string
	}{
		{role: APIKeyRoleAnon, key: strings.TrimSpace(bootstrap.AnonKey)},
		{role: APIKeyRoleServiceRole, key: strings.TrimSpace(bootstrap.ServiceRoleKey)},
	}

	for _, spec := range specs {
		if spec.key == "" {
			return fmt.Errorf("missing bootstrap key for role %s", spec.role)
		}

		var exists bool
		if err := db.Pool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1
				FROM _v_api_keys
				WHERE role = $1
				  AND managed_kind = $2
				  AND is_active = TRUE
				  AND revoked_at IS NULL
				  AND rotated_to_key_id IS NULL
			)
		`, spec.role, apiKeyManagedKindEssential).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}

		hash := sha256.Sum256([]byte(spec.key))
		keyHash := hex.EncodeToString(hash[:])
		ciphertext, err := encryptKeyMaterial(encryptionSecret, spec.key)
		if err != nil {
			return err
		}
		keyGroupID := uuid.NewString()

		if _, err := db.Pool.Exec(ctx, `
			INSERT INTO _v_api_keys (name, key_hash, prefix, role, is_active, key_group_id, key_version, valid_after, managed_kind, secret_ciphertext)
			VALUES ($1, $2, $3, $4, TRUE, $5, 1, NOW(), $6, $7)
		`, apiKeyLabel(spec.role), keyHash, managedAPIKeyPrefix(spec.role, spec.key), spec.role, keyGroupID, apiKeyManagedKindEssential, ciphertext); err != nil {
			return err
		}
	}

	return nil
}
