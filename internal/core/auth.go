// Package core implements the central business logic of OzyBase.
package core

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/mailer"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type AuthService struct {
	db        *data.DB
	jwtSecret string
	mailer    mailer.Mailer
}

func NewAuthService(db *data.DB, jwtSecret string, mailer mailer.Mailer) *AuthService {
	return &AuthService{
		db:        db,
		jwtSecret: jwtSecret,
		mailer:    mailer,
	}
}

func (s *AuthService) DB() *data.DB {
	return s.db
}

// Signup handles user registration
func (s *AuthService) Signup(ctx context.Context, email, password string) (*User, error) {
	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	var user User
	err = s.db.Pool.QueryRow(ctx, `
		INSERT INTO _v_users (email, password_hash, role)
		VALUES ($1, $2, $3)
		RETURNING id, email, role, is_verified, created_at, updated_at
	`, email, string(hashedPassword), "user").Scan(&user.ID, &user.Email, &user.Role, &user.IsVerified, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	// Generate verification token
	b := make([]byte, 32)
	if _, err := rand.Read(b); err == nil {
		token := hex.EncodeToString(b)
		expiresAt := time.Now().Add(24 * time.Hour)

		_, _ = s.db.Pool.Exec(ctx, `
			INSERT INTO _v_verification_tokens (user_id, token, expires_at)
			VALUES ($1, $2, $3)
		`, user.ID, token, expiresAt)

		// Send email (async ideally, but simple for now)
		_ = s.mailer.SendVerificationEmail(user.Email, token)
	}

	return &user, nil
}

// AuthLoginResult represents the outcome of a login attempt
type AuthLoginResult struct {
	Token       string `json:"token,omitempty"`
	MFAStore    string `json:"mfa_store,omitempty"` // Temporary identifier for MFA verification
	MFARequired bool   `json:"mfa_required"`
	User        *User  `json:"user"`
}

// Login verifies credentials and returns a AuthLoginResult
func (s *AuthService) Login(ctx context.Context, email, password string) (*AuthLoginResult, error) {
	var user User
	err := s.db.Pool.QueryRow(ctx, `
		SELECT id, email, password_hash, role, is_verified, created_at, updated_at
		FROM _v_users
		WHERE email = $1
	`, email).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.Role, &user.IsVerified, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		return nil, errors.New("invalid email or password")
	}

	// Compare passwords
	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password))
	if err != nil {
		return nil, errors.New("invalid email or password")
	}

	// Check if MFA is enabled
	var mfaEnabled bool
	_ = s.db.Pool.QueryRow(ctx, "SELECT is_enabled FROM _v_user_2fa WHERE user_id = $1", user.ID).Scan(&mfaEnabled)

	if mfaEnabled {
		// Return partial result, no token yet
		return &AuthLoginResult{
			MFARequired: true,
			MFAStore:    user.ID, // For simplicity in this phase, using userID. In Phase 3, use a signed temp token.
			User:        &user,
		}, nil
	}

	// Not MFA enabled, generate full JWT and Session
	tokenString, err := s.GenerateTokenForUser(ctx, user.ID, user.Role, "", "", false)
	if err != nil {
		return nil, err
	}

	return &AuthLoginResult{
		Token:       tokenString,
		MFARequired: false,
		User:        &user,
	}, nil
}

func (s *AuthService) generateToken(userID, role string) (string, error) {
	// Generate a unique ID for this token to prevent collisions if generated in same second
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate token entropy: %w", err)
	}
	jti := hex.EncodeToString(b)

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"role":    role,
		"exp":     time.Now().Add(time.Hour * 72).Unix(),
		"jti":     jti,
	})

	return token.SignedString([]byte(s.jwtSecret))
}

