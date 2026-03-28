package api

import (
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestActorUserIDFromContext(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	validUserID := "9f21d7a4-03ad-4ffc-9bdf-28f73322a4bf"
	c.Set("user_id", validUserID)

	actor := actorUserIDFromContext(c)
	if actor == nil {
		t.Fatalf("expected actor user id")
	} else if actorID := *actor; actorID != validUserID {
		t.Fatalf("unexpected actor user id: %s", actorID)
	}
}

func TestActorUserIDFromContext_InvalidValues(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest("GET", "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	c.Set("user_id", "service_role_static")
	if actor := actorUserIDFromContext(c); actor != nil {
		t.Fatalf("expected nil actor for non-uuid user_id")
	}

	c.Set("user_id", "")
	if actor := actorUserIDFromContext(c); actor != nil {
		t.Fatalf("expected nil actor for empty user_id")
	}
}

func TestGenerateRandomKey(t *testing.T) {
	key, err := GenerateRandomKey()
	if err != nil {
		t.Fatalf("expected no error generating key, got %v", err)
	}
	if len(key) != 64 {
		t.Fatalf("expected 64-char key, got %d", len(key))
	}
}
