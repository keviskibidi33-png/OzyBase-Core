package api

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

var rlsActions = []string{"select", "insert", "update", "delete"}

type RLSPolicyCoverage struct {
	TableName          string   `json:"table_name"`
	RLSDatabaseEnabled bool     `json:"rls_db_enabled"`
	RLSMetadataEnabled bool     `json:"rls_metadata_enabled"`
	PolicyCount        int      `json:"policy_count"`
	MissingActions     []string `json:"missing_actions"`
	FullyCovered       bool     `json:"fully_covered"`
}

type RLSPolicyCoverageHistorySnapshot struct {
	RecordedAt    time.Time `json:"recorded_at"`
	TotalTables   int       `json:"total_tables"`
	FullyCovered  int       `json:"fully_covered"`
	CoverageRatio float64   `json:"coverage_ratio"`
}

func (h *Handler) collectRLSPolicyCoverage(ctx context.Context) ([]RLSPolicyCoverage, error) {
	type tableInfo struct {
		name           string
		rlsDBEnabled   bool
		rlsMetaEnabled bool
	}

	tables := make([]tableInfo, 0, 16)
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT c.relname, c.relrowsecurity, COALESCE(meta.rls_enabled, false)
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN _v_collections meta ON meta.name = c.relname
		WHERE n.nspname = 'public'
		  AND c.relkind = 'r'
		  AND c.relname NOT LIKE '\_v\_%' ESCAPE '\'
		  AND c.relname NOT LIKE '\_ozy\_%' ESCAPE '\'
		ORDER BY c.relname
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var t tableInfo
		if scanErr := rows.Scan(&t.name, &t.rlsDBEnabled, &t.rlsMetaEnabled); scanErr == nil {
			tables = append(tables, t)
		}
	}

	type policyRow struct {
		table string
		cmd   string
	}

	policyRows, err := h.DB.Pool.Query(ctx, `
		SELECT tablename, cmd
		FROM pg_policies
		WHERE schemaname = 'public'
		  AND tablename NOT LIKE '\_v\_%' ESCAPE '\'
		  AND tablename NOT LIKE '\_ozy\_%' ESCAPE '\'
	`)
	if err != nil {
		return nil, err
	}
	defer policyRows.Close()

	actionMap := make(map[string]map[string]bool)
	policyCount := make(map[string]int)
	for policyRows.Next() {
		var row policyRow
		if scanErr := policyRows.Scan(&row.table, &row.cmd); scanErr != nil {
			continue
		}

		if _, ok := actionMap[row.table]; !ok {
			actionMap[row.table] = make(map[string]bool)
		}
		cmd := strings.ToLower(strings.TrimSpace(row.cmd))
		if cmd == "all" {
			for _, act := range rlsActions {
				actionMap[row.table][act] = true
			}
		} else {
			actionMap[row.table][cmd] = true
		}
		policyCount[row.table]++
	}

	coverage := make([]RLSPolicyCoverage, 0, len(tables))
	for _, t := range tables {
		missing := make([]string, 0, 4)
		for _, action := range rlsActions {
			if !actionMap[t.name][action] {
				missing = append(missing, action)
			}
		}
		sort.Strings(missing)

		coverage = append(coverage, RLSPolicyCoverage{
			TableName:          t.name,
			RLSDatabaseEnabled: t.rlsDBEnabled,
			RLSMetadataEnabled: t.rlsMetaEnabled,
			PolicyCount:        policyCount[t.name],
			MissingActions:     missing,
			FullyCovered:       t.rlsDBEnabled && len(missing) == 0,
		})
	}

	return coverage, nil
}

// GetRLSPolicyCoverage handles GET /api/project/security/rls/coverage
func (h *Handler) GetRLSPolicyCoverage(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	coverage, err := h.collectRLSPolicyCoverage(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "failed to compute RLS coverage",
		})
	}

	onlyGaps := strings.EqualFold(strings.TrimSpace(c.QueryParam("only_gaps")), "true")
	filtered := make([]RLSPolicyCoverage, 0, len(coverage))
	fullyCovered := 0
	for _, row := range coverage {
		if row.FullyCovered {
			fullyCovered++
		}
		if onlyGaps && row.FullyCovered {
			continue
		}
		filtered = append(filtered, row)
	}
	_ = h.persistRLSPolicyCoverageSnapshot(ctx, coverage, fullyCovered)

	return c.JSON(http.StatusOK, map[string]any{
		"total_tables":                   len(coverage),
		"fully_covered":                  fullyCovered,
		"tables_with_gaps":               len(coverage) - fullyCovered,
		"coverage_ratio":                 coverageRatio(fullyCovered, len(coverage)),
		"kpi_full_action_coverage_ratio": coverageRatio(fullyCovered, len(coverage)),
		"items":                          filtered,
	})
}

// GetRLSPolicyCoverageHistory handles GET /api/project/security/rls/coverage/history
func (h *Handler) GetRLSPolicyCoverageHistory(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	limit := 30
	if raw := strings.TrimSpace(c.QueryParam("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 365 {
		limit = 365
	}

	rows, err := h.DB.Pool.Query(ctx, `
		SELECT recorded_at, total_tables, fully_covered, coverage_ratio
		FROM _v_rls_coverage_history
		ORDER BY recorded_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "failed to load RLS coverage history",
		})
	}
	defer rows.Close()

	items := make([]RLSPolicyCoverageHistorySnapshot, 0, limit)
	for rows.Next() {
		var row RLSPolicyCoverageHistorySnapshot
		if scanErr := rows.Scan(&row.RecordedAt, &row.TotalTables, &row.FullyCovered, &row.CoverageRatio); scanErr == nil {
			items = append(items, row)
		}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"items": items,
		"count": len(items),
	})
}

func (h *Handler) persistRLSPolicyCoverageSnapshot(ctx context.Context, coverage []RLSPolicyCoverage, fullyCovered int) error {
	details, err := json.Marshal(coverage)
	if err != nil {
		return err
	}
	_, err = h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_rls_coverage_history (total_tables, fully_covered, coverage_ratio, details)
		VALUES ($1, $2, $3, $4)
	`, len(coverage), fullyCovered, coverageRatio(fullyCovered, len(coverage)), details)
	return err
}

func coverageRatio(covered, total int) float64 {
	if total == 0 {
		return 1
	}
	return float64(covered) / float64(total)
}
