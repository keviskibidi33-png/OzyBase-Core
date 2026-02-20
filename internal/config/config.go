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

	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL string
	Port        string
	JWTSecret   string

	// Security & Domains
	AppDomain      string
	SiteURL        string
	RateLimitRPS   float64
	RateLimitBurst int
	BodyLimit      string
	AllowedOrigins []string

	// Storage
	StorageProvider string
	StoragePath     string
	S3Endpoint      string
	S3AccessKey     string
	S3SecretKey     string
	S3UseSSL        bool

	// Realtime
	RealtimeBroker string
	RedisAddr      string
	RedisPassword  string
	RedisDB        int

	// SMTP
	SMTPHost string
	SMTPPort string
	SMTPUser string
	SMTPPass string
	SMTPFrom string

	// Bootstrap metadata
	GeneratedJWTSecret   bool
	DerivedAllowedOrigin bool
	SecurityWarnings     []string
}

func Load() (*Config, error) {
	_ = godotenv.Load()
	debug := strings.EqualFold(getEnv("DEBUG", "false"), "true")
	strictSecurity := strings.EqualFold(getEnv("OZY_STRICT_SECURITY", "false"), "true")

	// Validate required PostgreSQL variables
	required := []string{"DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"}
	allSet := true
	for _, env := range required {
		if os.Getenv(env) == "" {
			allSet = false
			break
		}
	}

	var dbURL string
	if allSet {
		dbURL = fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
			os.Getenv("DB_USER"),
			os.Getenv("DB_PASSWORD"),
			os.Getenv("DB_HOST"),
			os.Getenv("DB_PORT"),
			os.Getenv("DB_NAME"),
			getEnv("DB_SSLMODE", "disable"),
		)
	} else {
		dbURL = os.Getenv("DATABASE_URL")
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	generatedJWTSecret := false
	if jwtSecret == "" {
		jwtSecret = getOrGenerateSecret()
		generatedJWTSecret = true
	}

	siteURL := getEnv("SITE_URL", "http://localhost:8090")
	appDomain := getEnv("APP_DOMAIN", "localhost")

	origins, derivedAllowedOrigin := resolveAllowedOrigins(getEnv("ALLOWED_ORIGINS", ""), siteURL, appDomain, debug)

	rps, _ := strconv.ParseFloat(getEnv("RATE_LIMIT_RPS", "20"), 64)
	burst, _ := strconv.Atoi(getEnv("RATE_LIMIT_BURST", "20"))

	redisDB, _ := strconv.Atoi(getEnv("REDIS_DB", "0"))

	cfg := &Config{
		DatabaseURL:          dbURL,
		Port:                 getEnv("PORT", "8090"),
		JWTSecret:            jwtSecret,
		AppDomain:            appDomain,
		SiteURL:              siteURL,
		AllowedOrigins:       origins,
		RateLimitRPS:         rps,
		RateLimitBurst:       burst,
		BodyLimit:            getEnv("BODY_LIMIT", "10M"),
		GeneratedJWTSecret:   generatedJWTSecret,
		DerivedAllowedOrigin: derivedAllowedOrigin,
		SecurityWarnings:     nil,

		// Storage
		StorageProvider: getEnv("OZY_STORAGE_PROVIDER", "local"),
		StoragePath:     getEnv("OZY_STORAGE_PATH", "./data/storage"),
		S3Endpoint:      os.Getenv("S3_ENDPOINT"),
		S3AccessKey:     os.Getenv("S3_ACCESS_KEY"),
		S3SecretKey:     os.Getenv("S3_SECRET_KEY"),
		S3UseSSL:        getEnv("S3_USE_SSL", "false") == "true",

		// Realtime
		RealtimeBroker: getEnv("OZY_REALTIME_BROKER", "local"),
		RedisAddr:      os.Getenv("REDIS_ADDR"),
		RedisPassword:  os.Getenv("REDIS_PASSWORD"),
		RedisDB:        redisDB,

		// SMTP
		SMTPHost: os.Getenv("SMTP_HOST"),
		SMTPPort: getEnv("SMTP_PORT", "587"),
		SMTPUser: os.Getenv("SMTP_USER"),
		SMTPPass: os.Getenv("SMTP_PASSWORD"),
		SMTPFrom: os.Getenv("SMTP_FROM"),
	}

	if warnings, err := validateSecurity(cfg, debug, strictSecurity); err != nil {
		return nil, err
	} else {
		cfg.SecurityWarnings = warnings
	}

	return cfg, nil
}

func getOrGenerateSecret() string {
	const secretFile = ".ozy_secret"
	if data, err := os.ReadFile(secretFile); err == nil {
		return string(data)
	}

	b := make([]byte, 64)
	if _, err := rand.Read(b); err != nil {
		return "emergency-static-secret-should-never-happen"
	}
	secret := hex.EncodeToString(b)
	_ = os.WriteFile(secretFile, []byte(secret), 0600)
	return secret
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
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

	if len(cfg.JWTSecret) < 32 {
		msg := "JWT_SECRET is shorter than recommended minimum (32 chars)"
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
