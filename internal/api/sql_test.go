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

func TestResolveSQLEditorMaxRowsDefaultsAndBounds(t *testing.T) {
	t.Setenv("OZY_SQL_EDITOR_MAX_ROWS", "")
	if got := resolveSQLEditorMaxRows(); got != defaultSQLEditorMaxRows {
		t.Fatalf("expected default %d, got %d", defaultSQLEditorMaxRows, got)
	}

	t.Setenv("OZY_SQL_EDITOR_MAX_ROWS", "50")
	if got := resolveSQLEditorMaxRows(); got != 100 {
		t.Fatalf("expected lower bound 100, got %d", got)
	}

	t.Setenv("OZY_SQL_EDITOR_MAX_ROWS", "20000")
	if got := resolveSQLEditorMaxRows(); got != 10000 {
		t.Fatalf("expected upper bound 10000, got %d", got)
	}

	t.Setenv("OZY_SQL_EDITOR_MAX_ROWS", "2500")
	if got := resolveSQLEditorMaxRows(); got != 2500 {
		t.Fatalf("expected explicit value 2500, got %d", got)
	}
}

func TestBuildSQLPreviewQueryWrapsPlainSelects(t *testing.T) {
	got := buildSQLPreviewQuery("SELECT * FROM demo ORDER BY id ASC;", 1000)
	want := "SELECT * FROM (SELECT * FROM demo ORDER BY id ASC) AS _ozy_preview LIMIT 1001"
	if got != want {
		t.Fatalf("unexpected preview query: %q", got)
	}
}

func TestBuildSQLPreviewQueryLeavesShowUntouched(t *testing.T) {
	query := "SHOW search_path"
	if got := buildSQLPreviewQuery(query, 1000); got != query {
		t.Fatalf("expected SHOW query to remain untouched, got %q", got)
	}
}

func TestBuildSQLPreviewQueryLeavesMultiStatementUntouched(t *testing.T) {
	query := "SELECT 1; SELECT 2;"
	if got := buildSQLPreviewQuery(query, 1000); got != query {
		t.Fatalf("expected multi-statement query to remain untouched, got %q", got)
	}
}
