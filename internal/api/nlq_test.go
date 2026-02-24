package api

import "testing"

func TestDetectNLQCountIntent(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  bool
	}{
		{name: "english count", query: "count users", want: true},
		{name: "english how many", query: "how many orders today", want: true},
		{name: "spanish cuantos", query: "cuantos usuarios hay", want: true},
		{name: "spanish con tilde", query: "cuántos pagos", want: true},
		{name: "list request", query: "list users", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := detectNLQCountIntent(tt.query)
			if got != tt.want {
				t.Fatalf("detectNLQCountIntent(%q) = %v, want %v", tt.query, got, tt.want)
			}
		})
	}
}

func TestExtractNLQLimit(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  int
	}{
		{name: "english limit", query: "list users limit 12", want: 12},
		{name: "spanish limite", query: "listar usuarios limite 7", want: 7},
		{name: "spanish límite", query: "listar usuarios límite 4", want: 4},
		{name: "default fallback", query: "list users", want: defaultNLQLimit},
		{name: "max cap", query: "list users limit 999999", want: maxNLQLimit},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractNLQLimit(tt.query)
			if got != tt.want {
				t.Fatalf("extractNLQLimit(%q) = %d, want %d", tt.query, got, tt.want)
			}
		})
	}
}

func TestExtractNLQWhereClause(t *testing.T) {
	tests := []struct {
		name      string
		query     string
		wantField string
		wantValue string
		wantFound bool
	}{
		{name: "english where quoted", query: `list users where role = "admin"`, wantField: "role", wantValue: "admin", wantFound: true},
		{name: "english where single quoted", query: "list users where status = 'active'", wantField: "status", wantValue: "active", wantFound: true},
		{name: "english where bare", query: "list users where id = 123", wantField: "id", wantValue: "123", wantFound: true},
		{name: "spanish donde", query: "listar users donde role = admin", wantField: "role", wantValue: "admin", wantFound: true},
		{name: "no where clause", query: "list users", wantFound: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			field, value, found := extractNLQWhereClause(tt.query)
			if found != tt.wantFound {
				t.Fatalf("extractNLQWhereClause(%q) found=%v, want %v", tt.query, found, tt.wantFound)
			}
			if !tt.wantFound {
				return
			}
			if field != tt.wantField || value != tt.wantValue {
				t.Fatalf("extractNLQWhereClause(%q) = (%q,%q), want (%q,%q)", tt.query, field, value, tt.wantField, tt.wantValue)
			}
		})
	}
}

func TestResolveNLQTable(t *testing.T) {
	candidates := []string{"users", "orders", "order_items"}

	t.Run("explicit table", func(t *testing.T) {
		got, err := resolveNLQTable("list everything", "orders", candidates)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "orders" {
			t.Fatalf("got %q, want %q", got, "orders")
		}
	})

	t.Run("inferred table from text", func(t *testing.T) {
		got, err := resolveNLQTable("list order_items limit 5", "", candidates)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "order_items" {
			t.Fatalf("got %q, want %q", got, "order_items")
		}
	})

	t.Run("unknown explicit table", func(t *testing.T) {
		if _, err := resolveNLQTable("list whatever", "payments", candidates); err == nil {
			t.Fatalf("expected error for unknown explicit table")
		}
	})

	t.Run("cannot infer", func(t *testing.T) {
		if _, err := resolveNLQTable("show records", "", candidates); err == nil {
			t.Fatalf("expected inference error")
		}
	})
}
