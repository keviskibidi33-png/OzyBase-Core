package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

type Wrapper struct {
	Name    string `json:"name"`
	Handler string `json:"handler"`
	Status  string `json:"status"`
}

// WRAPPERS HANDLERS
func (h *Handler) ListWrappers(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.DB.Pool.Query(ctx, "SELECT fdwname, fdwhandler::regproc::text FROM pg_foreign_data_wrapper")
	if err != nil {
		return c.JSON(http.StatusOK, []Wrapper{})
	}
	defer rows.Close()

	var wrappers []Wrapper
	for rows.Next() {
		var w Wrapper
		if err := rows.Scan(&w.Name, &w.Handler); err != nil {
			continue
		}
		w.Status = "active"
		wrappers = append(wrappers, w)
	}

	if wrappers == nil {
		wrappers = []Wrapper{}
	}

	return c.JSON(http.StatusOK, wrappers)
}

func (h *Handler) CreateWrapper(c echo.Context) error {
	var input struct {
		Name    string `json:"name"`
		Handler string `json:"handler"`
	}
	if err := c.Bind(&input); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	if strings.TrimSpace(input.Name) == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "name is required"})
	}
	for _, r := range input.Name {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '_' && r != '-' {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid wrapper name"})
		}
	}

	_, err := h.DB.Pool.Exec(ctx, `CREATE EXTENSION IF NOT EXISTS "`+input.Name+`"`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]string{"status": "created"})
}

func (h *Handler) DeleteWrapper(c echo.Context) error {
	name := c.Param("name") // Using name as ID
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	for _, r := range name {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '_' && r != '-' {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid wrapper name"})
		}
	}

	_, err := h.DB.Pool.Exec(ctx, `DROP EXTENSION IF EXISTS "`+name+`" CASCADE`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusOK)
}
