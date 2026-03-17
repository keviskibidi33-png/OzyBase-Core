package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

type marketplaceSeedItem struct {
	Slug          string
	Name          string
	ExtensionName string
	Kind          string
	Version       string
	Description   string
	Homepage      string
	Repository    string
	Verified      bool
	Metadata      map[string]any
}

var builtinMarketplaceCatalog = []marketplaceSeedItem{
	{
		Slug:          "pgvector",
		Name:          "pgvector",
		ExtensionName: "vector",
		Kind:          "postgres",
		Version:       "latest",
		Description:   "Vector similarity search for PostgreSQL",
		Homepage:      "https://github.com/pgvector/pgvector",
		Repository:    "https://github.com/pgvector/pgvector",
		Verified:      true,
		Metadata:      map[string]any{"category": "ai"},
	},
	{
		Slug:          "pg_trgm",
		Name:          "pg_trgm",
		ExtensionName: "pg_trgm",
		Kind:          "postgres",
		Version:       "latest",
		Description:   "Text similarity and trigram indexing",
		Homepage:      "https://www.postgresql.org/docs/current/pgtrgm.html",
		Repository:    "https://www.postgresql.org/docs/current/pgtrgm.html",
		Verified:      true,
		Metadata:      map[string]any{"category": "search"},
	},
	{
		Slug:          "pg_stat_statements",
		Name:          "pg_stat_statements",
		ExtensionName: "pg_stat_statements",
		Kind:          "postgres",
		Version:       "latest",
		Description:   "Track execution statistics of SQL statements",
		Homepage:      "https://www.postgresql.org/docs/current/pgstatstatements.html",
		Repository:    "https://www.postgresql.org/docs/current/pgstatstatements.html",
		Verified:      true,
		Metadata:      map[string]any{"category": "observability"},
	},
	{
		Slug:          "postgis",
		Name:          "PostGIS",
		ExtensionName: "postgis",
		Kind:          "postgres",
		Version:       "latest",
		Description:   "Spatial and geographic objects support",
		Homepage:      "https://postgis.net/",
		Repository:    "https://github.com/postgis/postgis",
		Verified:      true,
		Metadata:      map[string]any{"category": "geo"},
	},
	{
		Slug:          "wasm-core-runtime",
		Name:          "WASM Core Runtime",
		ExtensionName: "wasm_core_runtime",
		Kind:          "wasm",
		Version:       "v1",
		Description:   "Native WASM runtime support for Edge Functions",
		Homepage:      "https://webassembly.org/",
		Repository:    "https://webassembly.org/",
		Verified:      true,
		Metadata:      map[string]any{"category": "edge"},
	},
}

type MarketplaceExtensionInfo struct {
	Slug             string         `json:"slug"`
	Name             string         `json:"name"`
	ExtensionName    string         `json:"extension_name"`
	Kind             string         `json:"kind"`
	Version          string         `json:"version"`
	Description      string         `json:"description"`
	Homepage         string         `json:"homepage"`
	Repository       string         `json:"repository"`
	Verified         bool           `json:"verified"`
	Metadata         map[string]any `json:"metadata"`
	Installed        bool           `json:"installed"`
	InstalledVersion string         `json:"installed_version,omitempty"`
	Status           string         `json:"status"`
	UpdatedAt        time.Time      `json:"updated_at"`
}

func isValidMarketplaceIdentifier(raw string) bool {
	if len(raw) < 1 || len(raw) > 120 {
		return false
	}
	for _, r := range raw {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			continue
		}
		return false
	}
	return true
}

