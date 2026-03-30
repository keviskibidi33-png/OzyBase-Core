package api

import (
	"strings"
	"testing"
)

func TestIsExcludedFromPerformanceSignals(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		path string
		want bool
	}{
		{name: "realtime stream", path: "/api/realtime", want: true},
		{name: "realtime nested", path: "/api/realtime/stream", want: true},
		{name: "health polling", path: "/api/project/health", want: true},
		{name: "storage request", path: "/api/files/buckets", want: false},
		{name: "auth login", path: "/api/auth/login", want: true},
		{name: "auth password reset confirm", path: "/api/auth/reset-password/confirm", want: true},
		{name: "auth providers", path: "/api/auth/providers", want: false},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := isExcludedFromPerformanceSignals(tc.path); got != tc.want {
				t.Fatalf("isExcludedFromPerformanceSignals(%q) = %v, want %v", tc.path, got, tc.want)
			}
		})
	}
}

func TestBuildPerformanceSignalExclusionSQL(t *testing.T) {
	t.Parallel()

	sql := buildPerformanceSignalExclusionSQL("logs.path")
	for _, prefix := range performanceSignalExcludedAuditPathPrefixes {
		expected := "logs.path NOT LIKE '" + prefix + "%'"
		if !strings.Contains(sql, expected) {
			t.Fatalf("expected SQL filter to contain %q, got %q", expected, sql)
		}
	}
}
