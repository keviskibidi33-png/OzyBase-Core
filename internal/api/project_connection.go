package api

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/version"
	"github.com/labstack/echo/v4"
)

type ProjectConnectionInfo struct {
	Database          string `json:"database"`
	Host              string `json:"host"`
	Port              string `json:"port"`
	User              string `json:"user"`
	APIURL            string `json:"api_url"`
	DirectURITemplate string `json:"direct_uri_template"`
	PoolerURITemplate string `json:"pooler_uri_template"`
	AppVersion        string `json:"app_version"`
	GitCommit         string `json:"git_commit"`
}

func (h *Handler) GetProjectConnection(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	connection := projectConnectionFromConfig(c)
	if connection.Database == "" {
		_ = h.DB.Pool.QueryRow(ctx, `SELECT current_database()`).Scan(&connection.Database)
	}

	return c.JSON(http.StatusOK, connection)
}

func projectConnectionFromConfig(c echo.Context) ProjectConnectionInfo {
	parsedHost, parsedPort, parsedUser, parsedDatabase, parsedSSLMode := parseConnectionConfig(os.Getenv("DATABASE_URL"))

	host := firstNonEmpty(os.Getenv("DB_HOST"), parsedHost, "localhost")
	port := firstNonEmpty(os.Getenv("DB_PORT"), parsedPort, "5432")
	user := firstNonEmpty(os.Getenv("DB_USER"), parsedUser, "postgres")
	database := firstNonEmpty(os.Getenv("DB_NAME"), parsedDatabase)
	sslMode := firstNonEmpty(os.Getenv("DB_SSLMODE"), parsedSSLMode, "disable")

	apiURL := strings.TrimRight(os.Getenv("SITE_URL"), "/")
	if apiURL == "" {
		apiURL = strings.TrimRight(c.Scheme()+"://"+c.Request().Host, "/")
	}

	directURI := "postgresql://" + user + ":[YOUR-PASSWORD]@" + host + ":" + port + "/" + database + "?sslmode=" + sslMode
	poolerURI := "postgresql://" + user + ":[YOUR-PASSWORD]@" + host + ":6543/" + database + "?sslmode=" + sslMode

	return ProjectConnectionInfo{
		Database:          database,
		Host:              host,
		Port:              port,
		User:              user,
		APIURL:            apiURL,
		DirectURITemplate: directURI,
		PoolerURITemplate: poolerURI,
		AppVersion:        version.Version,
		GitCommit:         version.Commit,
	}
}

func parseConnectionConfig(databaseURL string) (host, port, user, database, sslMode string) {
	if databaseURL == "" {
		return "", "", "", "", ""
	}

	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return "", "", "", "", ""
	}

	host = parsed.Hostname()
	port = parsed.Port()
	if parsed.User != nil {
		user = parsed.User.Username()
	}
	database = strings.TrimPrefix(parsed.Path, "/")
	sslMode = parsed.Query().Get("sslmode")
	return host, port, user, database, sslMode
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
