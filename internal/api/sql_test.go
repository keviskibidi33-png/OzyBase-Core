package api

import "testing"

func TestSQLStatementKindSkipsLeadingComments(t *testing.T) {
	got := sqlStatementKind("-- seed comment\n/* still comment */\nselect * from demo")
	if got != "SELECT" {
		t.Fatalf("expected SELECT, got %q", got)
	}
}

func TestSQLQueryProducesRows(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  bool
	}{
		{name: "select", query: "SELECT * FROM demo", want: true},
		{name: "show", query: "SHOW search_path", want: true},
		{name: "insert without returning", query: "INSERT INTO demo(id) VALUES (1)", want: false},
		{name: "insert with returning", query: "INSERT INTO demo(id) VALUES (1) RETURNING id", want: true},
		{name: "create table", query: "CREATE TABLE demo(id int)", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sqlQueryProducesRows(tt.query)
			if got != tt.want {
				t.Fatalf("expected %v, got %v", tt.want, got)
			}
		})
	}
}

func TestSQLExecutionMessage(t *testing.T) {
	if got := sqlExecutionMessage("UPDATE", false, 0, 3); got != "UPDATE executed successfully. 3 row(s) affected." {
		t.Fatalf("unexpected message: %q", got)
	}
	if got := sqlExecutionMessage("CREATE", false, 0, 0); got != "CREATE executed successfully." {
		t.Fatalf("unexpected message: %q", got)
	}
	if got := sqlExecutionMessage("SELECT", true, 2, 2); got != "SELECT returned 2 row(s)." {
		t.Fatalf("unexpected message: %q", got)
	}
}

func TestSplitSQLStatementsStripsComments(t *testing.T) {
	got := splitSQLStatements(`
		-- comment before statement
		CREATE TABLE demo (id uuid primary key);
		/* block comment */
		ALTER TABLE demo ADD COLUMN name text;
	`)

	if len(got) != 2 {
		t.Fatalf("expected 2 statements, got %d", len(got))
	}
	if got[0] != "CREATE TABLE demo (id uuid primary key)" {
		t.Fatalf("unexpected first statement: %q", got[0])
	}
	if got[1] != "ALTER TABLE demo ADD COLUMN name text" {
		t.Fatalf("unexpected second statement: %q", got[1])
	}
}

func TestExtractSQLTableMutations(t *testing.T) {
	got := extractSQLTableMutations(`
		CREATE TABLE IF NOT EXISTS public.accounts (id uuid primary key);
		ALTER TABLE accounts RENAME TO customer_accounts;
		DROP TABLE IF EXISTS public.audit_log, customer_accounts CASCADE;
	`)

	want := []sqlTableMutation{
		{Action: "upsert", TableName: "accounts"},
		{Action: "rename", PreviousTable: "accounts", TableName: "customer_accounts"},
		{Action: "drop", TableName: "audit_log"},
		{Action: "drop", TableName: "customer_accounts"},
	}

	if len(got) != len(want) {
		t.Fatalf("expected %d mutations, got %d: %#v", len(want), len(got), got)
	}

	for idx := range want {
		if got[idx] != want[idx] {
			t.Fatalf("unexpected mutation at index %d: want %#v got %#v", idx, want[idx], got[idx])
		}
	}
}

func TestNormalizePublicTableIdentifierRejectsUnsupportedNames(t *testing.T) {
	if _, ok := normalizePublicTableIdentifier(`private.accounts`); ok {
		t.Fatalf("expected private schema identifier to be rejected")
	}
	if _, ok := normalizePublicTableIdentifier(`"bad-name"`); ok {
		t.Fatalf("expected unsupported quoted identifier to be rejected")
	}
}
