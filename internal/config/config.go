package config

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL            string
	DeploymentProfile      string
	Port                   string
	JWTSecret              string
	AnonKey                string
	ServiceRoleKey         string
	PreviousAnonKey        string
	PreviousServiceRoleKey string
	StaticKeyGraceUntil    time.Time
	APIKeyGraceMinutes     int
	Debug                  bool
	StrictSecurity         bool

	// Security & Domains
	AppDomain      string
	SiteURL        string
	RateLimitRPS   float64
	RateLimitBurst int
	BodyLimit      string
	AllowedOrigins []string

	// Storage
	StorageProvider                   string
	StoragePath                       string
	StorageFallbackLocal              bool
	StorageMaintenanceIntervalMinutes int
	S3Endpoint                        string
	S3AccessKey                       string
	S3SecretKey                       string
	S3UseSSL                          bool

	// Realtime
	RealtimeBroker  string
	RedisAddr       string
	RedisPassword   string
	RedisDB         int
	RealtimeNodeID  string
	RealtimeChannel string

	// SMTP
	SMTPHost string
	SMTPPort string
	SMTPUser string
	SMTPPass string
	SMTPFrom string

	// Bootstrap metadata
	GeneratedJWTSecret      bool
	GeneratedAnonKey        bool
	GeneratedServiceRoleKey bool
	DerivedAllowedOrigin    bool
	SecurityWarnings        []string
}

