package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestNormalizeACLRule(t *testing.T) {
	allowed := map[string]struct{}{
		"public": {},
		"auth":   {},
		"admin":  {},
	}

	tests := []struct {
		name     string
		input    string
		fallback string
		want     string
		wantErr  bool
	}{
		{name: "explicit auth", input: "auth", fallback: "admin", want: "auth"},
		{name: "fallback used", input: "", fallback: "admin", want: "admin"},
		{name: "normalized uppercase", input: "PUBLIC", fallback: "auth", want: "public"},
		{name: "invalid", input: "manager", fallback: "auth", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeACLRule(tt.input, tt.fallback, allowed)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error for input %q", tt.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("normalizeACLRule(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestMCPParseSchema(t *testing.T) {
	t.Run("valid schema", func(t *testing.T) {
		args := map[string]any{
			"schema": []any{
				map[string]any{
					"name":     "owner_id",
					"type":     "uuid",
					"required": true,
				},
				map[string]any{
					"name":   "title",
					"type":   "text",
					"unique": false,
				},
			},
		}

		fields, err := mcpParseSchema(args)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(fields) != 2 {
			t.Fatalf("expected 2 fields, got %d", len(fields))
		}
		if fields[0].Name != "owner_id" || fields[0].Type != "uuid" || !fields[0].Required {
			t.Fatalf("unexpected first field: %+v", fields[0])
		}
	})

	t.Run("missing schema", func(t *testing.T) {
		if _, err := mcpParseSchema(map[string]any{}); err == nil {
			t.Fatalf("expected error for missing schema")
		}
	})

	t.Run("invalid schema entry", func(t *testing.T) {
		args := map[string]any{
			"schema": []any{
				map[string]any{
					"name": "invalid-name",
					"type": "text",
				},
			},
		}
		if _, err := mcpParseSchema(args); err == nil {
			t.Fatalf("expected validation error for invalid identifier")
		}
	})
}

func TestHandleMCPRPCInitialize(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/project/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := &Handler{}
	if err := h.HandleMCPRPC(c); err != nil {
		t.Fatalf("HandleMCPRPC returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if payload["jsonrpc"] != "2.0" {
		t.Fatalf("expected jsonrpc 2.0, got %v", payload["jsonrpc"])
	}
	result, ok := payload["result"].(map[string]any)
	if !ok {
		t.Fatalf("expected result object, got %T", payload["result"])
	}
	serverInfo, ok := result["serverInfo"].(map[string]any)
	if !ok || serverInfo["name"] != "OzyBase" {
		t.Fatalf("expected OzyBase serverInfo, got %+v", result["serverInfo"])
	}
}

func TestHandleMCPRPCToolsList(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/project/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	h := &Handler{}
	if err := h.HandleMCPRPC(c); err != nil {
		t.Fatalf("HandleMCPRPC returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	result, ok := payload["result"].(map[string]any)
	if !ok {
		t.Fatalf("expected result object, got %T", payload["result"])
	}
	tools, ok := result["tools"].([]any)
	if !ok || len(tools) == 0 {
		t.Fatalf("expected non-empty tool list, got %+v", result["tools"])
	}
}
