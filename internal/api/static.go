package api

import (
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"
)

// DistFS is the embedded frontend dist directory
//
//go:embed all:frontend_dist
var distEmbedFS embed.FS

func preferredStaticDistDir() string {
	explicitDir := strings.TrimSpace(os.Getenv("OZY_FRONTEND_DIST_DIR"))
	if explicitDir != "" {
		return explicitDir
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("DEBUG")), "true") {
		return filepath.Join("frontend", "dist")
	}
	return ""
}

func resolveStaticFS() fs.FS {
	if preferredDistDir := preferredStaticDistDir(); preferredDistDir != "" {
		if _, err := os.Stat(filepath.Join(preferredDistDir, "index.html")); err == nil {
			return os.DirFS(preferredDistDir)
		}
	}

	distFS, err := fs.Sub(distEmbedFS, "frontend_dist")
	if err != nil {
		panic(err)
	}

	return distFS
}

// RegisterStaticRoutes registers the routes for serving the embedded frontend
func RegisterStaticRoutes(e *echo.Echo) {
	distFS := resolveStaticFS()

	// Create a file server handler
	fileServer := http.FileServer(http.FS(distFS))

	// Serve static files
	e.GET("/*", func(c echo.Context) error {
		path := c.Request().URL.Path

		// If it's an API request, let Echo handle it (though usually API routes are registered first)
		if strings.HasPrefix(path, "/api") {
			return echo.ErrNotFound
		}

		// Check if file exists in embedded FS
		_, err := distFS.Open(strings.TrimPrefix(path, "/"))
		if err != nil {
			// If file not found, serve index.html (SPA Fallback)
			c.Request().URL.Path = "/"
			fileServer.ServeHTTP(c.Response(), c.Request())
			return nil
		}

		// Otherwise serve the file
		fileServer.ServeHTTP(c.Response(), c.Request())
		return nil
	})
}
