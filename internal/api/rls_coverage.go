package api

import (
	"context"
	"net/http"
	"sort"
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

	return c.JSON(http.StatusOK, map[string]any{
		"total_tables":   len(coverage),
		"fully_covered":  fullyCovered,
		"coverage_ratio": coverageRatio(fullyCovered, len(coverage)),
		"items":          filtered,
	})
}

func coverageRatio(covered, total int) float64 {
	if total == 0 {
		return 1
	}
	return float64(covered) / float64(total)
}
