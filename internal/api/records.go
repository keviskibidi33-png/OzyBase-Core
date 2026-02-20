package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

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

	// Insert the record
	id, err := h.DB.InsertRecord(ctx, collectionName, data)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": err.Error(),
		})
	}

	// Fetch the complete record to return
	ownerField, ownerID := h.extractRlsOwnerInfo(c)
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
	role, _ := c.Get("role").(string)
	fmt.Printf("\n[API] >>> ListRecords START | Table: %s | Role: %s | URL: %s\n", collectionName, role, c.Request().URL.String())

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
		fmt.Sscanf(limitStr, "%d", &limit)
	}
	offset := 0
	if offsetStr != "" {
		fmt.Sscanf(offsetStr, "%d", &offset)
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
		"data":  result.Data,
		"total": result.Total,
		"page":  (offset / limit) + 1,
		"limit": limit,
	})
}

// GetRecord handles GET /api/collections/:name/records/:id
func (h *Handler) GetRecord(c echo.Context) error {
	collectionName := c.Param("name")
	recordID := c.Param("id")
	fmt.Printf("\n[API] >>> GetRecord START | Table: %s | ID: %s | URL: %s\n", collectionName, recordID, c.Request().URL.String())

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

	if err := h.DB.BulkInsertRecord(ctx, collectionName, records); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": fmt.Sprintf("Imported %d records", len(records))})
}