func Load() (*Config, error) {
	if !strings.EqualFold(strings.TrimSpace(os.Getenv("OZY_SKIP_DOTENV")), "true") {
		_ = godotenv.Load()
	}
	debug := strings.EqualFold(getEnv("DEBUG", "false"), "true")
	strictSecurity := strings.EqualFold(getEnv("OZY_STRICT_SECURITY", "false"), "true")

	// Validate required PostgreSQL variables
	required := []string{"DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"}
	allSet := true
	for _, env := range required {
		if readEnv(env) == "" {
			allSet = false
			break
		}
	}

	var dbURL string
	if allSet {
		dbURL = fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
			readEnv("DB_USER"),
			readEnv("DB_PASSWORD"),
			readEnv("DB_HOST"),
			readEnv("DB_PORT"),
			readEnv("DB_NAME"),
			getEnv("DB_SSLMODE", "disable"),
		)
	} else {
		dbURL = readEnv("DATABASE_URL")
	}

	jwtSecret := readEnv("JWT_SECRET")
	generatedJWTSecret := false
	if jwtSecret == "" {
		jwtSecret = getOrGenerateSecret()
		generatedJWTSecret = true
	}
	_ = os.Setenv("JWT_SECRET", jwtSecret)

	anonKey := readEnv("ANON_KEY")
	generatedAnonKey := false
	if anonKey == "" {
		anonKey, generatedAnonKey = getOrGenerateNamedSecret(".ozy_anon_key", 32, "ozy_anon_")
	}
	_ = os.Setenv("ANON_KEY", anonKey)

	serviceRoleKey := firstNonEmpty(readEnv("SERVICE_ROLE_KEY"), readEnv("OZY_SERVICE_ROLE_KEY"))
	generatedServiceRoleKey := false
	if serviceRoleKey == "" {
		serviceRoleKey, generatedServiceRoleKey = getOrGenerateNamedSecret(".ozy_service_role_key", 48, "ozy_service_role_")
	}
	_ = os.Setenv("SERVICE_ROLE_KEY", serviceRoleKey)
	previousAnonKey := readEnv("ANON_KEY_PREVIOUS")
	previousServiceRoleKey := firstNonEmpty(readEnv("SERVICE_ROLE_KEY_PREVIOUS"), readEnv("OZY_SERVICE_ROLE_KEY_PREVIOUS"))
	staticKeyGraceUntil := parseOptionalRFC3339(readEnv("STATIC_KEY_GRACE_UNTIL"))
	apiKeyGraceMinutes := getEnvAsInt("API_KEY_ROTATION_GRACE_MINUTES", 15)
	if apiKeyGraceMinutes < 0 {
		apiKeyGraceMinutes = 0
	}
	if apiKeyGraceMinutes > 10080 {
		apiKeyGraceMinutes = 10080
	}

	siteURL := getEnv("SITE_URL", "https://api.example.com")
	appDomain := getEnv("APP_DOMAIN", "example.com")

	origins, derivedAllowedOrigin := resolveAllowedOrigins(getEnv("ALLOWED_ORIGINS", ""), siteURL, appDomain, debug)

	rps, _ := strconv.ParseFloat(getEnv("RATE_LIMIT_RPS", "20"), 64)
	burst, _ := strconv.Atoi(getEnv("RATE_LIMIT_BURST", "20"))

	redisDB, _ := strconv.Atoi(getEnv("REDIS_DB", "0"))

	cfg := &Config{
		DatabaseURL:             dbURL,
		DeploymentProfile:       resolveDeploymentProfile(debug, dbURL),
		Port:                    getEnv("PORT", "8090"),
		JWTSecret:               jwtSecret,
		AnonKey:                 anonKey,
		ServiceRoleKey:          serviceRoleKey,
		PreviousAnonKey:         previousAnonKey,
		PreviousServiceRoleKey:  previousServiceRoleKey,
		StaticKeyGraceUntil:     staticKeyGraceUntil,
		APIKeyGraceMinutes:      apiKeyGraceMinutes,
		Debug:                   debug,
		StrictSecurity:          strictSecurity,
		AppDomain:               appDomain,
		SiteURL:                 siteURL,
		AllowedOrigins:          origins,
		RateLimitRPS:            rps,
		RateLimitBurst:          burst,
		BodyLimit:               getEnv("BODY_LIMIT", "64M"),
		GeneratedJWTSecret:      generatedJWTSecret,
		GeneratedAnonKey:        generatedAnonKey,
		GeneratedServiceRoleKey: generatedServiceRoleKey,
		DerivedAllowedOrigin:    derivedAllowedOrigin,
		SecurityWarnings:        nil,

		// Storage
		StorageProvider:                   getEnv("OZY_STORAGE_PROVIDER", "local"),
		StoragePath:                       getEnv("OZY_STORAGE_PATH", "./data/storage"),
		StorageFallbackLocal:              strings.EqualFold(getEnv("OZY_STORAGE_FALLBACK_LOCAL", "true"), "true"),
		StorageMaintenanceIntervalMinutes: getEnvAsInt("OZY_STORAGE_MAINTENANCE_INTERVAL_MINUTES", 60),
		S3Endpoint:                        readEnv("S3_ENDPOINT"),
		S3AccessKey:                       readEnv("S3_ACCESS_KEY"),
		S3SecretKey:                       readEnv("S3_SECRET_KEY"),
		S3UseSSL:                          getEnv("S3_USE_SSL", "false") == "true",

		// Realtime
		RealtimeBroker:  getEnv("OZY_REALTIME_BROKER", "local"),
		RedisAddr:       readEnv("REDIS_ADDR"),
		RedisPassword:   readEnv("REDIS_PASSWORD"),
		RedisDB:         redisDB,
		RealtimeNodeID:  strings.TrimSpace(readEnv("OZY_REALTIME_NODE_ID")),
		RealtimeChannel: getEnv("OZY_REALTIME_CHANNEL", "ozy_events_cluster"),

		// SMTP
		SMTPHost: readEnv("SMTP_HOST"),
		SMTPPort: getEnv("SMTP_PORT", "587"),
		SMTPUser: readEnv("SMTP_USER"),
		SMTPPass: readEnv("SMTP_PASSWORD"),
		SMTPFrom: readEnv("SMTP_FROM"),
	}

	if warnings, err := validateSecurity(cfg, debug, strictSecurity); err != nil {
		return nil, err
	} else {
		cfg.SecurityWarnings = warnings
	}
	if cfg.StorageMaintenanceIntervalMinutes < 0 {
		cfg.StorageMaintenanceIntervalMinutes = 0
	}
	if cfg.StorageMaintenanceIntervalMinutes > 1440 {
		cfg.StorageMaintenanceIntervalMinutes = 1440
	}

	return cfg, nil
}

func getOrGenerateSecret() string {
	secret, _ := getOrGenerateNamedSecret(".ozy_secret", 64, "")
	if secret == "" {
		return "emergency-static-secret-should-never-happen"
	}
	return secret
}

func getOrGenerateNamedSecret(secretFile string, numBytes int, prefix string) (string, bool) {
	if data, err := os.ReadFile(secretFile); err == nil {
		existing := strings.TrimSpace(string(data))
		if existing != "" {
			return existing, false
		}
	}

	b := make([]byte, numBytes)
	if _, err := rand.Read(b); err != nil {
		return "", false
	}
	secret := prefix + hex.EncodeToString(b)
	_ = os.WriteFile(secretFile, []byte(secret), 0600)
	return secret, true
}

