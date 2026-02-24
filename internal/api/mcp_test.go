package api

import "testing"

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
