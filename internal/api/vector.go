package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
)

const (
	defaultVectorDimension  = 1536
	minVectorDimension      = 2
	maxVectorDimension      = 8192
	defaultVectorIndexLists = 100
	minVectorIndexLists     = 1
	maxVectorIndexLists     = 32768
	maxVectorUpsertBatch    = 200
	maxVectorNamespaceLen   = 120
	maxVectorExternalIDLen  = 255
	maxVectorSearchLimit    = 200
	defaultVectorSearchTopK = 10
)

type vectorConfig struct {
	Dimension  int
	Metric     string
	IndexLists int
}

type VectorStatusResponse struct {
	Available       bool   `json:"available"`
	Installed       bool   `json:"installed"`
	Ready           bool   `json:"ready"`
	Dimension       int    `json:"dimension"`
	Metric          string `json:"metric"`
	IndexLists      int    `json:"index_lists"`
	TableExists     bool   `json:"table_exists"`
	TableDimension  int    `json:"table_dimension,omitempty"`
	RecommendedNext string `json:"recommended_next,omitempty"`
}

type VectorSetupRequest struct {
	Dimension  int    `json:"dimension"`
	Metric     string `json:"metric"`
	IndexLists int    `json:"index_lists"`
}

type VectorUpsertItem struct {
	ExternalID string         `json:"external_id"`
	Content    string         `json:"content"`
	Embedding  []float64      `json:"embedding"`
	Metadata   map[string]any `json:"metadata"`
}

type VectorUpsertRequest struct {
	Namespace string             `json:"namespace"`
	Items     []VectorUpsertItem `json:"items"`
}

type VectorSearchRequest struct {
	Namespace      string    `json:"namespace"`
	QueryEmbedding []float64 `json:"query_embedding"`
	Limit          int       `json:"limit"`
}

type VectorSearchHit struct {
	ID         string         `json:"id"`
	Namespace  string         `json:"namespace"`
	ExternalID string         `json:"external_id"`
	Content    string         `json:"content"`
	Metadata   map[string]any `json:"metadata"`
	Score      float64        `json:"score"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
}

func normalizeVectorNamespace(raw string) (string, error) {
	ns := strings.TrimSpace(raw)
	if ns == "" {
		ns = "default"
	}
	if len(ns) > maxVectorNamespaceLen {
		return "", fmt.Errorf("namespace is too long (max %d chars)", maxVectorNamespaceLen)
	}
	return ns, nil
}

func normalizeVectorMetric(raw string) (metric string, opClass string, err error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "cosine":
		return "cosine", "vector_cosine_ops", nil
	case "l2", "euclidean":
		return "l2", "vector_l2_ops", nil
	case "ip", "inner_product":
		return "ip", "vector_ip_ops", nil
	default:
		return "", "", fmt.Errorf("invalid metric %q (allowed: cosine, l2, ip)", raw)
	}
}

func vectorOrderOperator(metric string) string {
	switch metric {
	case "l2":
		return "<->"
	case "ip":
		return "<#>"
	default:
		return "<=>"
	}
}

func vectorScoreSQL(metric string) string {
	switch metric {
	case "l2":
		return "1.0 / (1.0 + (embedding <-> $2::vector))"
	case "ip":
		return "-(embedding <#> $2::vector)"
	default:
		return "1.0 - (embedding <=> $2::vector)"
	}
}

func validateVectorDimension(dim int) error {
	if dim < minVectorDimension || dim > maxVectorDimension {
		return fmt.Errorf("dimension must be between %d and %d", minVectorDimension, maxVectorDimension)
	}
	return nil
}

func validateVectorIndexLists(lists int) error {
	if lists < minVectorIndexLists || lists > maxVectorIndexLists {
		return fmt.Errorf("index_lists must be between %d and %d", minVectorIndexLists, maxVectorIndexLists)
	}
	return nil
}

func vectorLiteral(values []float64) (string, error) {
	if len(values) == 0 {
		return "", errors.New("embedding cannot be empty")
	}
	parts := make([]string, 0, len(values))
	for _, v := range values {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return "", errors.New("embedding contains invalid numeric values")
		}
		parts = append(parts, strconv.FormatFloat(v, 'f', -1, 64))
	}
	return "[" + strings.Join(parts, ",") + "]", nil
}

func parseVectorTypeDimension(raw string) (int, error) {
	s := strings.TrimSpace(strings.ToLower(raw))
	if !strings.HasPrefix(s, "vector(") || !strings.HasSuffix(s, ")") {
		return 0, fmt.Errorf("unexpected vector type format: %q", raw)
	}
	num := strings.TrimSuffix(strings.TrimPrefix(s, "vector("), ")")
	dim, err := strconv.Atoi(num)
	if err != nil {
		return 0, fmt.Errorf("invalid vector dimension format %q: %w", raw, err)
	}
	return dim, nil
}

func (h *Handler) readVectorConfig(ctx context.Context) (vectorConfig, error) {
	cfg := vectorConfig{
		Dimension:  defaultVectorDimension,
		Metric:     "cosine",
		IndexLists: defaultVectorIndexLists,
	}

	err := h.DB.Pool.QueryRow(ctx, `
		SELECT dimension, metric, index_lists
		FROM _v_vector_config
		WHERE id = TRUE
	`).Scan(&cfg.Dimension, &cfg.Metric, &cfg.IndexLists)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableErr(err) {
			return cfg, nil
		}
		return cfg, err
	}
	return cfg, nil
}

func (h *Handler) getVectorExtensionState(ctx context.Context) (available bool, installed bool, err error) {
	if err = h.DB.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
		)
	`).Scan(&available); err != nil {
		return false, false, err
	}

	if err = h.DB.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pg_extension WHERE extname = 'vector'
		)
	`).Scan(&installed); err != nil {
		return false, false, err
	}

	return available, installed, nil
}

func readVectorTableState(ctx context.Context, tx pgx.Tx) (exists bool, dimension int, err error) {
	if err = tx.QueryRow(ctx, `SELECT to_regclass('public._v_vector_items') IS NOT NULL`).Scan(&exists); err != nil {
		return false, 0, err
	}
	if !exists {
		return false, 0, nil
	}

	var embeddingType string
	err = tx.QueryRow(ctx, `
		SELECT format_type(a.atttypid, a.atttypmod)
		FROM pg_attribute a
		JOIN pg_class c ON c.oid = a.attrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public'
		  AND c.relname = '_v_vector_items'
		  AND a.attname = 'embedding'
		  AND a.attnum > 0
		  AND NOT a.attisdropped
	`).Scan(&embeddingType)
	if err != nil {
		return true, 0, err
	}

	dim, parseErr := parseVectorTypeDimension(embeddingType)
	if parseErr != nil {
		return true, 0, parseErr
	}
	return true, dim, nil
}

func upsertVectorConfigTx(ctx context.Context, tx pgx.Tx, cfg vectorConfig) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO _v_vector_config (id, dimension, metric, index_lists, updated_at)
		VALUES (TRUE, $1, $2, $3, NOW())
		ON CONFLICT (id)
		DO UPDATE SET
			dimension = EXCLUDED.dimension,
			metric = EXCLUDED.metric,
			index_lists = EXCLUDED.index_lists,
			updated_at = NOW()
	`, cfg.Dimension, cfg.Metric, cfg.IndexLists)
	return err
}

