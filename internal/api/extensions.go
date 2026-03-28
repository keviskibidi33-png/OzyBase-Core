package api

import (
	"context"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

type ExtensionInfo struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Installed   bool   `json:"installed"`
	Description string `json:"description"`
}

func (h *FunctionsHandler) ListExtensions(c echo.Context) error {
	// Actually we should probably put this in Handler since it needs DB
	return c.JSON(http.StatusOK, []string{})
}

// I will move this to handlers.go or a new extensions.go that uses Handler struct
func (h *Handler) ListExtensions(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.DB.Pool.Query(ctx, `
		SELECT name, default_version, installed_version, comment
		FROM pg_available_extensions
		WHERE name NOT LIKE 'pg_%'
		   OR name IN ('pg_cron', 'pg_graphql', 'pg_stat_statements')
		ORDER BY name ASC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var extensions []ExtensionInfo
	for rows.Next() {
		var ext ExtensionInfo
		var installedVersion *string
		if err := rows.Scan(&ext.Name, &ext.Version, &installedVersion, &ext.Description); err != nil {
			continue
		}
		ext.Installed = installedVersion != nil
		extensions = append(extensions, ext)
	}

	return c.JSON(http.StatusOK, extensions)
}

func (h *Handler) ToggleExtension(c echo.Context) error {
	name := c.Param("name")
	action := c.QueryParam("action") // enable/disable

	// Basic validation to prevent SQL injection since we can't bind extension names
	if action != "enable" && action != "disable" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid action"})
	}

	// Ensure name is alphanumeric + underscores/hyphens
	for _, r := range name {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '_' && r != '-' {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid extension name"})
		}
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 30*time.Second) // Extensions can take time
	defer cancel()

	var sql string
	if action == "enable" {
		sql = "CREATE EXTENSION IF NOT EXISTS \"" + name + "\""
	} else {
		sql = "DROP EXTENSION IF EXISTS \"" + name + "\" CASCADE"
	}

	if _, err := h.DB.Pool.Exec(ctx, sql); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.NoContent(http.StatusOK)
}
