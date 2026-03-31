package data

import (
	"strings"
	"testing"
)

func TestIsSearchableRecordColumnType(t *testing.T) {
	tests := []struct {
		name     string
		dataType string
		want     bool
	}{
		{name: "text", dataType: "text", want: true},
		{name: "varchar", dataType: "character varying", want: true},
		{name: "uuid", dataType: "uuid", want: true},
		{name: "integer", dataType: "integer", want: false},
		{name: "jsonb", dataType: "jsonb", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isSearchableRecordColumnType(tt.dataType); got != tt.want {
				t.Fatalf("isSearchableRecordColumnType(%q) = %v, want %v", tt.dataType, got, tt.want)
			}
		})
	}
}

func TestBuildRecordSearchClauseIncludesOnlySupportedColumns(t *testing.T) {
	columnTypes := map[string]string{
		"id":         "uuid",
		"title":      "text",
		"slug":       "character varying",
		"amount":     "integer",
		"payload":    "jsonb",
		"deleted_at": "timestamp with time zone",
	}

	got := buildRecordSearchClause(columnTypes, "$1")
	expectedFragments := []string{
		"id::text ILIKE $1",
		"slug::text ILIKE $1",
		"title::text ILIKE $1",
	}
	for _, fragment := range expectedFragments {
		if !strings.Contains(got, fragment) {
			t.Fatalf("expected search clause to contain %q, got %q", fragment, got)
		}
	}

	unexpectedFragments := []string{
		"amount::text ILIKE $1",
		"payload::text ILIKE $1",
		"deleted_at::text ILIKE $1",
	}
	for _, fragment := range unexpectedFragments {
		if strings.Contains(got, fragment) {
			t.Fatalf("did not expect search clause to contain %q, got %q", fragment, got)
		}
	}
}