func (h *Handler) GetVectorStatus(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	resp, err := h.collectVectorStatus(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, resp)
}

func (h *Handler) collectVectorStatus(ctx context.Context) (VectorStatusResponse, error) {
	cfg, err := h.readVectorConfig(ctx)
	if err != nil {
		return VectorStatusResponse{}, fmt.Errorf("failed to read vector config: %w", err)
	}

	metric, _, metricErr := normalizeVectorMetric(cfg.Metric)
	if metricErr != nil {
		metric = "cosine"
	}

	available, installed, err := h.getVectorExtensionState(ctx)
	if err != nil {
		return VectorStatusResponse{}, fmt.Errorf("failed to inspect vector extension state: %w", err)
	}

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return VectorStatusResponse{}, fmt.Errorf("failed to inspect vector table state: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tableExists, tableDimension, err := readVectorTableState(ctx, tx)
	if err != nil {
		return VectorStatusResponse{}, fmt.Errorf("failed to inspect vector table: %w", err)
	}

	resp := VectorStatusResponse{
		Available:      available,
		Installed:      installed,
		Dimension:      cfg.Dimension,
		Metric:         metric,
		IndexLists:     cfg.IndexLists,
		TableExists:    tableExists,
		TableDimension: tableDimension,
	}

	resp.Ready = available && installed && tableExists && tableDimension == cfg.Dimension
	if !resp.Ready {
		resp.RecommendedNext = "run POST /api/project/vector/setup to initialize pgvector store"
	}
	if !available {
		resp.RecommendedNext = "install pgvector in PostgreSQL runtime and rerun setup"
	}

	return resp, nil
}

func (h *Handler) SetupVectorStore(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 30*time.Second)
	defer cancel()

	var req VectorSetupRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid setup request"})
	}

	cfg, err := h.readVectorConfig(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to read vector config: " + err.Error()})
	}

	if req.Dimension > 0 {
		cfg.Dimension = req.Dimension
	}
	if strings.TrimSpace(req.Metric) != "" {
		cfg.Metric = req.Metric
	}
	if req.IndexLists > 0 {
		cfg.IndexLists = req.IndexLists
	}

	if err := validateVectorDimension(cfg.Dimension); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := validateVectorIndexLists(cfg.IndexLists); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	metric, opClass, err := normalizeVectorMetric(cfg.Metric)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	cfg.Metric = metric

	available, _, err := h.getVectorExtensionState(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to inspect vector extension state: " + err.Error()})
	}
	if !available {
		return c.JSON(http.StatusConflict, map[string]string{"error": "pgvector is not available in this PostgreSQL runtime"})
	}

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to begin setup transaction: " + err.Error()})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `CREATE EXTENSION IF NOT EXISTS vector`); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to enable pgvector extension: " + err.Error()})
	}

	tableExists, tableDimension, err := readVectorTableState(ctx, tx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to inspect vector table state: " + err.Error()})
	}
	if tableExists && tableDimension != cfg.Dimension {
		return c.JSON(http.StatusConflict, map[string]string{
			"error": fmt.Sprintf("existing _v_vector_items table uses vector(%d), requested vector(%d)", tableDimension, cfg.Dimension),
		})
	}

	createTableSQL := fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS _v_vector_items (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			namespace TEXT NOT NULL DEFAULT 'default',
			external_id TEXT NOT NULL,
			content TEXT NOT NULL,
			metadata JSONB NOT NULL DEFAULT '{}',
			embedding vector(%d) NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(namespace, external_id)
		)
	`, cfg.Dimension)
	if _, err := tx.Exec(ctx, createTableSQL); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create vector store table: " + err.Error()})
	}

	if _, err := tx.Exec(ctx, `CREATE INDEX IF NOT EXISTS idx_v_vector_items_namespace ON _v_vector_items(namespace)`); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create namespace index: " + err.Error()})
	}
	if _, err := tx.Exec(ctx, `CREATE INDEX IF NOT EXISTS idx_v_vector_items_created_at ON _v_vector_items(created_at DESC)`); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create created_at index: " + err.Error()})
	}

	indexName := fmt.Sprintf("idx_v_vector_items_embedding_%s", cfg.Metric)
	if !data.IsValidIdentifier(indexName) {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "generated vector index name is invalid"})
	}
	vectorIndexSQL := fmt.Sprintf(`
		CREATE INDEX IF NOT EXISTS %s
		ON _v_vector_items
		USING ivfflat (embedding %s)
		WITH (lists = %d)
	`, indexName, opClass, cfg.IndexLists)
	if _, err := tx.Exec(ctx, vectorIndexSQL); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create vector ANN index: " + err.Error()})
	}

	if _, err := tx.Exec(ctx, `ANALYZE _v_vector_items`); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to analyze vector table: " + err.Error()})
	}

	if err := upsertVectorConfigTx(ctx, tx, cfg); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to persist vector config: " + err.Error()})
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit vector setup: " + err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status":        "ready",
		"dimension":     cfg.Dimension,
		"metric":        cfg.Metric,
		"index_lists":   cfg.IndexLists,
		"index_name":    indexName,
		"index_opclass": opClass,
	})
}

func (h *Handler) ensureVectorReady(ctx context.Context) (vectorConfig, error) {
	cfg, err := h.readVectorConfig(ctx)
	if err != nil {
		return cfg, err
	}
	metric, _, metricErr := normalizeVectorMetric(cfg.Metric)
	if metricErr != nil {
		return cfg, metricErr
	}
	cfg.Metric = metric

	available, installed, err := h.getVectorExtensionState(ctx)
	if err != nil {
		return cfg, err
	}
	if !available {
		return cfg, errors.New("pgvector extension is not available in this PostgreSQL runtime")
	}
	if !installed {
		return cfg, errors.New("pgvector extension is not installed; run vector setup first")
	}

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return cfg, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tableExists, tableDimension, err := readVectorTableState(ctx, tx)
	if err != nil {
		return cfg, err
	}
	if !tableExists {
		return cfg, errors.New("vector store table is missing; run vector setup first")
	}
	if tableDimension != cfg.Dimension {
		return cfg, fmt.Errorf("vector store dimension mismatch: table=%d config=%d", tableDimension, cfg.Dimension)
	}
	return cfg, nil
}

func (h *Handler) UpsertVectorItems(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 45*time.Second)
	defer cancel()

	cfg, err := h.ensureVectorReady(ctx)
	if err != nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": err.Error()})
	}

	var req VectorUpsertRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid upsert payload"})
	}
	if len(req.Items) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "items cannot be empty"})
	}
	if len(req.Items) > maxVectorUpsertBatch {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("batch too large (max %d)", maxVectorUpsertBatch)})
	}

	namespace, err := normalizeVectorNamespace(req.Namespace)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to start vector upsert transaction: " + err.Error()})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	inserted := 0
	updated := 0
	for i, item := range req.Items {
		externalID := strings.TrimSpace(item.ExternalID)
		content := strings.TrimSpace(item.Content)
		if externalID == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("items[%d].external_id is required", i)})
		}
		if len(externalID) > maxVectorExternalIDLen {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("items[%d].external_id exceeds %d chars", i, maxVectorExternalIDLen)})
		}
		if content == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("items[%d].content is required", i)})
		}
		if len(item.Embedding) != cfg.Dimension {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": fmt.Sprintf("items[%d].embedding dimension %d does not match configured dimension %d", i, len(item.Embedding), cfg.Dimension),
			})
		}

		literal, err := vectorLiteral(item.Embedding)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("items[%d].embedding is invalid: %s", i, err.Error())})
		}

		metadata := item.Metadata
		if metadata == nil {
			metadata = map[string]any{}
		}
		metadataJSON, err := json.Marshal(metadata)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("items[%d].metadata is invalid JSON: %s", i, err.Error())})
		}

		var wasInserted bool
		err = tx.QueryRow(ctx, `
			INSERT INTO _v_vector_items (namespace, external_id, content, metadata, embedding, updated_at)
			VALUES ($1, $2, $3, $4, $5::vector, NOW())
			ON CONFLICT (namespace, external_id)
			DO UPDATE SET
				content = EXCLUDED.content,
				metadata = EXCLUDED.metadata,
				embedding = EXCLUDED.embedding,
				updated_at = NOW()
			RETURNING (xmax = 0) AS inserted
		`, namespace, externalID, content, metadataJSON, literal).Scan(&wasInserted)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to upsert vector item: " + err.Error()})
		}
		if wasInserted {
			inserted++
		} else {
			updated++
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit vector upsert transaction: " + err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"namespace": namespace,
		"inserted":  inserted,
		"updated":   updated,
		"total":     len(req.Items),
		"metric":    cfg.Metric,
		"dimension": cfg.Dimension,
	})
}

func (h *Handler) SearchVectorItems(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 15*time.Second)
	defer cancel()

	cfg, err := h.ensureVectorReady(ctx)
	if err != nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": err.Error()})
	}

	var req VectorSearchRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid search payload"})
	}
	if len(req.QueryEmbedding) != cfg.Dimension {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("query_embedding dimension %d does not match configured dimension %d", len(req.QueryEmbedding), cfg.Dimension),
		})
	}
	limit := req.Limit
	if limit <= 0 {
		limit = defaultVectorSearchTopK
	}
	if limit > maxVectorSearchLimit {
		limit = maxVectorSearchLimit
	}

	namespace, err := normalizeVectorNamespace(req.Namespace)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	queryLiteral, err := vectorLiteral(req.QueryEmbedding)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "query_embedding is invalid: " + err.Error()})
	}

	orderOp := vectorOrderOperator(cfg.Metric)
	scoreExpr := vectorScoreSQL(cfg.Metric)
	sqlQuery := fmt.Sprintf(`
		SELECT id::text, namespace, external_id, content, metadata, %s AS score, created_at, updated_at
		FROM _v_vector_items
		WHERE namespace = $1
		ORDER BY embedding %s $2::vector
		LIMIT $3
	`, scoreExpr, orderOp)

	rows, err := h.DB.Pool.Query(ctx, sqlQuery, namespace, queryLiteral, limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to execute vector similarity search: " + err.Error()})
	}
	defer rows.Close()

	hits := make([]VectorSearchHit, 0, limit)
	for rows.Next() {
		var hit VectorSearchHit
		var metadataRaw []byte
		if err := rows.Scan(&hit.ID, &hit.Namespace, &hit.ExternalID, &hit.Content, &metadataRaw, &hit.Score, &hit.CreatedAt, &hit.UpdatedAt); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to parse vector similarity row: " + err.Error()})
		}

		hit.Metadata = map[string]any{}
		if len(metadataRaw) > 0 {
			_ = json.Unmarshal(metadataRaw, &hit.Metadata)
		}
		hits = append(hits, hit)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"namespace": namespace,
		"metric":    cfg.Metric,
		"dimension": cfg.Dimension,
		"count":     len(hits),
		"hits":      hits,
	})
}
