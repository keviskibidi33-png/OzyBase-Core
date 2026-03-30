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
