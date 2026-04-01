package data

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func TestCollectBulkInsertColumnsSkipsInvalidAndSystemColumns(t *testing.T) {
	validColumns := map[string]bool{
		"name":       true,
		"age":        true,
		"created_at": true,
		"deleted_at": true,
	}
	records := []map[string]any{
		{"name": "Alice", "age": "28", "id": "ignore-me", "bad-name": "skip"},
		{"age": "31", "created_at": "skip", "deleted_at": "skip"},
	}

	got := collectBulkInsertColumns(validColumns, records)
	want := []string{"age", "name"}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected columns %v, got %v", want, got)
	}
}

func TestNormalizeImportedValue(t *testing.T) {
	t.Run("empty strings become null", func(t *testing.T) {
		value, err := normalizeImportedValue("text", "   ")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if value != nil {
			t.Fatalf("expected nil for blank text, got %#v", value)
		}
	})

	t.Run("integer strings are coerced", func(t *testing.T) {
		value, err := normalizeImportedValue("bigint", "42")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got, ok := value.(int64); !ok || got != 42 {
			t.Fatalf("expected int64(42), got %#v", value)
		}
	})

	t.Run("boolean aliases are accepted", func(t *testing.T) {
		value, err := normalizeImportedValue("boolean", "yes")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got, ok := value.(bool); !ok || !got {
			t.Fatalf("expected true, got %#v", value)
		}
	})

	t.Run("json strings are preserved as raw json", func(t *testing.T) {
		value, err := normalizeImportedValue("jsonb", `{"name":"alice"}`)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		raw, ok := value.(json.RawMessage)
		if !ok {
			t.Fatalf("expected json.RawMessage, got %#v", value)
		}
		if string(raw) != `{"name":"alice"}` {
			t.Fatalf("unexpected json payload: %s", string(raw))
		}
	})

	t.Run("timestamps parse into time values", func(t *testing.T) {
		value, err := normalizeImportedValue("timestamp without time zone", "2026-03-31 19:30:00")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if _, ok := value.(time.Time); !ok {
			t.Fatalf("expected time.Time, got %#v", value)
		}
	})

	t.Run("invalid integer returns context error", func(t *testing.T) {
		if _, err := normalizeImportedValue("integer", "abc"); err == nil {
			t.Fatalf("expected integer coercion error")
		}
	})
}
