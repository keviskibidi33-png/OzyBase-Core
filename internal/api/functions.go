package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/dop251/goja"
	"github.com/labstack/echo/v4"
	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
)

const (
	defaultFunctionRuntime   = "js"
	defaultFunctionTimeoutMS = 2000
	minFunctionTimeoutMS     = 100
	maxFunctionTimeoutMS     = 60000
	maxWASMModuleBytes       = 5 * 1024 * 1024
)

type FunctionInfo struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	Method     string `json:"method"`
	URL        string `json:"url"`
	LastRun    string `json:"lastRun"`
	Runtime    string `json:"runtime"`
	TimeoutMS  int    `json:"timeout_ms"`
	Entrypoint string `json:"entrypoint,omitempty"`
	HasWASM    bool   `json:"has_wasm"`
	Script     string `json:"script,omitempty"`
	WASMBase64 string `json:"wasm_base64,omitempty"`
}

type FunctionsHandler struct {
	DB           *data.DB
	FunctionsDir string
}

func NewFunctionsHandler(db *data.DB, dir string) *FunctionsHandler {
	return &FunctionsHandler{
		DB:           db,
		FunctionsDir: dir,
	}
}

func normalizeFunctionRuntime(raw string) (string, error) {
	runtime := strings.ToLower(strings.TrimSpace(raw))
	if runtime == "" {
		return defaultFunctionRuntime, nil
	}
	if runtime == "js" || runtime == "wasm" {
		return runtime, nil
	}
	return "", errors.New("invalid runtime (allowed: js, wasm)")
}

func normalizeFunctionTimeout(raw int) int {
	if raw <= 0 {
		return defaultFunctionTimeoutMS
	}
	if raw < minFunctionTimeoutMS {
		return minFunctionTimeoutMS
	}
	if raw > maxFunctionTimeoutMS {
		return maxFunctionTimeoutMS
	}
	return raw
}

func decodeWASMModuleBase64(raw string) ([]byte, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("wasm_base64 is required for wasm runtime")
	}
	decoded, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil {
		return nil, errors.New("wasm_base64 is not valid base64")
	}
	if len(decoded) == 0 {
		return nil, errors.New("wasm module cannot be empty")
	}
	if len(decoded) > maxWASMModuleBytes {
		return nil, errors.New("wasm module exceeds maximum size")
	}
	return decoded, nil
}

func (h *FunctionsHandler) invokeJavaScript(c echo.Context, script string) (any, error) {
	vm := goja.New()

	reqBody := make(map[string]any)
	_ = c.Bind(&reqBody)
	_ = vm.Set("body", reqBody)

	_ = vm.Set("ozy", map[string]any{
		"query": func(sql string, args ...any) []map[string]any {
			rows, err := h.DB.Pool.Query(c.Request().Context(), sql, args...)
			if err != nil {
				panic(vm.ToValue(err.Error()))
			}
			defer rows.Close()

			var result []map[string]any
			fields := rows.FieldDescriptions()
			for rows.Next() {
				values, _ := rows.Values()
				row := make(map[string]any)
				for i, field := range fields {
					row[string(field.Name)] = values[i]
				}
				result = append(result, row)
			}
			return result
		},
	})

	_ = vm.Set("console", map[string]any{
		"log": func(args ...any) {},
	})

	value, err := vm.RunString(script)
	if err != nil {
		return nil, errors.New("execution error: " + err.Error())
	}
	return value.Export(), nil
}

func invokeWASMModule(ctx context.Context, moduleBytes []byte, entrypoint string, payload map[string]any, timeoutMS int) (result map[string]any, err error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMS)*time.Millisecond)
	defer cancel()

	inputJSON, _ := json.Marshal(payload)
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	rt := wazero.NewRuntime(timeoutCtx)
	defer func() {
		if closeErr := rt.Close(timeoutCtx); closeErr != nil && err == nil {
			err = errors.New("failed to close wasm runtime: " + closeErr.Error())
		}
	}()
	if _, err := wasi_snapshot_preview1.Instantiate(timeoutCtx, rt); err != nil {
		return nil, errors.New("failed to instantiate WASI runtime: " + err.Error())
	}

	compiled, err := rt.CompileModule(timeoutCtx, moduleBytes)
	if err != nil {
		return nil, errors.New("failed to compile wasm module: " + err.Error())
	}
	moduleCfg := wazero.NewModuleConfig().
		WithStdout(&stdout).
		WithStderr(&stderr).
		WithEnv("OZY_INPUT", string(inputJSON))

	module, err := rt.InstantiateModule(timeoutCtx, compiled, moduleCfg)
	if err != nil {
		return nil, errors.New("failed to instantiate wasm module: " + err.Error())
	}
	defer func() {
		if closeErr := module.Close(timeoutCtx); closeErr != nil && err == nil {
			err = errors.New("failed to close wasm module: " + closeErr.Error())
		}
	}()

	callName := strings.TrimSpace(entrypoint)
	if callName == "" {
		callName = "_start"
	}
	fn := module.ExportedFunction(callName)
	if fn == nil && callName != "_start" {
		callName = "_start"
		fn = module.ExportedFunction(callName)
	}
	if fn != nil {
		if _, err := fn.Call(timeoutCtx); err != nil {
			return nil, errors.New("wasm function call failed: " + err.Error())
		}
	}

	outputRaw := strings.TrimSpace(stdout.String())
	var parsedOutput any
	if outputRaw != "" {
		if jsonErr := json.Unmarshal([]byte(outputRaw), &parsedOutput); jsonErr != nil {
			parsedOutput = outputRaw
		}
	}

	result = map[string]any{
		"runtime":    "wasm",
		"entrypoint": callName,
		"output":     parsedOutput,
		"stdout":     outputRaw,
		"stderr":     strings.TrimSpace(stderr.String()),
	}
	return result, nil
}

