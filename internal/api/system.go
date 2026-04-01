package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

// GetSystemStatus checks if the system is initialized (has an admin user)
func (h *Handler) GetSystemStatus(c echo.Context) error {
	if h == nil || h.DB == nil || h.DB.Pool == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "System service unavailable"})
	}

	var count int
	// Check if any user with admin role exists
	err := h.DB.Pool.QueryRow(c.Request().Context(), "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&count)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to check initialization status"})
	}

	return c.JSON(http.StatusOK, map[string]bool{
		"initialized": count > 0,
	})
}

// SetupSystem handles the initial setup (First Time Run)
func (h *Handler) SetupSystem(c echo.Context) error {
	var req struct {
		Email        string `json:"email"`
		Password     string `json:"password"`
		Mode         string `json:"mode"`          // "clean", "secure", or "migrate"
		AllowCountry string `json:"allow_country"` // Current country to allow if secure mode
	}

	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Mode = strings.TrimSpace(strings.ToLower(req.Mode))
	req.AllowCountry = strings.TrimSpace(strings.ToUpper(req.AllowCountry))

	if req.Email == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Email is required"})
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid email format"})
	}
	if len(req.Password) < 12 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Password must be at least 12 characters"})
	}
	if req.Mode == "" {
		req.Mode = "clean"
	}
	if req.Mode != "clean" && req.Mode != "secure" && req.Mode != "migrate" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid mode. Allowed: clean, secure, migrate"})
	}
	if h == nil || h.DB == nil || h.DB.Pool == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "System service unavailable"})
	}
	if h.Auth == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Auth service unavailable"})
	}

	// Start transaction for atomic setup
	tx, err := h.DB.Pool.Begin(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to start transaction"})
	}
	defer func() { _ = tx.Rollback(c.Request().Context()) }()

	// Serialize bootstrap to avoid concurrent double initialization.
	if _, err := tx.Exec(c.Request().Context(), "LOCK TABLE _v_users IN ACCESS EXCLUSIVE MODE"); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to acquire setup lock"})
	}

	// Validate no admin exists (inside locked transaction)
	var count int
	if err := tx.QueryRow(c.Request().Context(), "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&count); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to verify initialization state"})
	}
	if count > 0 {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "System already initialized"})
	}

	// 2. Create Admin User
	hashedBytes, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to hash password"})
	}
	hashedPassword := string(hashedBytes)

	var userID string
	err = tx.QueryRow(c.Request().Context(), `
		INSERT INTO _v_users (email, password_hash, role)
		VALUES ($1, $2, 'admin')
		RETURNING id
	`, req.Email, hashedPassword).Scan(&userID)

	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return c.JSON(http.StatusConflict, map[string]string{"error": "Admin user already exists"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create admin"})
	}

	// 3. Apply configuration based on mode
	switch req.Mode {
	case "secure":
		// A. Enable Geo-Fencing for the provided country
		if req.AllowCountry != "" {
			allowedCountries := normalizeAllowedCountries([]string{req.AllowCountry})
			config := map[string]any{
				"enabled":           true,
				"allowed_countries": allowedCountries,
			}
			configJSON, err := json.Marshal(config)
			if err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to encode security policy"})
			}

			_, err = tx.Exec(c.Request().Context(), `
				INSERT INTO _v_security_policies (type, config)
				VALUES ('geo_fencing', $1)
				ON CONFLICT (type) DO UPDATE SET config = $1
			`, configJSON)
			if err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to apply security policy"})
			}
		}

		// Security: Initialize logs
		_, err = tx.Exec(c.Request().Context(), `
			INSERT INTO _v_audit_logs (method, path, status, country)
			VALUES ('SYSTEM', 'SETUP_SECURE', 200, 'SYSTEM')
		`)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to initialize audit logs"})
		}
	case "migrate":
		_, err = tx.Exec(c.Request().Context(), `
			INSERT INTO _v_audit_logs (method, path, status, country)
			VALUES ('SYSTEM', 'SETUP_MIGRATE', 200, 'SYSTEM')
		`)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to initialize migration setup logs"})
		}
	}

	// 4. Generate token and create session inside the setup transaction so bootstrap is atomic.
	token, err := h.Auth.GenerateTokenOnly(userID, "admin")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to generate session token"})
	}

	tokenHashRaw := sha256.Sum256([]byte(token))
	tokenHash := hex.EncodeToString(tokenHashRaw[:])
	_, err = tx.Exec(c.Request().Context(), `
		INSERT INTO _v_sessions (user_id, token_hash, ip_address, user_agent, is_mfa_verified, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, userID, tokenHash, c.RealIP(), c.Request().UserAgent(), false, time.Now().Add(72*time.Hour))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to initialize admin session"})
	}

	// Commit transaction
	if err := tx.Commit(c.Request().Context()); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to commit setup"})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"status": "initialized",
		"token":  token,
	})
}
