package api

import (
	"testing"

	"github.com/Xangel0s/OzyBase/internal/config"
)

func TestBuildProjectProductionReadinessFlagsActionRequired(t *testing.T) {
	t.Setenv("DB_POOLER_URL", "")
	cfg := &config.Config{
		DatabaseURL:             "",
		SiteURL:                 "https://api.example.com",
		AppDomain:               "example.com",
		StrictSecurity:          false,
		SMTPHost:                "",
		GeneratedJWTSecret:      true,
		GeneratedAnonKey:        true,
		GeneratedServiceRoleKey: true,
		SecurityWarnings:        []string{"warn"},
	}

	got := BuildProjectProductionReadiness(cfg)
	if got.Status != "action_required" {
		t.Fatalf("expected action_required status, got %q", got.Status)
	}
	if got.LaunchReady {
		t.Fatalf("expected launch_ready=false")
	}
	if got.DeploymentMode != "embedded_postgres" {
		t.Fatalf("expected embedded_postgres deployment, got %q", got.DeploymentMode)
	}
	if got.ManagedSecrets {
		t.Fatalf("expected managed_secrets=false when keys were auto-generated")
	}
}

func TestBuildProjectProductionReadinessMarksReadyWhenRequirementsAreMet(t *testing.T) {
	t.Setenv("DB_POOLER_URL", "postgres://pooler:secret@pool.internal:6543/ozybase?sslmode=require")
	cfg := &config.Config{
		DatabaseURL:             "postgres://user:pass@db.internal:5432/ozybase?sslmode=require",
		SiteURL:                 "https://api.ozybase.com",
		AppDomain:               "ozybase.com",
		StrictSecurity:          true,
		SMTPHost:                "smtp.example.net",
		GeneratedJWTSecret:      false,
		GeneratedAnonKey:        false,
		GeneratedServiceRoleKey: false,
		SecurityWarnings:        nil,
	}

	got := BuildProjectProductionReadiness(cfg)
	if got.Status != "ready" {
		t.Fatalf("expected ready status, got %q", got.Status)
	}
	if !got.LaunchReady {
		t.Fatalf("expected launch_ready=true")
	}
	if got.DeploymentMode != "external_postgres" {
		t.Fatalf("expected external_postgres deployment, got %q", got.DeploymentMode)
	}
	if !got.PoolerConfigured {
		t.Fatalf("expected pooler_configured=true")
	}
}
