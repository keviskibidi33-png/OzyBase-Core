package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/labstack/echo/v4"
)

var (
	uuidPathPartPattern = regexp.MustCompile(`(?i)^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
	intPathPartPattern  = regexp.MustCompile(`^\d+$`)
)

type hotPath struct {
	Endpoint string `json:"endpoint"`
	Table    string `json:"table,omitempty"`
	Hits     int64  `json:"hits"`
}

type explainSample struct {
	Endpoint        string                `json:"endpoint"`
	Table           string                `json:"table,omitempty"`
	Query           string                `json:"query"`
	PlanSummary     string                `json:"plan_summary"`
	HasSeqScan      bool                  `json:"has_seq_scan"`
	EstimatedRows   int64                 `json:"estimated_rows"`
	Recommendations []indexRecommendation `json:"recommendations"`
}

type indexRecommendation struct {
	Endpoint   string `json:"endpoint"`
	Table      string `json:"table"`
	Column     string `json:"column"`
	Reason     string `json:"reason"`
	SQL        string `json:"sql"`
	Confidence string `json:"confidence"`
}

type planNode struct {
	NodeType  string     `json:"Node Type"`
	PlanRows  float64    `json:"Plan Rows"`
	TotalCost float64    `json:"Total Cost"`
	Plans     []planNode `json:"Plans"`
}

type explainRoot struct {
	Plan planNode `json:"Plan"`
}

func (h *Handler) GetPerformanceAdvisor(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	hours := 1
	if raw := strings.TrimSpace(c.QueryParam("hours")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 && v <= 24 {
			hours = v
		}
	}
	top := 10
	if raw := strings.TrimSpace(c.QueryParam("top")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 && v <= 50 {
			top = v
		}
	}

	hotPaths, err := h.collectHotPaths(ctx, hours, top)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to collect hot paths"})
	}

	samples := make([]explainSample, 0, len(hotPaths))
	recommendations := make([]indexRecommendation, 0, len(hotPaths))
	seenRec := map[string]struct{}{}

	for _, hp := range hotPaths {
		if hp.Table == "" || strings.HasPrefix(strings.ToLower(hp.Table), "_v_") || strings.HasPrefix(strings.ToLower(hp.Table), "_ozy_") {
			continue
		}
		if !data.IsValidIdentifier(hp.Table) {
			continue
		}

		query, err := h.pickSampleQuery(ctx, hp.Table)
		if err != nil {
			continue
		}
		planSummary, hasSeqScan, estRows, err := h.runExplainSample(ctx, query)
		if err != nil {
			continue
		}

		recForSample := h.recommendIndexesForSample(ctx, hp.Endpoint, hp.Table, hasSeqScan)
		for _, rec := range recForSample {
			key := rec.Table + ":" + rec.Column + ":" + rec.Endpoint
			if _, ok := seenRec[key]; ok {
				continue
			}
			seenRec[key] = struct{}{}
			recommendations = append(recommendations, rec)
		}

		sample := explainSample{
			Endpoint:        hp.Endpoint,
			Table:           hp.Table,
			Query:           query,
			PlanSummary:     planSummary,
			HasSeqScan:      hasSeqScan,
			EstimatedRows:   estRows,
			Recommendations: recForSample,
		}
		samples = append(samples, sample)
		_ = h.persistExplainSample(ctx, sample)
	}

	sort.Slice(recommendations, func(i, j int) bool {
		if recommendations[i].Table == recommendations[j].Table {
			return recommendations[i].Column < recommendations[j].Column
		}
		return recommendations[i].Table < recommendations[j].Table
	})

	return c.JSON(http.StatusOK, map[string]any{
		"window_hours":    hours,
		"sampled_at":      time.Now().UTC(),
		"hot_paths":       hotPaths,
		"samples":         samples,
		"recommendations": recommendations,
	})
}

func (h *Handler) GetPerformanceAdvisorHistory(c echo.Context) error {
	limit := 100
	if raw := strings.TrimSpace(c.QueryParam("limit")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 && v <= 500 {
			limit = v
		}
	}

	rows, err := h.DB.Pool.Query(c.Request().Context(), `
		SELECT endpoint,
		       COALESCE(table_name, ''),
		       sample_query,
		       COALESCE(plan_summary, ''),
		       has_seq_scan,
		       estimated_rows,
		       recommendation,
		       recorded_at
		FROM _v_query_explain_samples
		ORDER BY recorded_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to read performance advisor history"})
	}
	defer rows.Close()

	items := make([]map[string]any, 0, limit)
	for rows.Next() {
		var endpoint, tableName, sampleQuery, planSummary string
		var hasSeqScan bool
		var estimatedRows int64
		var recommendationRaw []byte
		var recordedAt time.Time
		if scanErr := rows.Scan(&endpoint, &tableName, &sampleQuery, &planSummary, &hasSeqScan, &estimatedRows, &recommendationRaw, &recordedAt); scanErr != nil {
			continue
		}
		var recommendation any
		_ = json.Unmarshal(recommendationRaw, &recommendation)
		items = append(items, map[string]any{
			"endpoint":       endpoint,
			"table":          tableName,
			"query":          sampleQuery,
			"plan_summary":   planSummary,
			"has_seq_scan":   hasSeqScan,
			"estimated_rows": estimatedRows,
			"recommendation": recommendation,
			"recorded_at":    recordedAt,
		})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"items": items,
	})
}

