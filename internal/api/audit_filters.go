package api

import (
	"fmt"
	"strings"
)

var performanceSignalExcludedAuditPathPrefixes = []string{
	"/api/project/logs",
	"/api/project/info",
	"/api/project/update-status",
	"/api/project/observability/slo",
	"/api/project/security/alert-routing",
	"/api/project/health",
	"/api/analytics/traffic",
	"/api/analytics/geo",
	"/api/health",
	"/api/system/status",
	"/api/realtime",
	"/api/auth/login",
	"/api/auth/signup",
	"/api/auth/reset-password/confirm",
}

func isExcludedFromPerformanceSignals(path string) bool {
	normalized := strings.ToLower(strings.TrimSpace(path))
	for _, prefix := range performanceSignalExcludedAuditPathPrefixes {
		if strings.HasPrefix(normalized, prefix) {
			return true
		}
	}
	return false
}

func buildPerformanceSignalExclusionSQL(column string) string {
	if strings.TrimSpace(column) == "" {
		column = "path"
	}

	var builder strings.Builder
	for _, prefix := range performanceSignalExcludedAuditPathPrefixes {
		builder.WriteString("\n  AND ")
		builder.WriteString(column)
		builder.WriteString(fmt.Sprintf(" NOT LIKE '%s%%'", prefix))
	}
	return builder.String()
}
