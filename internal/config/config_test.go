package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad_GeneratesJWTSecretAndDerivesOrigins(t *testing.T) {
	withTempDir(t)
	resetEnv(t)

	t.Setenv("SITE_URL", "https://api.example.com")
	t.Setenv("APP_DOMAIN", "example.com")
	t.Setenv("DEBUG", "false")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if !cfg.GeneratedJWTSecret {
		t.Fatalf("expected GeneratedJWTSecret=true")
	}
	if !cfg.GeneratedAnonKey {
		t.Fatalf("expected GeneratedAnonKey=true")
	}
	if !cfg.GeneratedServiceRoleKey {
		t.Fatalf("expected GeneratedServiceRoleKey=true")
	}
	if !cfg.DerivedAllowedOrigin {
		t.Fatalf("expected DerivedAllowedOrigin=true")
	}
	if len(cfg.JWTSecret) < 32 {
		t.Fatalf("expected generated JWT secret length >= 32, got %d", len(cfg.JWTSecret))
	}
	if len(cfg.AnonKey) < 40 {
		t.Fatalf("expected generated ANON_KEY length >= 40, got %d", len(cfg.AnonKey))
	}
	if len(cfg.ServiceRoleKey) < 40 {
		t.Fatalf("expected generated SERVICE_ROLE_KEY length >= 40, got %d", len(cfg.ServiceRoleKey))
	}
	if len(cfg.AllowedOrigins) == 0 {
		t.Fatalf("expected non-empty allowed origins")
	}
	if cfg.DeploymentProfile != "self_host" {
		t.Fatalf("expected self_host deployment profile by default, got %q", cfg.DeploymentProfile)
	}
}

func TestLoad_UsesExplicitDeploymentProfile(t *testing.T) {
	withTempDir(t)
	resetEnv(t)

	t.Setenv("DEBUG", "false")
	t.Setenv("DATABASE_URL", "postgres://user:pass@db.internal:5432/db?sslmode=require")
	t.Setenv("JWT_SECRET", "this_is_a_strong_secret_with_more_than_32_chars")
	t.Setenv("SITE_URL", "https://api.real-domain.test")
	t.Setenv("APP_DOMAIN", "real-domain.test")
	t.Setenv("OZY_DEPLOYMENT_PROFILE", "azure_cloud")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.DeploymentProfile != "azure_cloud" {
		t.Fatalf("expected explicit deployment profile, got %q", cfg.DeploymentProfile)
	}
}

func TestLoad_StrictSecurityRejectsInsecurePublicDatabaseURL(t *testing.T) {
	withTempDir(t)
	resetEnv(t)

	t.Setenv("OZY_STRICT_SECURITY", "true")
	t.Setenv("DEBUG", "false")
	t.Setenv("JWT_SECRET", "this_is_a_strong_secret_with_more_than_32_chars")
	t.Setenv("DATABASE_URL", "postgres://user:pass@8.8.8.8:5432/db?sslmode=disable")

	_, err := Load()
	if err == nil {
		t.Fatalf("expected Load() to fail in strict security mode")
	}
}

func TestLoad_StrictSecurityRejectsPlaceholderDomains(t *testing.T) {
	withTempDir(t)
	resetEnv(t)

	t.Setenv("OZY_STRICT_SECURITY", "true")
	t.Setenv("DEBUG", "false")
	t.Setenv("JWT_SECRET", "this_is_a_strong_secret_with_more_than_32_chars")
	t.Setenv("SITE_URL", "https://api.example.com")
	t.Setenv("APP_DOMAIN", "example.com")
	t.Setenv("DATABASE_URL", "postgres://user:pass@db.internal:5432/db?sslmode=require")

	_, err := Load()
	if err == nil {
		t.Fatalf("expected Load() to reject placeholder domains in strict mode")
	}
}

func TestLoad_WarnsWhenSMTPIsMissingInNonDebug(t *testing.T) {
	withTempDir(t)
	resetEnv(t)

	t.Setenv("DEBUG", "false")
	t.Setenv("JWT_SECRET", "this_is_a_strong_secret_with_more_than_32_chars")
	t.Setenv("SITE_URL", "https://api.real-domain.test")
	t.Setenv("APP_DOMAIN", "real-domain.test")
	t.Setenv("DATABASE_URL", "postgres://user:pass@db.internal:5432/db?sslmode=require")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	found := false
	for _, warning := range cfg.SecurityWarnings {
		if warning == "SMTP_HOST is not configured; verification, reset, and invite emails will use the console mailer" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected SMTP warning when SMTP_HOST is missing")
	}
}

func TestLoad_WarnsWhenDatabaseURLIsMissingInNonDebug(t *testing.T) {
	withTempDir(t)
	resetEnv(t)

	t.Setenv("DEBUG", "false")
	t.Setenv("JWT_SECRET", "this_is_a_strong_secret_with_more_than_32_chars")
	t.Setenv("SITE_URL", "https://api.real-domain.test")
	t.Setenv("APP_DOMAIN", "real-domain.test")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	found := false
	for _, warning := range cfg.SecurityWarnings {
		if warning == "DATABASE_URL is not configured; OzyBase will boot with embedded PostgreSQL, which is not recommended for cloud production" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected embedded database warning when DATABASE_URL is missing")
	}
}