func (h *Handler) collectHotPaths(ctx context.Context, hours, top int) ([]hotPath, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT path, COUNT(*)::bigint AS hits
		FROM _v_audit_logs
		WHERE created_at > NOW() - ($1 * INTERVAL '1 hour')
		GROUP BY path
		ORDER BY hits DESC
		LIMIT $2
	`, hours, top)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	agg := map[string]hotPath{}
	for rows.Next() {
		var rawPath string
		var hits int64
		if scanErr := rows.Scan(&rawPath, &hits); scanErr != nil {
			continue
		}
		endpoint := canonicalizeEndpoint(rawPath)
		table := tableFromEndpoint(rawPath)
		key := endpoint + "|" + table
		cur := agg[key]
		cur.Endpoint = endpoint
		cur.Table = table
		cur.Hits += hits
		agg[key] = cur
	}

	out := make([]hotPath, 0, len(agg))
	for _, hp := range agg {
		out = append(out, hp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Hits > out[j].Hits })
	if len(out) > top {
		out = out[:top]
	}
	return out, nil
}

func canonicalizeEndpoint(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, p := range parts {
		switch {
		case uuidPathPartPattern.MatchString(p):
			parts[i] = ":id"
		case intPathPartPattern.MatchString(p):
			parts[i] = ":id"
		}
	}
	if len(parts) == 0 {
		return "/"
	}
	return "/" + strings.Join(parts, "/")
}

func tableFromEndpoint(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i := 0; i < len(parts)-1; i++ {
		if parts[i] == "tables" || parts[i] == "collections" {
			table := strings.TrimSpace(parts[i+1])
			if table != "" && table != "rows" && table != "records" {
				return table
			}
		}
	}
	return ""
}

func (h *Handler) pickSampleQuery(ctx context.Context, table string) (string, error) {
	cols, err := h.DB.GetTableColumns(ctx, table)
	if err != nil {
		return "", err
	}
	if cols["updated_at"] {
		return fmt.Sprintf("SELECT * FROM %s ORDER BY updated_at DESC LIMIT 100", table), nil
	}
	if cols["created_at"] {
		return fmt.Sprintf("SELECT * FROM %s ORDER BY created_at DESC LIMIT 100", table), nil
	}
	return fmt.Sprintf("SELECT * FROM %s LIMIT 100", table), nil
}

func (h *Handler) runExplainSample(ctx context.Context, sampleQuery string) (string, bool, int64, error) {
	sql := "EXPLAIN (FORMAT JSON) " + sampleQuery
	var raw []byte
	if err := h.DB.Pool.QueryRow(ctx, sql).Scan(&raw); err != nil {
		return "", false, 0, err
	}

	var plans []explainRoot
	if err := json.Unmarshal(raw, &plans); err != nil || len(plans) == 0 {
		return "plan-unavailable", false, 0, nil
	}

	hasSeqScan, maxRows := walkPlanForSignals(plans[0].Plan)
	summary := fmt.Sprintf("%s | rows=%d | cost=%.2f", plans[0].Plan.NodeType, int64(plans[0].Plan.PlanRows), plans[0].Plan.TotalCost)
	return summary, hasSeqScan, maxRows, nil
}

func walkPlanForSignals(root planNode) (bool, int64) {
	hasSeq := strings.Contains(strings.ToLower(root.NodeType), "seq scan")
	maxRows := int64(root.PlanRows)
	for _, child := range root.Plans {
		childSeq, childRows := walkPlanForSignals(child)
		if childSeq {
			hasSeq = true
		}
		if childRows > maxRows {
			maxRows = childRows
		}
	}
	return hasSeq, maxRows
}

func (h *Handler) recommendIndexesForSample(ctx context.Context, endpoint, table string, hasSeqScan bool) []indexRecommendation {
	if !hasSeqScan {
		return nil
	}
	cols, err := h.DB.GetTableColumns(ctx, table)
	if err != nil {
		return nil
	}

	recs := make([]indexRecommendation, 0, 3)
	tryColumns := []struct {
		Name       string
		Reason     string
		Confidence string
	}{
		{Name: "updated_at", Reason: "hot-path list queries often order by updated_at", Confidence: "high"},
		{Name: "created_at", Reason: "hot-path list queries often order by created_at", Confidence: "high"},
		{Name: "workspace_id", Reason: "workspace isolation/filter path can benefit from index", Confidence: "medium"},
	}

	for _, candidate := range tryColumns {
		if !cols[candidate.Name] {
			continue
		}
		hasIdx, err := h.tableHasIndexOnColumn(ctx, table, candidate.Name)
		if err != nil || hasIdx {
			continue
		}
		recs = append(recs, indexRecommendation{
			Endpoint:   endpoint,
			Table:      table,
			Column:     candidate.Name,
			Reason:     candidate.Reason,
			SQL:        fmt.Sprintf("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_%s_%s ON %s (%s);", table, candidate.Name, table, candidate.Name),
			Confidence: candidate.Confidence,
		})
	}

	return recs
}

func (h *Handler) tableHasIndexOnColumn(ctx context.Context, table, column string) (bool, error) {
	var exists bool
	err := h.DB.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM pg_index i
			JOIN pg_class t ON t.oid = i.indrelid
			JOIN pg_namespace n ON n.oid = t.relnamespace
			JOIN LATERAL unnest(i.indkey) AS k(attnum) ON true
			JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
			WHERE n.nspname = 'public'
			  AND t.relname = $1
			  AND a.attname = $2
		)
	`, table, column).Scan(&exists)
	return exists, err
}

func (h *Handler) persistExplainSample(ctx context.Context, sample explainSample) error {
	recJSON, _ := json.Marshal(sample.Recommendations)
	_, err := h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_query_explain_samples (endpoint, table_name, sample_query, plan_summary, has_seq_scan, estimated_rows, recommendation)
		VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7::jsonb)
	`, sample.Endpoint, sample.Table, sample.Query, sample.PlanSummary, sample.HasSeqScan, sample.EstimatedRows, string(recJSON))
	return err
}
