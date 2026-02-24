package api

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/labstack/echo/v4"
)

const (
	defaultNLQLimit    = 20
	maxNLQLimit        = 200
	maxNLQQueryLength  = 600
	maxNLQTableChoices = 500
)

var (
	nlqLimitRegexps = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\blimit\s+(\d+)\b`),
		regexp.MustCompile(`(?i)\b(?:limite|l[íi]mite)\s+(\d+)\b`),
	}
	nlqWhereRegexps = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\bwhere\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|is)\s*(?:"([^"]+)"|'([^']+)'|([^\s,;]+))`),
		regexp.MustCompile(`(?i)\bdonde\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|es)\s*(?:"([^"]+)"|'([^']+)'|([^\s,;]+))`),
	}
)

type NLQTranslateRequest struct {
	Query string `json:"query"`
	Table string `json:"table"`
	Limit int    `json:"limit"`
}

type NLQTranslateResponse struct {
	Mode        string   `json:"mode"`
	Intent      string   `json:"intent"`
	Table       string   `json:"table"`
	Limit       int      `json:"limit"`
	SQL         string   `json:"sql"`
	Params      []any    `json:"params"`
	Warnings    []string `json:"warnings"`
	Explainable bool     `json:"explainable"`
}

type nlqPlan struct {
	Intent   string
	Table    string
	Limit    int
	SQL      string
	Args     []any
	Warnings []string
}

func normalizeNLQLimit(raw int) int {
	if raw <= 0 {
		return defaultNLQLimit
	}
	if raw > maxNLQLimit {
		return maxNLQLimit
	}
	return raw
}

func detectNLQCountIntent(query string) bool {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return false
	}
	return strings.Contains(q, "count") ||
		strings.Contains(q, "how many") ||
		strings.Contains(q, "cuantos") ||
		strings.Contains(q, "cuántos") ||
		strings.Contains(q, "total de")
}

func extractNLQLimit(query string) int {
	for _, re := range nlqLimitRegexps {
		matches := re.FindStringSubmatch(query)
		if len(matches) < 2 {
			continue
		}
		n, err := strconv.Atoi(matches[1])
		if err != nil {
			continue
		}
		return normalizeNLQLimit(n)
	}
	return defaultNLQLimit
}

func extractNLQWhereClause(query string) (field string, value string, ok bool) {
	for _, re := range nlqWhereRegexps {
		matches := re.FindStringSubmatch(query)
		if len(matches) < 5 {
			continue
		}
		field = strings.TrimSpace(matches[1])
		for i := 2; i <= 4; i++ {
			if strings.TrimSpace(matches[i]) != "" {
				value = strings.TrimSpace(matches[i])
				break
			}
		}
		if field != "" && value != "" {
			return field, value, true
		}
	}
	return "", "", false
}

func resolveNLQTable(query string, requested string, candidates []string) (string, error) {
	lookup := make(map[string]string, len(candidates))
	for _, name := range candidates {
		lookup[strings.ToLower(strings.TrimSpace(name))] = strings.TrimSpace(name)
	}

	explicit := strings.TrimSpace(requested)
	if explicit != "" {
		if !data.IsValidIdentifier(explicit) {
			return "", fmt.Errorf("invalid table identifier %q", explicit)
		}
		if resolved, ok := lookup[strings.ToLower(explicit)]; ok {
			return resolved, nil
		}
		return "", fmt.Errorf("table %q is not available", explicit)
	}

	queryLower := strings.ToLower(query)
	selected := ""
	for _, candidate := range candidates {
		name := strings.ToLower(strings.TrimSpace(candidate))
		if name == "" {
			continue
		}
		pattern := `\b` + regexp.QuoteMeta(name) + `\b`
		if matched, _ := regexp.MatchString(pattern, queryLower); !matched {
			continue
		}
		if len(candidate) > len(selected) {
			selected = candidate
		}
	}
	if selected != "" {
		return selected, nil
	}
	if len(candidates) == 1 {
		return candidates[0], nil
	}
	return "", fmt.Errorf("could not infer target table from query; provide \"table\" explicitly")
}

func (h *Handler) listNLQTables(ctx context.Context) ([]string, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT name
		FROM _v_collections
		WHERE name NOT LIKE '\_v\_%' ESCAPE '\'
		  AND name NOT LIKE '\_ozy\_%' ESCAPE '\'
		ORDER BY name ASC
		LIMIT $1
	`, maxNLQTableChoices)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tables := make([]string, 0, 64)
	for rows.Next() {
		var name string
		if scanErr := rows.Scan(&name); scanErr != nil {
			continue
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		tables = append(tables, name)
	}
	return tables, nil
}

func (h *Handler) listNLQTableColumns(ctx context.Context, tableName string) (map[string]struct{}, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT column_name
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = $1
	`, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columns := make(map[string]struct{}, 16)
	for rows.Next() {
		var column string
		if scanErr := rows.Scan(&column); scanErr != nil {
			continue
		}
		column = strings.TrimSpace(column)
		if column == "" {
			continue
		}
		columns[column] = struct{}{}
	}
	return columns, nil
}

