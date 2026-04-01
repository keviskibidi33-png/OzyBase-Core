package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	maxRequestAttempts = 4
	baseRetryDelay     = 200 * time.Millisecond
)

type systemStatusResponse struct {
	Initialized bool `json:"initialized"`
}

type setupResponse struct {
	Status string `json:"status"`
	Token  string `json:"token"`
}

type loginResponse struct {
	Token string `json:"token"`
}

type workspaceResponse struct {
	ID string `json:"id"`
}

type sqlRequest struct {
	Query string `json:"query"`
}

type benchmarkScenario struct {
	Name    string
	Request func(ctx context.Context) error
}

type scenarioResult struct {
	Name        string        `json:"name"`
	Iterations  int           `json:"iterations"`
	Concurrency int           `json:"concurrency"`
	Successes   int           `json:"successes"`
	Failures    int           `json:"failures"`
	Min         time.Duration `json:"min"`
	Max         time.Duration `json:"max"`
	Mean        time.Duration `json:"mean"`
	P50         time.Duration `json:"p50"`
	P95         time.Duration `json:"p95"`
}

type benchmarkSummary struct {
	BaseURL    string           `json:"baseUrl"`
	TableName  string           `json:"tableName"`
	Rows       int              `json:"rows"`
	Iterations int              `json:"iterations"`
	Workers    int              `json:"workers"`
	StartedAt  time.Time        `json:"startedAt"`
	FinishedAt time.Time        `json:"finishedAt"`
	Scenarios  []scenarioResult `json:"scenarios"`
}

type httpClient struct {
	baseURL     string
	client      *http.Client
	token       string
	workspaceID string
}

func main() {
	baseURL := flag.String("base-url", "http://127.0.0.1:8090", "OzyBase base URL")
	email := flag.String("email", "admin@ozybase.local", "Admin email")
	password := flag.String("password", "OzyBase123!", "Admin password")
	rows := flag.Int("rows", 100000, "Rows to seed into the benchmark table")
	iterations := flag.Int("iterations", 12, "Requests per scenario")
	workers := flag.Int("workers", 4, "Concurrent workers per scenario")
	cleanup := flag.Bool("cleanup", true, "Drop the benchmark table after the run")
	flag.Parse()

	if *rows < 1200 {
		*rows = 1200
	}
	if *iterations < 1 {
		*iterations = 1
	}
	if *workers < 1 {
		*workers = 1
	}

	ctx := context.Background()
	httpSvc := &httpClient{
		baseURL: strings.TrimRight(*baseURL, "/"),
		client: &http.Client{
			Timeout: 120 * time.Second,
		},
	}

	if err := ensureSystemInitialized(ctx, httpSvc, *email, *password); err != nil {
		failf("failed to initialize system: %v", err)
	}

	if err := httpSvc.login(ctx, *email, *password); err != nil {
		failf("failed to login: %v", err)
	}

	if err := httpSvc.loadWorkspace(ctx); err != nil {
		failf("failed to resolve workspace: %v", err)
	}

	tableName := fmt.Sprintf("bench_rows_%d", time.Now().Unix())
	if err := createBenchmarkTable(ctx, httpSvc, tableName, *rows); err != nil {
		failf("failed to seed benchmark table: %v", err)
	}

	if *cleanup {
		defer func() {
			if err := execSQL(context.Background(), httpSvc, fmt.Sprintf("DROP TABLE IF EXISTS %s", quoteIdent(tableName))); err != nil {
				fmt.Fprintf(os.Stderr, "cleanup warning: %v\n", err)
			}
		}()
	}

	startedAt := time.Now()
	deepOffset := *rows - 100
	if deepOffset < 0 {
		deepOffset = 0
	}

	scenarios := []benchmarkScenario{
		{
			Name: "table_first_page",
			Request: func(ctx context.Context) error {
				endpoint := fmt.Sprintf("/api/tables/%s?limit=100&count_mode=auto", url.PathEscape(tableName))
				_, err := httpSvc.request(ctx, http.MethodGet, endpoint, nil, nil)
				return err
			},
		},
		{
			Name: "table_deep_page_sorted",
			Request: func(ctx context.Context) error {
				endpoint := fmt.Sprintf("/api/tables/%s?limit=100&offset=%d&order=amount.desc&count_mode=auto", url.PathEscape(tableName), deepOffset)
				_, err := httpSvc.request(ctx, http.MethodGet, endpoint, nil, nil)
				return err
			},
		},
		{
			Name: "table_search_tail",
			Request: func(ctx context.Context) error {
				endpoint := fmt.Sprintf("/api/tables/%s?limit=50&q=item-%d&count_mode=auto", url.PathEscape(tableName), *rows-1)
				_, err := httpSvc.request(ctx, http.MethodGet, endpoint, nil, nil)
				return err
			},
		},
		{
			Name: "sql_preview_cap",
			Request: func(ctx context.Context) error {
				return execSQL(ctx, httpSvc, fmt.Sprintf("SELECT * FROM %s ORDER BY id ASC", quoteIdent(tableName)))
			},
		},
		{
			Name: "sql_aggregate_grouped",
			Request: func(ctx context.Context) error {
				return execSQL(ctx, httpSvc, fmt.Sprintf(
					"SELECT status, COUNT(*), AVG(amount)::numeric(12,2) FROM %s GROUP BY status ORDER BY status ASC",
					quoteIdent(tableName),
				))
			},
		},
	}

	results := make([]scenarioResult, 0, len(scenarios))
	for _, scenario := range scenarios {
		result := runScenario(ctx, scenario, *iterations, *workers)
		results = append(results, result)
	}

	finishedAt := time.Now()
	summary := benchmarkSummary{
		BaseURL:    httpSvc.baseURL,
		TableName:  tableName,
		Rows:       *rows,
		Iterations: *iterations,
		Workers:    *workers,
		StartedAt:  startedAt,
		FinishedAt: finishedAt,
		Scenarios:  results,
	}

	for _, result := range results {
		fmt.Printf(
			"%s success=%d/%d mean=%s p50=%s p95=%s max=%s\n",
			result.Name,
			result.Successes,
			result.Iterations,
			result.Mean,
			result.P50,
			result.P95,
			result.Max,
		)
	}

	encoded, err := json.MarshalIndent(summary, "", "  ")
	if err != nil {
		failf("failed to encode summary: %v", err)
	}

	fmt.Println(string(encoded))
}