func (h *Handler) syncMarketplaceCatalog(ctx context.Context) (int, error) {
	count := 0
	for _, item := range builtinMarketplaceCatalog {
		if !isValidMarketplaceIdentifier(item.Slug) || !isValidMarketplaceIdentifier(item.ExtensionName) {
			continue
		}
		metadataJSON, _ := json.Marshal(item.Metadata)
		_, err := h.DB.Pool.Exec(ctx, `
			INSERT INTO _v_extension_marketplace (
				slug, name, extension_name, kind, version, description, homepage, repository, verified, metadata, updated_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()
			)
			ON CONFLICT (slug) DO UPDATE SET
				name = EXCLUDED.name,
				extension_name = EXCLUDED.extension_name,
				kind = EXCLUDED.kind,
				version = EXCLUDED.version,
				description = EXCLUDED.description,
				homepage = EXCLUDED.homepage,
				repository = EXCLUDED.repository,
				verified = EXCLUDED.verified,
				metadata = EXCLUDED.metadata,
				updated_at = NOW()
		`, item.Slug, item.Name, item.ExtensionName, item.Kind, item.Version, item.Description, item.Homepage, item.Repository, item.Verified, metadataJSON)
		if err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

func (h *Handler) findMarketplaceEntry(ctx context.Context, slug string) (MarketplaceExtensionInfo, error) {
	var (
		info        MarketplaceExtensionInfo
		metadataRaw []byte
	)
	err := h.DB.Pool.QueryRow(ctx, `
		SELECT slug, name, extension_name, kind, version, COALESCE(description, ''), COALESCE(homepage, ''),
		       COALESCE(repository, ''), verified, metadata, updated_at
		FROM _v_extension_marketplace
		WHERE slug = $1
	`, slug).Scan(
		&info.Slug, &info.Name, &info.ExtensionName, &info.Kind, &info.Version, &info.Description,
		&info.Homepage, &info.Repository, &info.Verified, &metadataRaw, &info.UpdatedAt,
	)
	if err != nil {
		return info, err
	}
	info.Metadata = map[string]any{}
	_ = json.Unmarshal(metadataRaw, &info.Metadata)
	return info, nil
}

// ListExtensionMarketplace handles GET /api/extensions/marketplace
func (h *Handler) ListExtensionMarketplace(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	kindFilter := strings.TrimSpace(strings.ToLower(c.QueryParam("kind")))
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT m.slug, m.name, m.extension_name, m.kind, m.version, COALESCE(m.description, ''), COALESCE(m.homepage, ''),
		       COALESCE(m.repository, ''), m.verified, m.metadata,
		       COALESCE(i.status, ''), COALESCE(i.installed_version, ''), COALESCE(i.updated_at, to_timestamp(0))
		FROM _v_extension_marketplace m
		LEFT JOIN _v_extension_installations i ON i.slug = m.slug AND i.kind = m.kind
		WHERE ($1 = '' OR m.kind = $1)
		ORDER BY m.kind ASC, m.slug ASC
	`, kindFilter)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	pgInstalled := map[string]string{}
	pgRows, pgErr := h.DB.Pool.Query(ctx, `SELECT extname, extversion FROM pg_extension`)
	if pgErr == nil {
		defer pgRows.Close()
		for pgRows.Next() {
			var extName string
			var extVersion string
			if scanErr := pgRows.Scan(&extName, &extVersion); scanErr == nil {
				pgInstalled[strings.TrimSpace(extName)] = strings.TrimSpace(extVersion)
			}
		}
	}

	items := make([]MarketplaceExtensionInfo, 0, 16)
	for rows.Next() {
		var (
			item         MarketplaceExtensionInfo
			statusRaw    string
			installedRaw string
			metadataRaw  []byte
			updatedAt    time.Time
		)
		if scanErr := rows.Scan(
			&item.Slug, &item.Name, &item.ExtensionName, &item.Kind, &item.Version, &item.Description,
			&item.Homepage, &item.Repository, &item.Verified, &metadataRaw, &statusRaw, &installedRaw, &updatedAt,
		); scanErr != nil {
			continue
		}

		item.Metadata = map[string]any{}
		_ = json.Unmarshal(metadataRaw, &item.Metadata)
		item.Status = strings.TrimSpace(statusRaw)
		item.InstalledVersion = strings.TrimSpace(installedRaw)
		item.UpdatedAt = updatedAt

		switch item.Kind {
		case "postgres":
			if v, ok := pgInstalled[item.ExtensionName]; ok {
				item.Installed = true
				item.Status = "installed"
				item.InstalledVersion = v
			}
		case "wasm":
			item.Installed = strings.EqualFold(item.Status, "installed")
			if item.InstalledVersion == "" && item.Installed {
				item.InstalledVersion = item.Version
			}
		}
		if item.Status == "" {
			item.Status = "available"
		}
		items = append(items, item)
	}

	return c.JSON(http.StatusOK, map[string]any{
		"items":  items,
		"count":  len(items),
		"source": "native_catalog",
	})
}

// SyncExtensionMarketplace handles POST /api/extensions/marketplace/sync
func (h *Handler) SyncExtensionMarketplace(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	count, err := h.syncMarketplaceCatalog(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, map[string]any{
		"status": "synced",
		"count":  count,
	})
}

func (h *Handler) markExtensionInstallation(ctx context.Context, item MarketplaceExtensionInfo, status string, installedVersion string, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadataJSON, _ := json.Marshal(metadata)
	_, err := h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_extension_installations (
			marketplace_id, slug, extension_name, kind, status, installed_version, metadata, installed_at, updated_at
		)
		SELECT id, slug, extension_name, kind, $2, $3, $4, NOW(), NOW()
		FROM _v_extension_marketplace
		WHERE slug = $1
		ON CONFLICT (slug, kind) DO UPDATE SET
			status = EXCLUDED.status,
			installed_version = EXCLUDED.installed_version,
			metadata = EXCLUDED.metadata,
			updated_at = NOW()
	`, item.Slug, status, installedVersion, metadataJSON)
	return err
}

// InstallMarketplaceExtension handles POST /api/extensions/marketplace/:slug/install
func (h *Handler) InstallMarketplaceExtension(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 20*time.Second)
	defer cancel()

	slug := strings.TrimSpace(c.Param("slug"))
	if !isValidMarketplaceIdentifier(slug) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid extension slug"})
	}

	item, err := h.findMarketplaceEntry(ctx, slug)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "marketplace extension not found"})
	}

	installedVersion := item.Version
	if item.Kind == "postgres" {
		if !isValidMarketplaceIdentifier(item.ExtensionName) {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid PostgreSQL extension name in catalog"})
		}
		sql := `CREATE EXTENSION IF NOT EXISTS "` + item.ExtensionName + `"`
		if _, err := h.DB.Pool.Exec(ctx, sql); err != nil {
			return c.JSON(http.StatusConflict, map[string]string{"error": err.Error()})
		}
		_ = h.DB.Pool.QueryRow(ctx, `SELECT extversion FROM pg_extension WHERE extname = $1`, item.ExtensionName).Scan(&installedVersion)
	}

	if err := h.markExtensionInstallation(ctx, item, "installed", installedVersion, map[string]any{
		"installed_by": "api",
	}); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status":            "installed",
		"slug":              item.Slug,
		"kind":              item.Kind,
		"installed_version": installedVersion,
	})
}

// UninstallMarketplaceExtension handles DELETE /api/extensions/marketplace/:slug/install
func (h *Handler) UninstallMarketplaceExtension(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 20*time.Second)
	defer cancel()

	slug := strings.TrimSpace(c.Param("slug"))
	if !isValidMarketplaceIdentifier(slug) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid extension slug"})
	}

	item, err := h.findMarketplaceEntry(ctx, slug)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "marketplace extension not found"})
	}

	if item.Kind == "postgres" {
		if !isValidMarketplaceIdentifier(item.ExtensionName) {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid PostgreSQL extension name in catalog"})
		}
		sql := `DROP EXTENSION IF EXISTS "` + item.ExtensionName + `" CASCADE`
		if _, err := h.DB.Pool.Exec(ctx, sql); err != nil {
			return c.JSON(http.StatusConflict, map[string]string{"error": err.Error()})
		}
	}

	if err := h.markExtensionInstallation(ctx, item, "disabled", "", map[string]any{
		"disabled_by": "api",
	}); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status": "disabled",
		"slug":   item.Slug,
		"kind":   item.Kind,
	})
}
