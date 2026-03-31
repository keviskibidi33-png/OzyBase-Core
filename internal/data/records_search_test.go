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

func TestNormalizeRecordCountMode(t *testing.T) {
	tests := []struct {
		name    string
		filters map[string][]string
		want    recordCountMode
	}{
		{
			name:    "defaults to exact",
			filters: map[string][]string{},
			want:    recordCountExact,
		},
		{
			name:    "skip_count forces deferred",
			filters: map[string][]string{"skip_count": {"1"}},
			want:    recordCountDeferred,
		},
		{
			name:    "auto mode respected",
			filters: map[string][]string{"count_mode": {"auto"}},
			want:    recordCountAuto,
		},
		{
			name:    "explicit deferred alias respected",
			filters: map[string][]string{"count_mode": {"skip"}},
			want:    recordCountDeferred,
		},
		{
			name:    "exact mode respected",
			filters: map[string][]string{"count_mode": {"exact"}},
			want:    recordCountExact,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeRecordCountMode(tt.filters); got != tt.want {
				t.Fatalf("normalizeRecordCountMode() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestShouldUseDeferredRecordCount(t *testing.T) {
	tests := []struct {
		name        string
		mode        recordCountMode
		hasSearch   bool
		offset      int
		filterCount int
		want        bool
	}{
		{name: "exact mode keeps count", mode: recordCountExact, want: false},
		{name: "deferred mode skips count", mode: recordCountDeferred, want: true},
		{name: "auto mode skips search", mode: recordCountAuto, hasSearch: true, want: true},
		{name: "auto mode skips deep page", mode: recordCountAuto, offset: 100, want: true},
		{name: "auto mode skips filtered queries", mode: recordCountAuto, filterCount: 2, want: true},
		{name: "auto mode keeps plain first page exact", mode: recordCountAuto, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := shouldUseDeferredRecordCount(tt.mode, tt.hasSearch, tt.offset, tt.filterCount); got != tt.want {
				t.Fatalf("shouldUseDeferredRecordCount() = %v, want %v", got, tt.want)
			}
		})
	}
}
