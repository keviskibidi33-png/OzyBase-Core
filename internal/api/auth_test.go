package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestSignup_Validation(t *testing.T) {
	// Setup
	e := echo.New()
	// Initialize handler with nil service - should not be reached if validation works
	h := NewAuthHandler(nil)

	tests := []struct {
		name     string
		body     string
		wantCode int
	}{
		{
			name:     "Invalid Email",
			body:     `{"email": "invalid-email", "password": "strongpassword123"}`,
			wantCode: http.StatusBadRequest,
		},
		{
			name:     "Short Password",
			body:     `{"email": "test@example.com", "password": "123"}`,
			wantCode: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/signup", strings.NewReader(tt.body))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)

			// Helper to catch panic if validation is missing
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("Handler panicked: %v. This means validation was skipped and nil service was called.", r)
				}
			}()

			err := h.Signup(c)

			// If handler returns error (Echo style), check it
			if err != nil {
				he, ok := err.(*echo.HTTPError)
				if ok {
					if he.Code != tt.wantCode {
						t.Errorf("Expected status %d, got %d", tt.wantCode, he.Code)
					}
				}
				// If it's not HTTPError, it's just an error returned by JSON? No, c.JSON returns error.
				// Usually nil if successful write.
			}

			// If no error returned, check recorder
			if rec.Code != tt.wantCode {
				t.Errorf("Expected status %d, got %d", tt.wantCode, rec.Code)
			}
		})
	}
}