func (h *FunctionsHandler) List(c echo.Context) error {
	rows, err := h.DB.Pool.Query(c.Request().Context(), `
		SELECT id, name, status, runtime, timeout_ms, entrypoint, script, COALESCE(octet_length(wasm_module), 0), created_at
		FROM _v_functions
		ORDER BY created_at DESC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var functions []FunctionInfo
	for rows.Next() {
		var f FunctionInfo
		var createdAt any
		var wasmSize int
		err := rows.Scan(&f.ID, &f.Name, &f.Status, &f.Runtime, &f.TimeoutMS, &f.Entrypoint, &f.Script, &wasmSize, &createdAt)
		if err == nil {
			f.Method = "POST"
			f.URL = "/api/functions/" + f.Name + "/invoke"
			f.LastRun = "Idle"
			f.HasWASM = wasmSize > 0
			functions = append(functions, f)
		}
	}

	if functions == nil {
		functions = []FunctionInfo{}
	}

	return c.JSON(http.StatusOK, functions)
}

func (h *FunctionsHandler) Create(c echo.Context) error {
	var req struct {
		Name       string `json:"name"`
		Script     string `json:"script"`
		Runtime    string `json:"runtime"`
		WASMBase64 string `json:"wasm_base64"`
		TimeoutMS  int    `json:"timeout_ms"`
		Entrypoint string `json:"entrypoint"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || !data.IsValidIdentifier(req.Name) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid function name"})
	}

	runtime, err := normalizeFunctionRuntime(req.Runtime)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	timeoutMS := normalizeFunctionTimeout(req.TimeoutMS)
	entrypoint := strings.TrimSpace(req.Entrypoint)
	if entrypoint == "" {
		entrypoint = "_start"
	}

	var wasmModule []byte
	script := strings.TrimSpace(req.Script)
	if runtime == "js" {
		if script == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "script is required for js runtime"})
		}
	} else {
		decoded, decodeErr := decodeWASMModuleBase64(req.WASMBase64)
		if decodeErr != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": decodeErr.Error()})
		}
		wasmModule = decoded
		script = ""
	}

	var id string
	err = h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_functions (name, script, runtime, wasm_module, timeout_ms, entrypoint, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
		ON CONFLICT (name) DO UPDATE SET
			script = EXCLUDED.script,
			runtime = EXCLUDED.runtime,
			wasm_module = EXCLUDED.wasm_module,
			timeout_ms = EXCLUDED.timeout_ms,
			entrypoint = EXCLUDED.entrypoint,
			updated_at = NOW()
		RETURNING id
	`, req.Name, script, runtime, wasmModule, timeoutMS, entrypoint).Scan(&id)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"id":         id,
		"name":       req.Name,
		"runtime":    runtime,
		"timeout_ms": timeoutMS,
		"entrypoint": entrypoint,
		"message":    "Function saved successfully",
	})
}

func (h *FunctionsHandler) Invoke(c echo.Context) error {
	name := c.Param("name")
	name = strings.TrimSpace(name)
	if name == "" || !data.IsValidIdentifier(name) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid function name"})
	}

	var (
		script     string
		runtime    string
		wasmModule []byte
		timeoutMS  int
		entrypoint string
	)
	err := h.DB.Pool.QueryRow(
		c.Request().Context(),
		"SELECT script, runtime, wasm_module, timeout_ms, entrypoint FROM _v_functions WHERE name = $1",
		name,
	).Scan(&script, &runtime, &wasmModule, &timeoutMS, &entrypoint)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Function not found"})
	}
	timeoutMS = normalizeFunctionTimeout(timeoutMS)

	switch strings.ToLower(strings.TrimSpace(runtime)) {
	case "wasm":
		body := map[string]any{}
		_ = c.Bind(&body)
		result, runErr := invokeWASMModule(c.Request().Context(), wasmModule, entrypoint, body, timeoutMS)
		if runErr != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": runErr.Error()})
		}
		return c.JSON(http.StatusOK, map[string]any{
			"name":       name,
			"runtime":    "wasm",
			"timeout_ms": timeoutMS,
			"result":     result,
		})
	default:
		result, runErr := h.invokeJavaScript(c, script)
		if runErr != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": runErr.Error()})
		}
		return c.JSON(http.StatusOK, map[string]any{
			"name":       name,
			"runtime":    "js",
			"timeout_ms": timeoutMS,
			"result":     result,
		})
	}
}

func (h *FunctionsHandler) Delete(c echo.Context) error {
	name := strings.TrimSpace(c.Param("name"))
	if name == "" || !data.IsValidIdentifier(name) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid function name"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()
	tag := strconv.FormatInt(time.Now().UTC().Unix(), 10)
	res, err := h.DB.Pool.Exec(ctx, "DELETE FROM _v_functions WHERE name = $1", name)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if res.RowsAffected() == 0 {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Function not found"})
	}
	return c.JSON(http.StatusOK, map[string]string{"status": "deleted", "deleted_at": tag})
}