func ensureSystemInitialized(ctx context.Context, svc *httpClient, email, password string) error {
	var status systemStatusResponse
	if _, err := svc.request(ctx, http.MethodGet, "/api/system/status", nil, &status); err != nil {
		return err
	}
	if status.Initialized {
		return nil
	}

	payload := map[string]string{
		"email":    email,
		"password": password,
		"mode":     "clean",
	}
	var response setupResponse
	_, err := svc.request(ctx, http.MethodPost, "/api/system/setup", payload, &response)
	return err
}

func (svc *httpClient) login(ctx context.Context, email, password string) error {
	payload := map[string]string{
		"email":    email,
		"password": password,
	}
	var response loginResponse
	if _, err := svc.request(ctx, http.MethodPost, "/api/auth/login", payload, &response); err != nil {
		return err
	}
	if strings.TrimSpace(response.Token) == "" {
		return errors.New("login response did not include token")
	}
	svc.token = strings.TrimSpace(response.Token)
	return nil
}

func (svc *httpClient) loadWorkspace(ctx context.Context) error {
	var workspaces []workspaceResponse
	if _, err := svc.request(ctx, http.MethodGet, "/api/workspaces", nil, &workspaces); err != nil {
		return err
	}
	if len(workspaces) == 0 {
		return nil
	}
	svc.workspaceID = strings.TrimSpace(workspaces[0].ID)
	return nil
}

func createBenchmarkTable(ctx context.Context, svc *httpClient, tableName string, rows int) error {
	createTableQuery := fmt.Sprintf(`
		CREATE TABLE %s (
			id bigserial PRIMARY KEY,
			title text NOT NULL,
			amount integer NOT NULL,
			status text NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now()
		)
	`, quoteIdent(tableName))

	insertRowsQuery := fmt.Sprintf(`
		INSERT INTO %s (title, amount, status)
		SELECT
			'item-' || gs::text,
			gs,
			CASE WHEN gs %% 3 = 0 THEN 'queued' WHEN gs %% 2 = 0 THEN 'active' ELSE 'draft' END
		FROM generate_series(1, %d) AS gs
	`, quoteIdent(tableName), rows)

	if err := execSQL(ctx, svc, createTableQuery); err != nil {
		return err
	}
	if err := execSQL(ctx, svc, insertRowsQuery); err != nil {
		return err
	}
	if err := createBenchmarkIndexes(ctx, svc, tableName); err != nil {
		return err
	}
	// Refresh planner stats after the bulk insert so the benchmark reflects
	// runtime query performance instead of cold statistics noise.
	return execSQL(ctx, svc, fmt.Sprintf("ANALYZE %s", quoteIdent(tableName)))
}

func createBenchmarkIndexes(ctx context.Context, svc *httpClient, tableName string) error {
	createdAtIndex := fmt.Sprintf("%s_created_at_idx", tableName)
	amountIndex := fmt.Sprintf("%s_amount_idx", tableName)
	titleSearchIndex := fmt.Sprintf("%s_title_trgm_idx", tableName)

	indexQueries := []string{
		fmt.Sprintf("CREATE INDEX %s ON %s (created_at DESC)", quoteIdent(createdAtIndex), quoteIdent(tableName)),
		fmt.Sprintf("CREATE INDEX %s ON %s (amount DESC)", quoteIdent(amountIndex), quoteIdent(tableName)),
	}
	for _, query := range indexQueries {
		if err := execSQL(ctx, svc, query); err != nil {
			return err
		}
	}

	if err := tryExecSQL(ctx, svc, "CREATE EXTENSION IF NOT EXISTS pg_trgm"); err == nil {
		_ = tryExecSQL(
			ctx,
			svc,
			fmt.Sprintf(
				"CREATE INDEX %s ON %s USING GIN (title gin_trgm_ops)",
				quoteIdent(titleSearchIndex),
				quoteIdent(tableName),
			),
		)
	}

	return nil
}