func (h *Handler) buildNLQPlan(ctx context.Context, req NLQTranslateRequest) (nlqPlan, error) {
	query := strings.TrimSpace(req.Query)
	if query == "" {
		return nlqPlan{}, fmt.Errorf("query cannot be empty")
	}
	if len(query) > maxNLQQueryLength {
		return nlqPlan{}, fmt.Errorf("query is too long (max %d chars)", maxNLQQueryLength)
	}

	tables, err := h.listNLQTables(ctx)
	if err != nil {
		return nlqPlan{}, fmt.Errorf("failed to list available tables: %w", err)
	}
	if len(tables) == 0 {
		return nlqPlan{}, fmt.Errorf("no user tables are available for NLQ")
	}

	tableName, err := resolveNLQTable(query, req.Table, tables)
	if err != nil {
		return nlqPlan{}, err
	}
	if !data.IsValidIdentifier(tableName) {
		return nlqPlan{}, fmt.Errorf("invalid table identifier %q", tableName)
	}

	columns, err := h.listNLQTableColumns(ctx, tableName)
	if err != nil {
		return nlqPlan{}, fmt.Errorf("failed to inspect table columns: %w", err)
	}
	if len(columns) == 0 {
		return nlqPlan{}, fmt.Errorf("table %q has no columns", tableName)
	}

	limit := normalizeNLQLimit(req.Limit)
	if req.Limit <= 0 {
		limit = extractNLQLimit(query)
	}

	whereField, whereValue, hasWhere := extractNLQWhereClause(query)
	args := make([]any, 0, 2)
	if hasWhere {
		whereField = strings.TrimSpace(whereField)
		if !data.IsValidIdentifier(whereField) {
			return nlqPlan{}, fmt.Errorf("where field %q is invalid", whereField)
		}
		if _, ok := columns[whereField]; !ok {
			return nlqPlan{}, fmt.Errorf("where field %q does not exist in %q", whereField, tableName)
		}
		args = append(args, whereValue)
	}

	intent := "list"
	sqlText := fmt.Sprintf("SELECT * FROM %s", tableName) // #nosec G201 -- validated identifier from metadata.
	if detectNLQCountIntent(query) {
		intent = "count"
		sqlText = fmt.Sprintf("SELECT COUNT(*)::bigint AS total FROM %s", tableName) // #nosec G201 -- validated identifier from metadata.
	}

	if hasWhere {
		sqlText += fmt.Sprintf(" WHERE %s = $1", whereField) // #nosec G201 -- validated identifier from metadata.
	}
	if intent != "count" {
		if _, ok := columns["created_at"]; ok {
			sqlText += " ORDER BY created_at DESC"
		}
		sqlText += fmt.Sprintf(" LIMIT $%d", len(args)+1)
		args = append(args, limit)
	}

	plan := nlqPlan{
		Intent: intent,
		Table:  tableName,
		Limit:  limit,
		SQL:    sqlText,
		Args:   args,
	}
	if req.Table == "" {
		plan.Warnings = append(plan.Warnings, "table inferred from text; pass \"table\" to make execution deterministic")
	}
	return plan, nil
}

func normalizeSQLValue(value any) any {
	switch v := value.(type) {
	case []byte:
		return string(v)
	case time.Time:
		return v.UTC().Format(time.RFC3339Nano)
	default:
		return v
	}
}

func (h *Handler) translateNLQ(ctx context.Context, req NLQTranslateRequest) (NLQTranslateResponse, error) {
	plan, err := h.buildNLQPlan(ctx, req)
	if err != nil {
		return NLQTranslateResponse{}, err
	}
	return NLQTranslateResponse{
		Mode:        "deterministic",
		Intent:      plan.Intent,
		Table:       plan.Table,
		Limit:       plan.Limit,
		SQL:         plan.SQL,
		Params:      plan.Args,
		Warnings:    plan.Warnings,
		Explainable: true,
	}, nil
}

func (h *Handler) runNLQ(ctx context.Context, req NLQTranslateRequest) (map[string]any, error) {
	plan, err := h.buildNLQPlan(ctx, req)
	if err != nil {
		return nil, err
	}

	rows, err := h.DB.Pool.Query(ctx, plan.SQL, plan.Args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	fieldDescriptions := rows.FieldDescriptions()
	columns := make([]string, len(fieldDescriptions))
	for i, fd := range fieldDescriptions {
		columns[i] = string(fd.Name)
	}

	resultRows := make([][]any, 0, 64)
	for rows.Next() {
		values := make([]any, len(columns))
		valuePtrs := make([]any, len(columns))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		if scanErr := rows.Scan(valuePtrs...); scanErr != nil {
			return nil, scanErr
		}
		for i := range values {
			values[i] = normalizeSQLValue(values[i])
		}
		resultRows = append(resultRows, values)
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}

	return map[string]any{
		"mode":        "deterministic",
		"intent":      plan.Intent,
		"table":       plan.Table,
		"limit":       plan.Limit,
		"sql":         plan.SQL,
		"params":      plan.Args,
		"columns":     columns,
		"rows":        resultRows,
		"row_count":   len(resultRows),
		"warnings":    plan.Warnings,
		"explainable": true,
	}, nil
}

// TranslateNLQ handles POST /api/project/nlq/translate
func (h *Handler) TranslateNLQ(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 8*time.Second)
	defer cancel()

	var req NLQTranslateRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid NLQ payload"})
	}

	resp, err := h.translateNLQ(ctx, req)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, resp)
}

// ExecuteNLQ handles POST /api/project/nlq/query
func (h *Handler) ExecuteNLQ(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 12*time.Second)
	defer cancel()

	var req NLQTranslateRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid NLQ payload"})
	}

	resp, err := h.runNLQ(ctx, req)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, resp)
}
