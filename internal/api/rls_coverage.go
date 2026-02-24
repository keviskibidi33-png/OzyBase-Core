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
	TableName              string   `json:"table_name"`
	RLSDatabaseEnabled     bool     `json:"rls_db_enabled"`
	RLSMetadataEnabled     bool     `json:"rls_metadata_enabled"`
	OwnerColumnPresent     bool     `json:"owner_column_present"`
	EligibleForAutoEnforce bool     `json:"eligible_for_auto_enforce"`
	PolicyCount            int      `json:"policy_count"`
	MissingActions         []string `json:"missing_actions"`
	FullyCovered           bool     `json:"fully_covered"`
}

type RLSPolicyCoverageHistorySnapshot struct {
	ID            string    `json:"id"`
	RecordedAt    time.Time `json:"recorded_at"`
	TotalTables   int       `json:"total_tables"`
	FullyCovered  int       `json:"fully_covered"`
	CoverageRatio float64   `json:"coverage_ratio"`
}

type RLSPolicyCoverageSummary struct {
	TotalTables                int     `json:"total_tables"`
	FullyCovered               int     `json:"fully_covered"`
	TablesWithGaps             int     `json:"tables_with_gaps"`
	CoverageRatio              float64 `json:"coverage_ratio"`
	EligibleTables             int     `json:"eligible_tables"`
	EligibleFullyCovered       int     `json:"eligible_fully_covered"`
	EligibleTablesWithGaps     int     `json:"eligible_tables_with_gaps"`
	NonEligibleTables          int     `json:"non_eligible_tables"`
	KPIFullActionCoverageRatio float64 `json:"kpi_full_action_coverage_ratio"`
}

func (h *Handler) collectRLSPolicyCoverage(ctx context.Context) ([]RLSPolicyCoverage, error) {
	type tableInfo struct {
		name           string
		rlsDBEnabled   bool
		rlsMetaEnabled bool
		ownerColumn    bool
	}

	tables := make([]tableInfo, 0, 16)
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT
			c.relname,
			c.relrowsecurity,
			COALESCE(meta.rls_enabled, false),
			EXISTS (
				SELECT 1
				FROM information_schema.columns cols
				WHERE cols.table_schema = 'public'
				  AND cols.table_name = c.relname
				  AND cols.column_name IN ('owner_id', 'user_id', 'created_by')
			) AS owner_column_present
		FROM _v_collections meta
		JOIN pg_class c ON c.relname = meta.name
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public'
		  AND c.relkind = 'r'
		  AND meta.name NOT LIKE '\_v\_%' ESCAPE '\'
		  AND meta.name NOT LIKE '\_ozy\_%' ESCAPE '\'
		ORDER BY c.relname
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var t tableInfo
		if scanErr := rows.Scan(&t.name, &t.rlsDBEnabled, &t.rlsMetaEnabled, &t.ownerColumn); scanErr == nil {
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
			TableName:              t.name,
			RLSDatabaseEnabled:     t.rlsDBEnabled,
			RLSMetadataEnabled:     t.rlsMetaEnabled,
			OwnerColumnPresent:     t.ownerColumn,
			EligibleForAutoEnforce: t.ownerColumn,
			PolicyCount:            policyCount[t.name],
			MissingActions:         missing,
			FullyCovered:           t.rlsDBEnabled && len(missing) == 0,
		})
	}

	return coverage, nil
}

func summarizeRLSPolicyCoverage(coverage []RLSPolicyCoverage) RLSPolicyCoverageSummary {
	summary := RLSPolicyCoverageSummary{
		TotalTables: len(coverage),
	}
	for _, row := range coverage {
		if row.FullyCovered {
			summary.FullyCovered++
		}
		if row.EligibleForAutoEnforce {
			summary.EligibleTables++
			if row.FullyCovered {
				summary.EligibleFullyCovered++
			}
		}
	}
	summary.TablesWithGaps = summary.TotalTables - summary.FullyCovered
	summary.CoverageRatio = coverageRatio(summary.FullyCovered, summary.TotalTables)
	summary.EligibleTablesWithGaps = summary.EligibleTables - summary.EligibleFullyCovered
	summary.NonEligibleTables = summary.TotalTables - summary.EligibleTables
	summary.KPIFullActionCoverageRatio = coverageRatio(summary.EligibleFullyCovered, summary.EligibleTables)
	return summary
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
	summary := summarizeRLSPolicyCoverage(coverage)
	for _, row := range coverage {
		if onlyGaps && row.FullyCovered {
			continue
		}
		filtered = append(filtered, row)
	}
	snapshotID, snapshotAt, _ := h.persistRLSPolicyCoverageSnapshot(ctx, coverage, summary)

	return c.JSON(http.StatusOK, map[string]any{
		"total_tables":                   summary.TotalTables,
		"fully_covered":                  summary.FullyCovered,
		"tables_with_gaps":               summary.TablesWithGaps,
		"coverage_ratio":                 summary.CoverageRatio,
		"eligible_tables":                summary.EligibleTables,
		"eligible_fully_covered":         summary.EligibleFullyCovered,
		"eligible_tables_with_gaps":      summary.EligibleTablesWithGaps,
		"non_eligible_tables":            summary.NonEligibleTables,
		"kpi_full_action_coverage_ratio": summary.KPIFullActionCoverageRatio,
		"snapshot_id":                    snapshotID,
		"snapshot_recorded_at":           snapshotAt,
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
		SELECT id::text, recorded_at, total_tables, fully_covered, coverage_ratio
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
		if scanErr := rows.Scan(&row.ID, &row.RecordedAt, &row.TotalTables, &row.FullyCovered, &row.CoverageRatio); scanErr == nil {
			items = append(items, row)
		}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"items": items,
		"count": len(items),
	})
}

