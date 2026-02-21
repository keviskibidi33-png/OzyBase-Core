package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestErrorEnvelopeMiddlewareWrapsJSONErrors(t *testing.T) {
	e := echo.New()
	e.HTTPErrorHandler = HTTPErrorHandler
	e.Use(RequestIDMiddleware())
	e.Use(ErrorEnvelopeMiddleware())

	e.GET("/bad", func(c echo.Context) error {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "invalid payload",
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/bad", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}

	if body["error"] != "invalid payload" {
		t.Fatalf("expected error message, got %v", body["error"])
	}
	if body["error_code"] == nil || body["error_code"] == "" {
		t.Fatalf("expected error_code in envelope")
	}
	if body["request_id"] == nil || body["request_id"] == "" {
		t.Fatalf("expected request_id in envelope")
	}
}

func TestHTTPErrorHandlerUsesEnvelope(t *testing.T) {
	e := echo.New()
	e.HTTPErrorHandler = HTTPErrorHandler
	e.Use(RequestIDMiddleware())
	e.Use(ErrorEnvelopeMiddleware())

	e.GET("/missing", func(c echo.Context) error {
		return echo.NewHTTPError(http.StatusNotFound, "resource missing")
	})

	req := httptest.NewRequest(http.MethodGet, "/missing", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["error"] != "resource missing" {
		t.Fatalf("expected http error message, got %v", body["error"])
	}
	if body["error_code"] != "NOT_FOUND" {
		t.Fatalf("expected NOT_FOUND code, got %v", body["error_code"])
	}
	if body["request_id"] == nil || body["request_id"] == "" {
		t.Fatalf("expected request_id in envelope")
	}
}

func TestErrorEnvelopePreservesCustomErrorCode(t *testing.T) {
	e := echo.New()
	e.HTTPErrorHandler = HTTPErrorHandler
	e.Use(RequestIDMiddleware())
	e.Use(ErrorEnvelopeMiddleware())

	e.GET("/custom", func(c echo.Context) error {
		return c.JSON(http.StatusBadRequest, map[string]any{
			"error":      "custom validation failed",
			"error_code": "RLS_INVALID_ACTION",
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/custom", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["error_code"] != "RLS_INVALID_ACTION" {
		t.Fatalf("expected custom error_code preserved, got %v", body["error_code"])
	}
	if body["request_id"] == nil || body["request_id"] == "" {
		t.Fatalf("expected request_id in envelope")
	}
}

func TestErrorEnvelopeConvertsLegacyMessagePayload(t *testing.T) {
	e := echo.New()
	e.HTTPErrorHandler = HTTPErrorHandler
	e.Use(RequestIDMiddleware())
	e.Use(ErrorEnvelopeMiddleware())

	e.GET("/legacy", func(c echo.Context) error {
		return c.JSON(http.StatusBadRequest, map[string]any{
			"message": "legacy endpoint error",
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/legacy", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["error"] != "legacy endpoint error" {
		t.Fatalf("expected legacy message to be mapped to error, got %v", body["error"])
	}
	if body["error_code"] != "BAD_REQUEST" {
		t.Fatalf("expected BAD_REQUEST code, got %v", body["error_code"])
	}
	if body["request_id"] == nil || body["request_id"] == "" {
		t.Fatalf("expected request_id in envelope")
	}
}

func TestInferErrorCode(t *testing.T) {
	tests := []struct {
		status int
		code   string
	}{
		{status: http.StatusBadRequest, code: "BAD_REQUEST"},
		{status: http.StatusUnauthorized, code: "UNAUTHORIZED"},
		{status: http.StatusForbidden, code: "FORBIDDEN"},
		{status: http.StatusNotFound, code: "NOT_FOUND"},
		{status: http.StatusTooManyRequests, code: "RATE_LIMITED"},
		{status: http.StatusInternalServerError, code: "INTERNAL_ERROR"},
	}

	for _, tt := range tests {
		if got := inferErrorCode(tt.status); got != tt.code {
			t.Fatalf("status %d expected %s, got %s", tt.status, tt.code, got)
		}
	}
}
