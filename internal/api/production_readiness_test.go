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
	if got.MVPReady {
		t.Fatalf("expected mvp_ready=false")
	}
	if got.SaaSReady {
		t.Fatalf("expected saas_ready=false")
	}
	if got.DeploymentMode != "embedded_postgres" {
		t.Fatalf("expected embedded_postgres deployment, got %q", got.DeploymentMode)
	}
	if got.Profile != "self_host" {
		t.Fatalf("expected self_host profile, got %q", got.Profile)
	}
	if got.ManagedSecrets {
		t.Fatalf("expected managed_secrets=false when keys were auto-generated")
	}
}

func TestBuildProjectProductionReadinessMarksReadyWhenRequirementsAreMet(t *testing.T) {
	t.Setenv("DB_POOLER_URL", "postgres://pooler:secret@pool.internal:6543/ozybase?sslmode=require")
	cfg := &config.Config{
		DatabaseURL:             "postgres://user:pass@db.internal:5432/ozybase?sslmode=require",
		DeploymentProfile:       "azure_cloud",
		SiteURL:                 "https://api.ozybase.com",
		AppDomain:               "ozybase.com",
		StrictSecurity:          true,
		SMTPHost:                "smtp.example.net",
		StorageProvider:         "s3",
		RealtimeBroker:          "redis",
		GeneratedJWTSecret:      false,
		GeneratedAnonKey:        false,
		GeneratedServiceRoleKey: false,
		SecurityWarnings:        []string{poolerRecommendationWarning},
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
	if got.Profile != "azure_cloud" {
		t.Fatalf("expected azure_cloud profile, got %q", got.Profile)
	}
	if !got.PoolerConfigured {
		t.Fatalf("expected pooler_configured=true")
	}
	if !got.MVPReady {
		t.Fatalf("expected mvp_ready=true")
	}
	if !got.SaaSReady {
		t.Fatalf("expected saas_ready=true")
	}
}

func TestBuildProjectProductionReadinessAllowsInstallToPlayWithoutPooler(t *testing.T) {
	t.Setenv("DB_POOLER_URL", "")
	cfg := &config.Config{
		DatabaseURL:             "postgres://user:pass@db.internal:5432/ozybase?sslmode=require",
		DeploymentProfile:       "install_to_play",
		SiteURL:                 "https://api.ozybase.com",
		AppDomain:               "ozybase.com",
		StrictSecurity:          true,
		SMTPHost:                "smtp.example.net",
		StorageProvider:         "local",
		RealtimeBroker:          "local",
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
	if !got.MVPReady {
		t.Fatalf("expected mvp_ready=true")
	}
	if got.SaaSReady {
		t.Fatalf("expected saas_ready=false without pooler/distributed runtimes")
	}
	if got.PoolerConfigured {
		t.Fatalf("expected pooler_configured=false without DB_POOLER_URL")
	}
	if len(got.Warnings) != 0 {
		t.Fatalf("expected pooler warning to be filtered for install_to_play, got %v", got.Warnings)
	}
}

func TestBuildProjectProductionReadinessSeparatesSingleNodeFromMVP(t *testing.T) {
	t.Setenv("DB_POOLER_URL", "")
	cfg := &config.Config{
		DatabaseURL:             "",
		DeploymentProfile:       "self_host",
		SiteURL:                 "https://ozybase.local",
		AppDomain:               "ozybase.local",
		StrictSecurity:          true,
		SMTPHost:                "",
		StorageProvider:         "local",
		RealtimeBroker:          "local",
		GeneratedJWTSecret:      false,
		GeneratedAnonKey:        false,
		GeneratedServiceRoleKey: false,
		SecurityWarnings:        []string{"DATABASE_URL is not configured; OzyBase will boot with embedded PostgreSQL, which is not recommended for cloud production"},
	}

	got := BuildProjectProductionReadiness(cfg)
	if got.Status != "ready" {
		t.Fatalf("expected ready status for secure single-node launch, got %q", got.Status)
	}
	if !got.LaunchReady {
		t.Fatalf("expected launch_ready=true for secure single-node launch")
	}
	if got.MVPReady {
		t.Fatalf("expected mvp_ready=false without external postgres and SMTP")
	}
	if got.SaaSReady {
		t.Fatalf("expected saas_ready=false for single-node launch")
	}
}