func getEnv(key, defaultValue string) string {
	if value := readEnv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvAsInt(key string, defaultValue int) int {
	raw := strings.TrimSpace(readEnv(key))
	if raw == "" {
		return defaultValue
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return defaultValue
	}
	return v
}

func resolveDeploymentProfile(debug bool, dbURL string) string {
	raw := strings.ToLower(strings.TrimSpace(firstNonEmpty(readEnv("OZY_DEPLOYMENT_PROFILE"), readEnv("DEPLOYMENT_PROFILE"))))
	switch raw {
	case "self_host", "install_to_play", "azure_cloud", "custom":
		return raw
	case "azure", "azure-container-apps", "azure_container_apps":
		return "azure_cloud"
	case "coolify":
		return "install_to_play"
	}

	if strings.TrimSpace(os.Getenv("CONTAINER_APP_NAME")) != "" || strings.TrimSpace(os.Getenv("CONTAINER_APP_ENV_DNS_SUFFIX")) != "" {
		return "azure_cloud"
	}
	if debug || strings.TrimSpace(dbURL) == "" {
		return "self_host"
	}
	return "custom"
}

func readEnv(key string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return ""
	}
	if isCoolifySetPlaceholder(value, key) {
		return ""
	}
	return value
}

func isCoolifySetPlaceholder(value, key string) bool {
	v := strings.ToLower(strings.TrimSpace(value))
	k := strings.ToLower(strings.TrimSpace(key))

	candidates := []string{
		"set_" + k,
		"set " + k,
		"set-" + k,
		"set:" + k,
	}
	for _, c := range candidates {
		if v == c {
			return true
		}
	}
	return false
}

func parseOptionalRFC3339(raw string) time.Time {
	v := strings.TrimSpace(raw)
	if v == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return time.Time{}
	}
	return parsed
}

func resolveAllowedOrigins(originsStr, siteURL, appDomain string, debug bool) ([]string, bool) {
	if strings.TrimSpace(originsStr) != "" {
		parts := strings.Split(originsStr, ",")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			trimmed := strings.TrimSpace(p)
			if trimmed != "" {
				out = append(out, trimmed)
			}
		}
		return dedupeStrings(out), false
	}

	out := []string{}
	if isHTTPURL(siteURL) {
		out = append(out, strings.TrimRight(siteURL, "/"))
	}
	if appDomain != "" {
		domain := strings.TrimSpace(appDomain)
		if domain == "localhost" || strings.HasPrefix(domain, "localhost:") {
			out = append(out, "http://localhost:3000", "http://localhost:5173", "http://localhost:5342")
		} else {
			out = append(out, "https://"+domain, "https://app."+domain)
		}
	}
	if debug {
		out = append(out, "http://localhost:3000", "http://localhost:5173", "http://localhost:5342")
	}
	return dedupeStrings(out), true
}