// RunRLSCloseout handles POST /api/project/security/rls/closeout
func (h *Handler) RunRLSCloseout(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 30*time.Second)
	defer cancel()

	var req struct {
		DryRun      bool   `json:"dry_run"`
		RulePattern string `json:"rule_pattern"`
		AutoEnforce *bool  `json:"auto_enforce"`
	}
	_ = c.Bind(&req)

	dryRun := req.DryRun || strings.EqualFold(strings.TrimSpace(c.QueryParam("dry_run")), "true")
	autoEnforce := true
	if req.AutoEnforce != nil {
		autoEnforce = *req.AutoEnforce
	}
	if raw := strings.TrimSpace(c.QueryParam("auto_enforce")); raw != "" {
		autoEnforce = strings.EqualFold(raw, "true")
	}

	results := make([]EnforceRLSResult, 0, 16)
	enforcedCount := 0
	if autoEnforce {
		enforced, count, err := h.enforceRLSAllInternal(ctx, dryRun, req.RulePattern)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "failed to execute RLS closeout enforcement",
			})
		}
		results = enforced
		enforcedCount = count
	}

	coverage, err := h.collectRLSPolicyCoverage(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "failed to compute RLS coverage after closeout",
		})
	}
	summary := summarizeRLSPolicyCoverage(coverage)

	gaps := make([]RLSPolicyCoverage, 0, len(coverage))
	nonEligible := make([]RLSPolicyCoverage, 0, len(coverage))
	for _, item := range coverage {
		if !item.EligibleForAutoEnforce {
			nonEligible = append(nonEligible, item)
			continue
		}
		if !item.FullyCovered {
			gaps = append(gaps, item)
		}
	}

	snapshotID := ""
	var snapshotAt time.Time
	if !dryRun {
		var persistErr error
		snapshotID, snapshotAt, persistErr = h.persistRLSPolicyCoverageSnapshot(ctx, coverage, summary)
		if persistErr != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{
				"error": "failed to persist RLS closeout evidence",
			})
		}
	}

	status := "pass"
	if dryRun {
		status = "preview"
	} else if summary.KPIFullActionCoverageRatio < 1 {
		status = "fail"
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status":       status,
		"dry_run":      dryRun,
		"auto_enforce": autoEnforce,
		"summary":      summary,
		"enforcement": map[string]any{
			"attempted": len(results),
			"enforced":  enforcedCount,
			"results":   results,
		},
		"gaps":         gaps,
		"non_eligible": nonEligible,
		"evidence": map[string]any{
			"snapshot_id":       snapshotID,
			"snapshot_recorded": snapshotAt,
			"history_endpoint":  "/api/project/security/rls/coverage/history",
		},
	})
}

func (h *Handler) persistRLSPolicyCoverageSnapshot(ctx context.Context, coverage []RLSPolicyCoverage, summary RLSPolicyCoverageSummary) (string, time.Time, error) {
	details, err := json.Marshal(map[string]any{
		"summary": summary,
		"items":   coverage,
	})
	if err != nil {
		return "", time.Time{}, err
	}
	var id string
	var recordedAt time.Time
	err = h.DB.Pool.QueryRow(ctx, `
		INSERT INTO _v_rls_coverage_history (total_tables, fully_covered, coverage_ratio, details)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, recorded_at
	`, summary.EligibleTables, summary.EligibleFullyCovered, summary.KPIFullActionCoverageRatio, details).Scan(&id, &recordedAt)
	if err != nil {
		return "", time.Time{}, err
	}
	return id, recordedAt, nil
}

func coverageRatio(covered, total int) float64 {
	if total == 0 {
		return 1
	}
	return float64(covered) / float64(total)
}
