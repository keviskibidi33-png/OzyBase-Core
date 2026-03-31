package api

import (
	"os"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/config"
)

const poolerRecommendationWarning = "DB_POOLER_URL is not configured; direct database connections are enabled, but a pooler is recommended for multi-instance production workloads"

type ProjectProductionReadiness struct {
	Status             string   `json:"status"`
	LaunchReady        bool     `json:"launch_ready"`
	MVPReady           bool     `json:"mvp_ready"`
	SaaSReady          bool     `json:"saas_ready"`
	Profile            string   `json:"profile"`
	DeploymentMode     string   `json:"deployment_mode"`
	StorageRuntime     string   `json:"storage_runtime"`
	RealtimeRuntime    string   `json:"realtime_runtime"`
	StrictSecurity     bool     `json:"strict_security"`
	ManagedSecrets     bool     `json:"managed_secrets"`
	HTTPSSiteURL       bool     `json:"https_site_url"`
	PlaceholderDomains bool     `json:"placeholder_domains"`
	SMTPConfigured     bool     `json:"smtp_configured"`
	PoolerConfigured   bool     `json:"pooler_configured"`
	Warnings           []string `json:"warnings"`
}

func BuildProjectProductionReadiness(cfg *config.Config) ProjectProductionReadiness {
	readiness := ProjectProductionReadiness{
		Status:             "ready",
		LaunchReady:        true,
		MVPReady:           false,
		SaaSReady:          false,
		Profile:            "self_host",
		DeploymentMode:     "embedded_postgres",
		StorageRuntime:     "local",
		RealtimeRuntime:    "local",
		StrictSecurity:     cfg != nil && cfg.StrictSecurity,
		ManagedSecrets:     true,
		HTTPSSiteURL:       false,
		PlaceholderDomains: false,
		SMTPConfigured:     false,
		PoolerConfigured:   false,
		Warnings:           []string{},
	}
	if cfg == nil {
		readiness.Status = "action_required"
		readiness.LaunchReady = false
		readiness.Warnings = append(readiness.Warnings, "Runtime configuration is unavailable; production readiness could not be evaluated")
		return readiness
	}
	readiness.Profile = normalizeReadinessProfile(cfg.DeploymentProfile)
	readiness.StorageRuntime = normalizeRuntimeValue(cfg.StorageProvider, "local")
	readiness.RealtimeRuntime = normalizeRuntimeValue(cfg.RealtimeBroker, "local")

	if strings.TrimSpace(cfg.DatabaseURL) != "" {
		readiness.DeploymentMode = "external_postgres"
	}
	readiness.ManagedSecrets = !cfg.GeneratedJWTSecret && !cfg.GeneratedAnonKey && !cfg.GeneratedServiceRoleKey
	readiness.HTTPSSiteURL = strings.HasPrefix(strings.ToLower(strings.TrimSpace(cfg.SiteURL)), "https://")
	readiness.PlaceholderDomains = hasPlaceholderDomain(cfg.SiteURL) || hasPlaceholderDomain(cfg.AppDomain)
	readiness.SMTPConfigured = strings.TrimSpace(cfg.SMTPHost) != ""
	readiness.PoolerConfigured = hasPoolerConfigured()
	poolerRequired := readiness.Profile == "azure_cloud" || readiness.Profile == "custom"
	for _, warning := range cfg.SecurityWarnings {
		if !poolerRequired && warning == poolerRecommendationWarning {
			continue
		}
		readiness.Warnings = append(readiness.Warnings, warning)
	}
	if (readiness.Profile == "azure_cloud" || readiness.Profile == "custom") && readiness.StorageRuntime == "local" {
		readiness.Warnings = append(readiness.Warnings, "OZY_STORAGE_PROVIDER=local keeps files on a single node; use S3-compatible storage for resilient SaaS workloads")
	}
	if (readiness.Profile == "azure_cloud" || readiness.Profile == "custom") && readiness.RealtimeRuntime == "local" {
		readiness.Warnings = append(readiness.Warnings, "OZY_REALTIME_BROKER=local keeps realtime fan-out on one node; use Redis for multi-instance workloads")
	}

	readiness.LaunchReady =
		readiness.StrictSecurity &&
			readiness.ManagedSecrets &&
			readiness.HTTPSSiteURL &&
			!readiness.PlaceholderDomains

	readiness.MVPReady =
		readiness.LaunchReady &&
			readiness.DeploymentMode == "external_postgres" &&
			readiness.SMTPConfigured

	readiness.SaaSReady =
		readiness.MVPReady &&
			readiness.PoolerConfigured &&
			readiness.StorageRuntime != "local" &&
			readiness.RealtimeRuntime != "local"

	if !readiness.LaunchReady || (poolerRequired && !readiness.MVPReady) {
		readiness.Status = "action_required"
	}

	return readiness
}

func normalizeReadinessProfile(profile string) string {
	switch strings.ToLower(strings.TrimSpace(profile)) {
	case "self_host", "install_to_play", "azure_cloud", "custom":
		return strings.ToLower(strings.TrimSpace(profile))
	default:
		return "self_host"
	}
}

func normalizeRuntimeValue(value, fallback string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return fallback
	}
	return normalized
}

func hasPlaceholderDomain(raw string) bool {
	value := strings.ToLower(strings.TrimSpace(raw))
	if value == "" {
		return false
	}
	return strings.Contains(value, "example.com") ||
		strings.Contains(value, "example.org") ||
		strings.Contains(value, "example.net")
}

func hasPoolerConfigured() bool {
	for _, key := range []string{
		"DB_POOLER_URL",
		"POOLER_URL",
		"DB_POOLER_HOST",
	} {
		if strings.TrimSpace(os.Getenv(key)) != "" {
			return true
		}
	}
	return false
}