func execSQL(ctx context.Context, svc *httpClient, query string) error {
	_, err := svc.request(ctx, http.MethodPost, "/api/sql", sqlRequest{Query: query}, nil)
	return err
}

func tryExecSQL(ctx context.Context, svc *httpClient, query string) error {
	if err := execSQL(ctx, svc, query); err != nil {
		fmt.Fprintf(os.Stderr, "benchmark setup warning: %v\n", err)
		return err
	}
	return nil
}

func (svc *httpClient) request(ctx context.Context, method, path string, payload any, dest any) ([]byte, error) {
	var encodedPayload []byte
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		encodedPayload = raw
	}

	var lastErr error
	for attempt := 1; attempt <= maxRequestAttempts; attempt++ {
		var body io.Reader
		if encodedPayload != nil {
			body = bytes.NewReader(encodedPayload)
		}

		req, err := http.NewRequestWithContext(ctx, method, svc.baseURL+path, body)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/json")
		if payload != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if svc.token != "" {
			req.Header.Set("Authorization", "Bearer "+svc.token)
		}
		if svc.workspaceID != "" {
			req.Header.Set("X-Workspace-Id", svc.workspaceID)
		}

		response, err := svc.client.Do(req)
		if err != nil {
			lastErr = err
			if attempt == maxRequestAttempts {
				return nil, err
			}
			if sleepErr := sleepWithContext(ctx, baseRetryDelay*time.Duration(attempt)); sleepErr != nil {
				return nil, sleepErr
			}
			continue
		}

		rawBody, readErr := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if readErr != nil {
			return nil, readErr
		}
		if response.StatusCode >= 400 {
			lastErr = fmt.Errorf("%s %s failed with %d: %s", method, path, response.StatusCode, strings.TrimSpace(string(rawBody)))
			if attempt < maxRequestAttempts && isRetryableStatus(response.StatusCode) {
				if sleepErr := sleepWithContext(ctx, retryDelay(response, attempt)); sleepErr != nil {
					return nil, sleepErr
				}
				continue
			}
			return nil, lastErr
		}

		if dest != nil && len(rawBody) > 0 {
			if err := json.Unmarshal(rawBody, dest); err != nil {
				return rawBody, err
			}
		}

		return rawBody, nil
	}

	return nil, lastErr
}

func runScenario(ctx context.Context, scenario benchmarkScenario, iterations, workers int) scenarioResult {
	// Warm up one request to reduce cold-cache spikes in p95 reporting.
	if err := scenario.Request(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "warmup warning for %s: %v\n", scenario.Name, err)
	}

	jobs := make(chan struct{}, iterations)
	type measurement struct {
		duration time.Duration
		err      error
	}
	results := make(chan measurement, iterations)

	var wg sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range jobs {
				start := time.Now()
				err := scenario.Request(ctx)
				results <- measurement{
					duration: time.Since(start),
					err:      err,
				}
			}
		}()
	}

	for i := 0; i < iterations; i++ {
		jobs <- struct{}{}
	}
	close(jobs)

	wg.Wait()
	close(results)

	durations := make([]time.Duration, 0, iterations)
	failures := 0
	var total time.Duration
	for result := range results {
		if result.err != nil {
			failures++
			continue
		}
		durations = append(durations, result.duration)
		total += result.duration
	}

	summary := scenarioResult{
		Name:        scenario.Name,
		Iterations:  iterations,
		Concurrency: workers,
		Successes:   len(durations),
		Failures:    failures,
	}
	if len(durations) == 0 {
		return summary
	}

	sort.Slice(durations, func(i, j int) bool {
		return durations[i] < durations[j]
	})

	summary.Min = durations[0]
	summary.Max = durations[len(durations)-1]
	summary.Mean = total / time.Duration(len(durations))
	summary.P50 = percentile(durations, 0.50)
	summary.P95 = percentile(durations, 0.95)
	return summary
}

func percentile(values []time.Duration, ratio float64) time.Duration {
	if len(values) == 0 {
		return 0
	}
	index := int(float64(len(values)-1) * ratio)
	if index < 0 {
		index = 0
	}
	if index >= len(values) {
		index = len(values) - 1
	}
	return values[index]
}

func isRetryableStatus(statusCode int) bool {
	switch statusCode {
	case http.StatusTooManyRequests, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func retryDelay(response *http.Response, attempt int) time.Duration {
	if response != nil {
		if retryAfter := strings.TrimSpace(response.Header.Get("Retry-After")); retryAfter != "" {
			if seconds, err := time.ParseDuration(retryAfter + "s"); err == nil && seconds > 0 {
				return seconds
			}
			if retryAt, err := http.ParseTime(retryAfter); err == nil {
				delay := time.Until(retryAt)
				if delay > 0 {
					return delay
				}
			}
		}
	}
	delay := time.Duration(attempt) * baseRetryDelay
	if delay > 2*time.Second {
		return 2 * time.Second
	}
	return delay
}

func sleepWithContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(strings.TrimSpace(name), `"`, `""`) + `"`
}

func failf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