func validateSecurity(cfg *Config, debug, strict bool) ([]string, error) {
	warnings := []string{}

	if cfg.DatabaseURL == "" && !debug {
		warnings = append(warnings, "DATABASE_URL is not configured; OzyBase will boot with embedded PostgreSQL, which is not recommended for cloud production")
	}

	if cfg.GeneratedJWTSecret && !debug {
		warnings = append(warnings, "JWT_SECRET was auto-generated on this instance; set it explicitly from a secret manager for cloud production")
	}
	if cfg.GeneratedAnonKey && !debug {
		warnings = append(warnings, "ANON_KEY was auto-generated on this instance; set it explicitly so public clients keep a stable publishable key")
	}
	if cfg.GeneratedServiceRoleKey && !debug {
		warnings = append(warnings, "SERVICE_ROLE_KEY was auto-generated on this instance; set it explicitly so server integrations keep a stable secret key")
	}

	if len(cfg.JWTSecret) < 32 {
		msg := "JWT_SECRET is shorter than recommended minimum (32 chars)"
		if strict && !debug {
			return nil, errors.New(msg)
		}
		warnings = append(warnings, msg)
	}
	if len(strings.TrimSpace(cfg.AnonKey)) < 40 {
		msg := "ANON_KEY is shorter than recommended minimum"
		if strict && !debug {
			return nil, errors.New(msg)
		}
		warnings = append(warnings, msg)
	}
	if len(strings.TrimSpace(cfg.ServiceRoleKey)) < 40 {
		msg := "SERVICE_ROLE_KEY is shorter than recommended minimum"
		if strict && !debug {
			return nil, errors.New(msg)
		}
		warnings = append(warnings, msg)
	}

	if cfg.DatabaseURL != "" {
		dbWarnings, dbErr := validateDatabaseURL(cfg.DatabaseURL, debug, strict)
		if dbErr != nil {
			return nil, dbErr
		}
		warnings = append(warnings, dbWarnings...)
	}
	if cfg.DatabaseURL != "" && !debug &&
		readEnv("DB_POOLER_URL") == "" &&
		readEnv("POOLER_URL") == "" &&
		readEnv("DB_POOLER_HOST") == "" {
		warnings = append(warnings, "DB_POOLER_URL is not configured; direct database connections are enabled, but a pooler is recommended for multi-instance production workloads")
	}

	if placeholderDomain(cfg.SiteURL) {
		msg := "SITE_URL uses a placeholder example.* domain"
		if strict && !debug {
			return nil, errors.New(msg)
		}
		warnings = append(warnings, msg)
	}
	if placeholderDomain(cfg.AppDomain) {
		msg := "APP_DOMAIN uses a placeholder example.* domain"
		if strict && !debug {
			return nil, errors.New(msg)
		}
		warnings = append(warnings, msg)
	}
	if siteURLUsesHTTP(cfg.SiteURL) && !debug {
		msg := "SITE_URL should use https in non-debug mode"
		if strict {
			return nil, errors.New(msg)
		}
		warnings = append(warnings, msg)
	}
	if strings.TrimSpace(cfg.SMTPHost) == "" && !debug {
		msg := "SMTP_HOST is not configured; verification, reset, and invite emails will use the console mailer"
		warnings = append(warnings, msg)
	}

	if !debug {
		for _, origin := range cfg.AllowedOrigins {
			if origin == "*" {
				msg := "ALLOWED_ORIGINS contains '*' in non-debug mode"
				if strict {
					return nil, errors.New(msg)
				}
				warnings = append(warnings, msg)
			}
		}
	}

	return warnings, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func validateDatabaseURL(databaseURL string, debug, strict bool) ([]string, error) {
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		msg := "DATABASE_URL is invalid"
		if strict && !debug {
			return nil, fmt.Errorf("%s: %w", msg, err)
		}
		return []string{msg}, nil
	}

	q := parsed.Query()
	sslmode := strings.ToLower(strings.TrimSpace(q.Get("sslmode")))
	if sslmode == "" {
		sslmode = "disable"
	}

	warnings := []string{}
	insecureSSL := sslmode == "disable" || sslmode == "allow" || sslmode == "prefer"
	if insecureSSL && !debug {
		msg := fmt.Sprintf("DATABASE_URL uses weak sslmode=%s in non-debug mode", sslmode)
		if strict {
			return nil, errors.New(msg)
		}
		warnings = append(warnings, msg)
	}

	host := parsed.Hostname()
	if host != "" && !isPrivateHost(host) && insecureSSL && !debug {
		msg := "DATABASE_URL points to a non-private host without strong TLS"
		if strict {
			return nil, errors.New(msg)
		}
		warnings = append(warnings, msg)
	}

	return warnings, nil
}

func isPrivateHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	if h == "localhost" || h == "db" || strings.HasSuffix(h, ".internal") {
		return true
	}
	ip := net.ParseIP(h)
	if ip == nil {
		return false
	}
	privateCIDRs := []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"}
	for _, cidr := range privateCIDRs {
		_, block, _ := net.ParseCIDR(cidr)
		if block.Contains(ip) {
			return true
		}
	}
	return false
}

func isHTTPURL(u string) bool {
	parsed, err := url.Parse(strings.TrimSpace(u))
	if err != nil {
		return false
	}
	return parsed.Scheme == "http" || parsed.Scheme == "https"
}

func placeholderDomain(raw string) bool {
	value := strings.TrimSpace(raw)
	if value == "" {
		return false
	}
	if strings.Contains(value, "://") {
		parsed, err := url.Parse(value)
		if err == nil {
			value = parsed.Hostname()
		}
	}
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.HasSuffix(value, "example.com") ||
		strings.HasSuffix(value, "example.org") ||
		strings.HasSuffix(value, "example.net")
}

func siteURLUsesHTTP(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	return strings.EqualFold(parsed.Scheme, "http")
}

func dedupeStrings(items []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(items))
	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}
