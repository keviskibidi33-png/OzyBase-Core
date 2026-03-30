package api

import (
	"os"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/config"
)

type ProjectProductionReadiness struct {
	Status             string   `json:"status"`
	LaunchReady        bool     `json:"launch_ready"`
	DeploymentMode     string   `json:"deployment_mode"`
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
		DeploymentMode:     "embedded_postgres",
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

	if strings.TrimSpace(cfg.DatabaseURL) != "" {
		readiness.DeploymentMode = "external_postgres"
	}
	readiness.ManagedSecrets = !cfg.GeneratedJWTSecret && !cfg.GeneratedAnonKey && !cfg.GeneratedServiceRoleKey
	readiness.HTTPSSiteURL = strings.HasPrefix(strings.ToLower(strings.TrimSpace(cfg.SiteURL)), "https://")
	readiness.PlaceholderDomains = hasPlaceholderDomain(cfg.SiteURL) || hasPlaceholderDomain(cfg.AppDomain)
	readiness.SMTPConfigured = strings.TrimSpace(cfg.SMTPHost) != ""
	readiness.PoolerConfigured = hasPoolerConfigured()
	readiness.Warnings = append(readiness.Warnings, cfg.SecurityWarnings...)

	if readiness.DeploymentMode != "external_postgres" ||
		!readiness.StrictSecurity ||
		!readiness.ManagedSecrets ||
		!readiness.HTTPSSiteURL ||
		readiness.PlaceholderDomains ||
		!readiness.SMTPConfigured ||
		!readiness.PoolerConfigured {
		readiness.Status = "action_required"
		readiness.LaunchReady = false
	}

	return readiness
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