// GenerateTokenForUser exposes internal token generation logic and creates a session
func (s *AuthService) GenerateTokenForUser(ctx context.Context, userID, role, ip, ua string, isMFA bool) (string, error) {
	tokenString, err := s.generateToken(userID, role)
	if err != nil {
		return "", err
	}

	// Create Session
	hash := sha256.Sum256([]byte(tokenString))
	tokenHash := hex.EncodeToString(hash[:])

	expiresAt := time.Now().Add(time.Hour * 72)

	_, err = s.db.Pool.Exec(ctx, `
		INSERT INTO _v_sessions (user_id, token_hash, ip_address, user_agent, is_mfa_verified, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, userID, tokenHash, ip, ua, isMFA, expiresAt)

	if err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}

	return tokenString, nil
}

// RequestPasswordReset generates a reset token and saves it
func (s *AuthService) RequestPasswordReset(ctx context.Context, email string) (string, error) {
	var userID string
	err := s.db.Pool.QueryRow(ctx, "SELECT id FROM _v_users WHERE email = $1", email).Scan(&userID)
	if err != nil {
		// To prevent user enumeration, we return success even if email doesn't exist
		// but in the backend we don't do anything.
		return "", nil
	}

	// Generate a random token
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)

	// Set expiration (1 hour)
	expiresAt := time.Now().Add(time.Hour)

	// Save token
	_, err = s.db.Pool.Exec(ctx, `
		INSERT INTO _v_reset_tokens (user_id, token, expires_at)
		VALUES ($1, $2, $3)
	`, userID, token, expiresAt)

	if err != nil {
		return "", fmt.Errorf("failed to save reset token: %w", err)
	}

	// In a real app, you would send an email here.
	_ = s.mailer.SendPasswordResetEmail(email, token)

	return token, nil
}

// ConfirmPasswordReset verifies the token and updates the user's password
func (s *AuthService) ConfirmPasswordReset(ctx context.Context, token, newPassword string) error {
	var userID string
	var expiresAt time.Time

	err := s.db.Pool.QueryRow(ctx, `
		SELECT user_id, expires_at FROM _v_reset_tokens WHERE token = $1
	`, token).Scan(&userID, &expiresAt)

	if err != nil {
		return errors.New("invalid or expired reset token")
	}

	if time.Now().After(expiresAt) {
		return errors.New("reset token has expired")
	}

	// Hash new password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	// Update password and delete token in a transaction
	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, "UPDATE _v_users SET password_hash = $1 WHERE id = $2", string(hashedPassword), userID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, "DELETE FROM _v_reset_tokens WHERE token = $1", token)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// VerifyEmail marks a user as verified if the token is valid
func (s *AuthService) VerifyEmail(ctx context.Context, token string) error {
	var userID string
	var expiresAt time.Time

	err := s.db.Pool.QueryRow(ctx, `
		SELECT user_id, expires_at FROM _v_verification_tokens WHERE token = $1
	`, token).Scan(&userID, &expiresAt)

	if err != nil {
		return errors.New("invalid or expired verification token")
	}

	if time.Now().After(expiresAt) {
		return errors.New("verification token has expired")
	}

	// Update user and delete token
	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, "UPDATE _v_users SET is_verified = TRUE WHERE id = $1", userID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, "DELETE FROM _v_verification_tokens WHERE token = $1", token)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// UpdateUserRole updates a user's role
func (s *AuthService) UpdateUserRole(ctx context.Context, userID, newRole string) error {
	_, err := s.db.Pool.Exec(ctx, "UPDATE _v_users SET role = $1 WHERE id = $2", newRole, userID)
	return err
}

// HandleOAuthLogin handles authentication via external providers
func (s *AuthService) HandleOAuthLogin(ctx context.Context, provider, providerID, email string, data map[string]any) (string, *User, error) {
	var userID string
	var user User

	// 1. Check if identity already exists
	err := s.db.Pool.QueryRow(ctx, `
		SELECT user_id FROM _v_identities
		WHERE provider = $1 AND provider_id = $2
	`, provider, providerID).Scan(&userID)

	if err == nil {
		// Identity exists, fetch user
		err = s.db.Pool.QueryRow(ctx, `
			SELECT id, email, role, is_verified, created_at, updated_at
			FROM _v_users WHERE id = $1
		`, userID).Scan(&user.ID, &user.Email, &user.Role, &user.IsVerified, &user.CreatedAt, &user.UpdatedAt)

		if err != nil {
			return "", nil, err
		}

		// Update last sign-in
		if _, err := s.db.Pool.Exec(ctx, "UPDATE _v_identities SET last_signin_at = NOW(), identity_data = $1 WHERE provider = $2 AND provider_id = $3", data, provider, providerID); err != nil {
			log.Printf("⚠️ Warning: Failed to update OAuth identity: %v", err)
		}

	} else {
		// 2. Identity does not exist, check if user with email exists
		err = s.db.Pool.QueryRow(ctx, `
			SELECT id, email, role, is_verified, created_at, updated_at
			FROM _v_users WHERE email = $1
		`, email).Scan(&user.ID, &user.Email, &user.Role, &user.IsVerified, &user.CreatedAt, &user.UpdatedAt)

		if err != nil {
			// 3. User does not exist, create new user
			err = s.db.Pool.QueryRow(ctx, `
				INSERT INTO _v_users (email, password_hash, role, is_verified)
				VALUES ($1, $2, $3, $4)
				RETURNING id, email, role, is_verified, created_at, updated_at
			`, email, "OAUTH_LOGIN", "user", true).Scan(&user.ID, &user.Email, &user.Role, &user.IsVerified, &user.CreatedAt, &user.UpdatedAt)

			if err != nil {
				return "", nil, fmt.Errorf("failed to create user: %w", err)
			}
		}

		// 4. Link identity to user
		_, err = s.db.Pool.Exec(ctx, `
			INSERT INTO _v_identities (user_id, provider, provider_id, identity_data)
			VALUES ($1, $2, $3, $4)
		`, user.ID, provider, providerID, data)

		if err != nil {
			return "", nil, fmt.Errorf("failed to link identity: %w", err)
		}
	}

	// 5. Generate JWT and Session
	tokenString, err := s.GenerateTokenForUser(ctx, user.ID, user.Role, "", "", false)
	if err != nil {
		return "", nil, err
	}

	return tokenString, &user, nil
}

// ListSessions returns all active sessions for a user
func (s *AuthService) ListSessions(ctx context.Context, userID string) ([]Session, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT id, user_id, ip_address, user_agent, is_mfa_verified, expires_at, created_at, last_used_at
		FROM _v_sessions
		WHERE user_id = $1 AND expires_at > NOW()
		ORDER BY last_used_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var sess Session
		err := rows.Scan(&sess.ID, &sess.UserID, &sess.IPAddress, &sess.UserAgent, &sess.IsMFAVerified, &sess.ExpiresAt, &sess.CreatedAt, &sess.LastUsedAt)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, sess)
	}
	return sessions, nil
}

// RevokeSession deletes a session
func (s *AuthService) RevokeSession(ctx context.Context, sessionID, userID string) error {
	_, err := s.db.Pool.Exec(ctx, `
		DELETE FROM _v_sessions
		WHERE id = $1 AND user_id = $2
	`, sessionID, userID)
	return err
}

// RevokeAllSessions deletes all active sessions (incident response operation).
func (s *AuthService) RevokeAllSessions(ctx context.Context) error {
	_, err := s.db.Pool.Exec(ctx, `DELETE FROM _v_sessions`)
	return err
}
