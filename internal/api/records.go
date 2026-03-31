package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/labstack/echo/v4"
)

func (h *Handler) extractRlsOwnerInfo(c echo.Context) (string, string) {
	rlsEnabled, _ := c.Get("rls_enabled").(bool)
	role, _ := c.Get("role").(string)

	if !rlsEnabled || role == "admin" {
		if role == "admin" && rlsEnabled {
			fmt.Printf("[RLS] Bypassing RLS for admin user\n")
		}
		return "", ""
	}

	rlsRule, _ := c.Get("rls_rule").(string)
	userID, _ := c.Get("user_id").(string)

	if rlsRule != "" && userID != "" && strings.Contains(rlsRule, "auth.uid()") {
		ruleParts := strings.Split(rlsRule, "=")
		if len(ruleParts) == 2 {
			ownerField := strings.TrimSpace(ruleParts[0])
			fmt.Printf("[RLS] Applying filter: %s = %s for user %s\n", ownerField, userID, userID)
			return ownerField, userID
		}
	}

	return "", ""
}

func applyOwnerFieldDefault(data map[string]any, ownerField, ownerID string) map[string]any {
	if strings.TrimSpace(ownerField) == "" || strings.TrimSpace(ownerID) == "" {
		return data
	}

	currentValue, hasOwnerValue := data[ownerField]
	if hasOwnerValue && strings.TrimSpace(fmt.Sprint(currentValue)) != "" {
		return data
	}

	next := make(map[string]any, len(data)+1)
	for key, value := range data {
		next[key] = value
	}
	next[ownerField] = ownerID
	return next
}

// CreateRecord handles POST /api/collections/:name/records
func (h *Handler) CreateRecord(c echo.Context) error {
	collectionName := c.Param("name")
	if collectionName == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Collection name is required",
		})
	}

	// Parse body as dynamic map using json decoder directly
	var data map[string]any
	if err := json.NewDecoder(c.Request().Body).Decode(&data); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid JSON body: " + err.Error(),
		})
	}

	if len(data) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Request body cannot be empty",
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	ownerField, ownerID := h.extractRlsOwnerInfo(c)
	if ownerField != "" && ownerID != "" && h.DB.HasColumn(ctx, collectionName, ownerField) {
		data = applyOwnerFieldDefault(data, ownerField, ownerID)
	}

	// Insert the record
	id, err := h.DB.InsertRecord(ctx, collectionName, data)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": err.Error(),
		})
	}

	// Fetch the complete record to return
	record, err := h.DB.GetRecord(ctx, collectionName, id, ownerField, ownerID)
	if err != nil {
		// Return at least the ID if fetch fails
		return c.JSON(http.StatusCreated, map[string]string{
			"id": id,
		})
	}

	return c.JSON(http.StatusCreated, record)
}

// ListRecords handles GET /api/collections/:name/records
func (h *Handler) ListRecords(c echo.Context) error {
	collectionName := c.Param("name")

	if collectionName == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Collection name is required",
		})
	}

	orderBy := c.QueryParam("order")

	// Collect all query parameters as filters
	filters := c.QueryParams()

	// Pagination parameters
	limitStr := c.QueryParam("limit")
	offsetStr := c.QueryParam("offset")
	limit := 100 // Default limit
	if limitStr != "" {
		if parsedLimit, err := strconv.Atoi(limitStr); err == nil && parsedLimit > 0 {
			limit = parsedLimit
		}
	}
	if limit > 1000 {
		limit = 1000
	}
	offset := 0
	if offsetStr != "" {
		if parsedOffset, err := strconv.Atoi(offsetStr); err == nil && parsedOffset >= 0 {
			offset = parsedOffset
		}
	}

	// Inject RLS filter if enabled
	ownerField, ownerID := h.extractRlsOwnerInfo(c)
	if ownerField != "" && ownerID != "" {
		filters[ownerField] = append(filters[ownerField], "eq."+ownerID)
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	result, err := h.DB.ListRecords(ctx, collectionName, filters, orderBy, limit, offset)
	if err != nil {
		// Client/navigation cancellations are expected in dynamic dashboards.
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return c.NoContent(http.StatusRequestTimeout)
		}
		// SECURITY: Don't leak SQL errors to client
		fmt.Printf("[ERROR] ListRecords (%s): %v\n", collectionName, err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch records. Please verify your query parameters.",
		})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"data":       result.Data,
		"total":      result.Total,
		"page":       (offset / limit) + 1,
		"limit":      limit,
		"hasMore":    result.HasMore,
		"totalExact": result.TotalExact,
	})
}