func TestLoad_WarnsWhenPoolerIsMissingForExternalDatabase(t *testing.T) {
	withTempDir(t)
	resetEnv(t)

	t.Setenv("DEBUG", "false")
	t.Setenv("JWT_SECRET", "this_is_a_strong_secret_with_more_than_32_chars")
	t.Setenv("SITE_URL", "https://api.real-domain.test")
	t.Setenv("APP_DOMAIN", "real-domain.test")
	t.Setenv("DATABASE_URL", "postgres://user:pass@db.internal:5432/db?sslmode=require")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	found := false
	for _, warning := range cfg.SecurityWarnings {
		if warning == "DB_POOLER_URL is not configured; direct database connections are enabled, but a pooler is recommended for multi-instance production workloads" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected pooler warning for external database without DB_POOLER_URL")
	}
}

func TestLoad_WarnsWhenSecretsAreGeneratedInNonDebug(t *testing.T) {
	withTempDir(t)
	resetEnv(t)

	t.Setenv("DEBUG", "false")
	t.Setenv("SITE_URL", "https://api.real-domain.test")
	t.Setenv("APP_DOMAIN", "real-domain.test")
	t.Setenv("DATABASE_URL", "postgres://user:pass@db.internal:5432/db?sslmode=require")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	expected := map[string]bool{
		"JWT_SECRET was auto-generated on this instance; set it explicitly from a secret manager for cloud production":            false,
		"ANON_KEY was auto-generated on this instance; set it explicitly so public clients keep a stable publishable key":         false,
		"SERVICE_ROLE_KEY was auto-generated on this instance; set it explicitly so server integrations keep a stable secret key": false,
	}
	for _, warning := range cfg.SecurityWarnings {
		if _, ok := expected[warning]; ok {
			expected[warning] = true
		}
	}
	for message, found := range expected {
		if !found {
			t.Fatalf("expected generated-secret warning %q", message)
		}
	}
}

func TestLoad_NonStrictWarnsOnInsecurePublicDatabaseURL(t *testing.T) {
	withTempDir(t)
	resetEnv(t)

	t.Setenv("OZY_STRICT_SECURITY", "false")
	t.Setenv("DEBUG", "false")
	t.Setenv("JWT_SECRET", "this_is_a_strong_secret_with_more_than_32_chars")
	t.Setenv("DATABASE_URL", "postgres://user:pass@8.8.8.8:5432/db?sslmode=disable")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if len(cfg.SecurityWarnings) == 0 {
		t.Fatalf("expected security warnings for insecure public DATABASE_URL")
	}
}

func TestLoad_UsesProvidedAllowedOrigins(t *testing.T) {
	withTempDir(t)
	resetEnv(t)

	t.Setenv("JWT_SECRET", "this_is_a_strong_secret_with_more_than_32_chars")
	t.Setenv("ALLOWED_ORIGINS", " https://app.example.com , https://admin.example.com ")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.DerivedAllowedOrigin {
		t.Fatalf("expected DerivedAllowedOrigin=false when ALLOWED_ORIGINS is explicitly set")
	}
	if len(cfg.AllowedOrigins) != 2 {
		t.Fatalf("expected 2 origins, got %d", len(cfg.AllowedOrigins))
	}
	if cfg.AllowedOrigins[0] != "https://app.example.com" {
		t.Fatalf("unexpected origin[0]: %q", cfg.AllowedOrigins[0])
	}
	if cfg.AllowedOrigins[1] != "https://admin.example.com" {
		t.Fatalf("unexpected origin[1]: %q", cfg.AllowedOrigins[1])
	}
}

func TestLoad_SkipsDotenvWhenRequested(t *testing.T) {
	withTempDir(t)
	resetEnv(t)

	if err := os.WriteFile(".env", []byte("DATABASE_URL=postgres://dotenv-user:dotenv-pass@dotenv-host:5432/dotenv-db?sslmode=require\n"), 0o644); err != nil {
		t.Fatalf("failed to write temp .env: %v", err)
	}
	t.Setenv("OZY_SKIP_DOTENV", "true")
	t.Setenv("JWT_SECRET", "this_is_a_strong_secret_with_more_than_32_chars")
	t.Setenv("SITE_URL", "https://api.real-domain.test")
	t.Setenv("APP_DOMAIN", "real-domain.test")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.DatabaseURL != "" {
		t.Fatalf("expected DatabaseURL to stay empty when dotenv loading is skipped, got %q", cfg.DatabaseURL)
	}
}

func withTempDir(t *testing.T) {
	t.Helper()
	tmp := t.TempDir()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("os.Getwd() failed: %v", err)
	}
	if err := os.Chdir(tmp); err != nil {
		t.Fatalf("os.Chdir(%s) failed: %v", tmp, err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(wd)
	})
}

func resetEnv(t *testing.T) {
	t.Helper()
	keys := []string{
		"DATABASE_URL", "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME", "DB_SSLMODE",
		"DB_POOLER_URL", "POOLER_URL", "DB_POOLER_HOST", "DB_POOLER_PORT", "DB_POOLER_USER", "DB_POOLER_DATABASE", "DB_POOLER_SSLMODE",
		"JWT_SECRET", "ANON_KEY", "SERVICE_ROLE_KEY", "OZY_SERVICE_ROLE_KEY",
		"SITE_URL", "APP_DOMAIN", "ALLOWED_ORIGINS", "DEBUG", "OZY_STRICT_SECURITY", "SMTP_HOST", "OZY_DEPLOYMENT_PROFILE", "DEPLOYMENT_PROFILE",
	}
	for _, k := range keys {
		t.Setenv(k, "")
	}
	// Ensure test does not inherit persisted local secret.
	_ = os.Remove(filepath.Join(".", ".ozy_secret"))
	_ = os.Remove(filepath.Join(".", ".ozy_anon_key"))
	_ = os.Remove(filepath.Join(".", ".ozy_service_role_key"))
}
