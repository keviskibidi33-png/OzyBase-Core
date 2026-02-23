package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSetupSystem_Validation(t *testing.T) {
	e := echo.New()
	h := &Handler{}

	tests := []struct {
		name        string
		rawBody     string
		wantStatus  int
		wantContain string
	}{
		{
			name:        "invalid json body",
			rawBody:     `{"email":`,
			wantStatus:  http.StatusBadRequest,
			wantContain: "Invalid request body",
		},
		{
			name:        "missing email",
			rawBody:     `{"password":"StrongPass123!","mode":"clean"}`,
			wantStatus:  http.StatusBadRequest,
			wantContain: "Email is required",
		},
		{
			name:        "invalid email format",
			rawBody:     `{"email":"admin","password":"StrongPass123!","mode":"clean"}`,
			wantStatus:  http.StatusBadRequest,
			wantContain: "Invalid email format",
		},
		{
			name:        "short password",
			rawBody:     `{"email":"admin@example.com","password":"short","mode":"clean"}`,
			wantStatus:  http.StatusBadRequest,
			wantContain: "Password must be at least 12 characters",
		},
		{
			name:        "invalid mode",
			rawBody:     `{"email":"admin@example.com","password":"StrongPass123!","mode":"unknown"}`,
			wantStatus:  http.StatusBadRequest,
			wantContain: "Invalid mode. Allowed: clean, secure, migrate",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/system/setup", bytes.NewBufferString(tc.rawBody))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)

			err := h.SetupSystem(c)
			require.NoError(t, err)
			assert.Equal(t, tc.wantStatus, rec.Code)
			assert.Contains(t, rec.Body.String(), tc.wantContain)
		})
	}
}

func TestSetupSystem_ConcurrentInitialization(t *testing.T) {
	db := setupSystemTestDB(t)
	h := &Handler{
		DB:   db,
		Auth: core.NewAuthService(db, "test-jwt-secret", nil),
	}

	const attempts = 8
	type response struct {
		code int
		body string
		err  error
	}

	e := echo.New()
	results := make(chan response, attempts)
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()

			payload := map[string]string{
				"email":    fmt.Sprintf("admin_%d@example.com", i),
				"password": "StrongPass123!",
				"mode":     "clean",
			}
			raw, marshalErr := json.Marshal(payload)
			if marshalErr != nil {
				results <- response{err: marshalErr}
				return
			}

			req := httptest.NewRequest(http.MethodPost, "/api/system/setup", bytes.NewReader(raw))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)

			callErr := h.SetupSystem(c)
			results <- response{
				code: rec.Code,
				body: rec.Body.String(),
				err:  callErr,
			}
		}(i)
	}

	wg.Wait()
	close(results)

	okCount := 0
	forbiddenCount := 0
	unexpected := make([]response, 0)

	for result := range results {
		require.NoError(t, result.err)
		switch result.code {
		case http.StatusOK:
			okCount++
		case http.StatusForbidden:
			forbiddenCount++
		default:
			unexpected = append(unexpected, result)
		}
	}

	assert.Equal(t, 1, okCount, "exactly one setup request must initialize the system")
	assert.Equal(t, attempts-1, forbiddenCount, "all remaining requests must be rejected as already initialized")
	if len(unexpected) > 0 {
		t.Fatalf("unexpected statuses: %+v", unexpected)
	}

	var adminCount int
	err := db.Pool.QueryRow(context.Background(), "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&adminCount)
	require.NoError(t, err)
	assert.Equal(t, 1, adminCount, "database must contain exactly one admin")
}

func setupSystemTestDB(t *testing.T) *data.DB {
	t.Helper()

	databaseURL := strings.TrimSpace(os.Getenv("OZY_TEST_DATABASE_URL"))
	if databaseURL == "" {
		databaseURL = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	}
	if databaseURL == "" {
		t.Skip("set OZY_TEST_DATABASE_URL or DATABASE_URL to run SetupSystem integration/concurrency test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db, err := data.Connect(ctx, databaseURL)
	require.NoError(t, err)
	t.Cleanup(db.Close)

	require.NoError(t, db.RunMigrations(ctx))

	_, err = db.Pool.Exec(ctx, `
		TRUNCATE TABLE
			_v_sessions,
			_v_users,
			_v_audit_logs,
			_v_security_policies
		RESTART IDENTITY CASCADE
	`)
	require.NoError(t, err)

	return db
}