// GetRecord handles GET /api/collections/:name/records/:id
func (h *Handler) GetRecord(c echo.Context) error {
	collectionName := c.Param("name")
	recordID := c.Param("id")

	if collectionName == "" || recordID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Collection name and record ID are required",
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	ownerField, ownerID := h.extractRlsOwnerInfo(c)
	record, err := h.DB.GetRecord(ctx, collectionName, recordID, ownerField, ownerID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": err.Error(),
		})
	}

	return c.JSON(http.StatusOK, record)
}

// UpdateRecord handles PATCH /api/collections/:name/records/:id
func (h *Handler) UpdateRecord(c echo.Context) error {
	collectionName := c.Param("name")
	recordID := c.Param("id")

	if collectionName == "" || recordID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Collection name and record ID are required",
		})
	}

	var data map[string]any
	if err := json.NewDecoder(c.Request().Body).Decode(&data); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid JSON body: " + err.Error(),
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	ownerField, ownerID := h.extractRlsOwnerInfo(c)
	err := h.DB.UpdateRecord(ctx, collectionName, recordID, data, ownerField, ownerID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": err.Error(),
		})
	}

	return c.NoContent(http.StatusNoContent)
}

// DeleteRecord handles DELETE /api/collections/:name/records/:id
func (h *Handler) DeleteRecord(c echo.Context) error {
	collectionName := c.Param("name")
	recordID := c.Param("id")

	if collectionName == "" || recordID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Collection name and record ID are required",
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	ownerField, ownerID := h.extractRlsOwnerInfo(c)
	err := h.DB.DeleteRecord(ctx, collectionName, recordID, ownerField, ownerID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": err.Error(),
		})
	}

	return c.NoContent(http.StatusNoContent)
}

// BulkRowsAction handles POST /api/tables/:name/rows/bulk
func (h *Handler) BulkRowsAction(c echo.Context) error {
	collectionName := c.Param("name")
	if collectionName == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Collection name is required",
		})
	}
	if !data.IsValidIdentifier(collectionName) {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid collection name",
		})
	}

	var req struct {
		Action string         `json:"action"`
		IDs    []string       `json:"ids"`
		Data   map[string]any `json:"data"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request body",
		})
	}

	req.Action = strings.ToLower(strings.TrimSpace(req.Action))
	if len(req.IDs) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "At least one row ID is required",
		})
	}
	if len(req.IDs) > 5000 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Bulk operations are limited to 5000 rows per request",
		})
	}

	ownerField, ownerID := h.extractRlsOwnerInfo(c)
	ctx, cancel := context.WithTimeout(c.Request().Context(), 20*time.Second)
	defer cancel()

	var (
		affected int64
		err      error
	)

	switch req.Action {
	case "delete":
		affected, err = h.DB.BulkDeleteRecords(ctx, collectionName, req.IDs, ownerField, ownerID)
	case "update":
		if len(req.Data) == 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Field data is required for bulk update",
			})
		}
		affected, err = h.DB.BulkUpdateRecords(ctx, collectionName, req.IDs, req.Data, ownerField, ownerID)
	default:
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Unsupported action. Use 'update' or 'delete'.",
		})
	}

	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return c.NoContent(http.StatusRequestTimeout)
		}
		fmt.Printf("[ERROR] BulkRowsAction (%s): %v\n", collectionName, err)
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Bulk operation failed",
		})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"affected": affected,
		"action":   req.Action,
	})
}

// ImportRecords handles POST /api/tables/:name/import
func (h *Handler) ImportRecords(c echo.Context) error {
	collectionName := c.Param("name")
	if collectionName == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Name required"})
	}

	var records []map[string]any
	if err := json.NewDecoder(c.Request().Body).Decode(&records); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid JSON array"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 30*time.Second)
	defer cancel()

	ownerField, ownerID := h.extractRlsOwnerInfo(c)
	if ownerField != "" && ownerID != "" && h.DB.HasColumn(ctx, collectionName, ownerField) {
		for index, record := range records {
			records[index] = applyOwnerFieldDefault(record, ownerField, ownerID)
		}
	}

	if err := h.DB.BulkInsertRecord(ctx, collectionName, records); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": fmt.Sprintf("Imported %d records", len(records))})
}
