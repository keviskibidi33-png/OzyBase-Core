package api

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/version"
	"github.com/jackc/pgx/v5/pgxpool"
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

type databaseConnectionConfig struct {
	Host     string
	Port     string
	User     string
	Database string
	SSLMode  string
}

func (h *Handler) GetProjectConnection(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	runtimeConfig := resolveRuntimeConnectionConfig(h)
	hydrateRuntimeConnectionConfig(ctx, h, &runtimeConfig)
	connection := buildProjectConnectionInfo(
		runtimeConfig,
		resolvePoolerConnectionConfig(),
		resolveProjectAPIURL(c),
	)

	return c.JSON(http.StatusOK, connection)
}

func resolveRuntimeConnectionConfig(h *Handler) databaseConnectionConfig {
	parsedHost, parsedPort, parsedUser, parsedDatabase, parsedSSLMode := parseConnectionConfig(os.Getenv("DATABASE_URL"))

	config := databaseConnectionConfig{
		Host:     firstNonEmpty(parsedHost, os.Getenv("DB_HOST")),
		Port:     firstNonEmpty(parsedPort, os.Getenv("DB_PORT")),
		User:     firstNonEmpty(parsedUser, os.Getenv("DB_USER")),
		Database: firstNonEmpty(parsedDatabase, os.Getenv("DB_NAME")),
		SSLMode:  firstNonEmpty(os.Getenv("DB_SSLMODE"), parsedSSLMode, "disable"),
	}

	if h == nil || h.DB == nil || h.DB.Pool == nil {
		return config
	}

	return mergeConnectionConfig(connectionConfigFromPoolConfig(h.DB.Pool.Config()), config)
}

func hydrateRuntimeConnectionConfig(ctx context.Context, h *Handler, config *databaseConnectionConfig) {
	if config == nil || h == nil || h.DB == nil || h.DB.Pool == nil {
		return
	}

	var (
		serverHost string
		serverPort string
		serverUser string
		database   string
	)
	if err := h.DB.Pool.QueryRow(ctx, `
		SELECT
			COALESCE(inet_server_addr()::text, ''),
			COALESCE(current_setting('port', true), ''),
			current_user,
			current_database()
	`).Scan(&serverHost, &serverPort, &serverUser, &database); err != nil {
		return
	}

	config.Host = firstNonEmpty(config.Host, serverHost)
	config.Port = firstNonEmpty(config.Port, serverPort)
	config.User = firstNonEmpty(config.User, serverUser)
	config.Database = firstNonEmpty(config.Database, database)
}

func buildProjectConnectionInfo(runtimeConfig, poolerConfig databaseConnectionConfig, apiURL string) ProjectConnectionInfo {
	return ProjectConnectionInfo{
		Database:          runtimeConfig.Database,
		Host:              runtimeConfig.Host,
		Port:              runtimeConfig.Port,
		User:              runtimeConfig.User,
		APIURL:            apiURL,
		DirectURITemplate: buildConnectionURITemplate(runtimeConfig),
		PoolerURITemplate: buildConnectionURITemplate(poolerConfig),
		AppVersion:        version.Version,
		GitCommit:         version.Commit,
	}
}

func resolveProjectAPIURL(c echo.Context) string {
	apiURL := strings.TrimRight(os.Getenv("SITE_URL"), "/")
	if apiURL == "" {
		apiURL = strings.TrimRight(c.Scheme()+"://"+c.Request().Host, "/")
	}
	return apiURL
}

func resolvePoolerConnectionConfig() databaseConnectionConfig {
	poolerURL := firstNonEmpty(os.Getenv("DB_POOLER_URL"), os.Getenv("POOLER_URL"))
	parsedHost, parsedPort, parsedUser, parsedDatabase, parsedSSLMode := parseConnectionConfig(poolerURL)

	return databaseConnectionConfig{
		Host:     firstNonEmpty(parsedHost, os.Getenv("DB_POOLER_HOST")),
		Port:     firstNonEmpty(parsedPort, os.Getenv("DB_POOLER_PORT")),
		User:     firstNonEmpty(parsedUser, os.Getenv("DB_POOLER_USER")),
		Database: firstNonEmpty(parsedDatabase, os.Getenv("DB_POOLER_DATABASE")),
		SSLMode:  firstNonEmpty(os.Getenv("DB_POOLER_SSLMODE"), parsedSSLMode),
	}
}

func connectionConfigFromPoolConfig(poolConfig *pgxpool.Config) databaseConnectionConfig {
	if poolConfig == nil || poolConfig.ConnConfig == nil {
		return databaseConnectionConfig{}
	}

	sslMode := ""
	if poolConfig.ConnConfig.RuntimeParams != nil {
		sslMode = poolConfig.ConnConfig.RuntimeParams["sslmode"]
	}
	if sslMode == "" {
		_, _, _, _, parsedSSLMode := parseConnectionConfig(poolConfig.ConnString())
		sslMode = parsedSSLMode
	}

	return databaseConnectionConfig{
		Host:     strings.TrimSpace(poolConfig.ConnConfig.Host),
		Port:     strconv.Itoa(int(poolConfig.ConnConfig.Port)),
		User:     strings.TrimSpace(poolConfig.ConnConfig.User),
		Database: strings.TrimSpace(poolConfig.ConnConfig.Database),
		SSLMode:  strings.TrimSpace(sslMode),
	}
}

func mergeConnectionConfig(primary, fallback databaseConnectionConfig) databaseConnectionConfig {
	return databaseConnectionConfig{
		Host:     firstNonEmpty(primary.Host, fallback.Host),
		Port:     firstNonEmpty(primary.Port, fallback.Port),
		User:     firstNonEmpty(primary.User, fallback.User),
		Database: firstNonEmpty(primary.Database, fallback.Database),
		SSLMode:  firstNonEmpty(primary.SSLMode, fallback.SSLMode),
	}
}

func buildConnectionURITemplate(config databaseConnectionConfig) string {
	host := strings.TrimSpace(config.Host)
	port := strings.TrimSpace(config.Port)
	user := strings.TrimSpace(config.User)
	database := strings.TrimSpace(config.Database)
	if host == "" || port == "" || user == "" || database == "" {
		return ""
	}

	return fmt.Sprintf(
		"postgresql://%s:[YOUR-PASSWORD]@%s:%s/%s?sslmode=%s",
		user,
		host,
		port,
		database,
		firstNonEmpty(config.SSLMode, "disable"),
	)
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
