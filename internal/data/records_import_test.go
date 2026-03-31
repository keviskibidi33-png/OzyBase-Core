package data

import (
	"reflect"
	"testing"
)

func TestCollectBulkInsertColumnsSkipsInvalidAndSystemColumns(t *testing.T) {
	validCols := map[string]bool{
		"name":       true,
		"age":        true,
		"created_at": true,
		"deleted_at": true,
	}
	records := []map[string]any{
		{"name": "Alice", "age": "28", "id": "ignore-me", "bad-name": "skip"},
		{"age": "31", "created_at": "skip", "deleted_at": "skip"},
	}

	got := collectBulkInsertColumns(validCols, records)
	want := []string{"age", "name"}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected columns %v, got %v", want, got)
	}
}

func TestNormalizeBulkInsertValueTrimsStringsAndBlanksToNil(t *testing.T) {
	if got := normalizeBulkInsertValue("  Alice  "); got != "Alice" {
		t.Fatalf("expected trimmed string, got %#v", got)
	}

	if got := normalizeBulkInsertValue("   "); got != nil {
		t.Fatalf("expected blank string to normalize to nil, got %#v", got)
	}

	if got := normalizeBulkInsertValue(42); got != 42 {
		t.Fatalf("expected non-string values to stay unchanged, got %#v", got)
	}
}
