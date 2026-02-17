package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
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
}

func Load() (*Config, error) {
	_ = godotenv.Load()

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
	if jwtSecret == "" {
		jwtSecret = getOrGenerateSecret()
	}

	siteURL := getEnv("SITE_URL", "http://localhost:8090")
	appDomain := getEnv("APP_DOMAIN", "localhost")

	originsStr := getEnv("ALLOWED_ORIGINS", "")
	var origins []string
	if originsStr == "" {
		// Default to SiteURL + AppDomain variations if not specified
		origins = []string{"http://localhost:5342", "http://localhost:3000", siteURL}
	} else {
		origins = strings.Split(originsStr, ",")
	}

	rps, _ := strconv.ParseFloat(getEnv("RATE_LIMIT_RPS", "20"), 64)
	burst, _ := strconv.Atoi(getEnv("RATE_LIMIT_BURST", "20"))

	redisDB, _ := strconv.Atoi(getEnv("REDIS_DB", "0"))

	cfg := &Config{
		DatabaseURL:    dbURL,
		Port:           getEnv("PORT", "8090"),
		JWTSecret:      jwtSecret,
		AppDomain:      appDomain,
		SiteURL:        siteURL,
		AllowedOrigins: origins,
		RateLimitRPS:   rps,
		RateLimitBurst: burst,
		BodyLimit:      getEnv("BODY_LIMIT", "10M"),

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
