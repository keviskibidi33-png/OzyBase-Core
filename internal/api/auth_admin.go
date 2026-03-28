package api

import (
	"net/http"
	"os"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/labstack/echo/v4"
)

type AuthProviderInfo struct {
	Name        string `json:"name"`
	Enabled     bool   `json:"enabled"`
	Configured  bool   `json:"configured"`
	CallbackURL string `json:"callback_url"`
	LoginURL    string `json:"login_url"`
}

type AuthConfigResponse struct {
	SMTPConfigured           bool `json:"smtp_configured"`
	OAuthEnabled             bool `json:"oauth_enabled"`
	EmailVerificationEnabled bool `json:"email_verification_enabled"`
	MFASupported             bool `json:"mfa_supported"`
}

type EmailTemplateResponse struct {
	Type        string `json:"type"`
	Subject     string `json:"subject"`
	Body        string `json:"body"`
	Description string `json:"description"`
}

var supportedTemplateTypes = map[string]bool{
	"verification":     true,
	"password_reset":   true,
	"workspace_invite": true,
	"security_alert":   true,
}

func (h *Handler) ListAuthProviders(c echo.Context) error {
	providers := []struct {
		name         string
		clientIDEnv  string
		clientKeyEnv string
	}{
		{name: "google", clientIDEnv: "GOOGLE_CLIENT_ID", clientKeyEnv: "GOOGLE_CLIENT_SECRET"},
		{name: "github", clientIDEnv: "GITHUB_CLIENT_ID", clientKeyEnv: "GITHUB_CLIENT_SECRET"},
	}

	response := make([]AuthProviderInfo, 0, len(providers))
	for _, provider := range providers {
		configured := os.Getenv(provider.clientIDEnv) != "" && os.Getenv(provider.clientKeyEnv) != ""
		response = append(response, AuthProviderInfo{
			Name:        provider.name,
			Enabled:     configured,
			Configured:  configured,
			CallbackURL: core.OAuthCallbackURL(provider.name),
			LoginURL:    "/api/auth/login/" + provider.name,
		})
	}

	return c.JSON(http.StatusOK, response)
}

func (h *Handler) GetAuthConfig(c echo.Context) error {
	smtpConfigured := strings.TrimSpace(os.Getenv("SMTP_HOST")) != ""
	oauthEnabled := false
	for _, envName := range []string{"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"} {
		if os.Getenv(envName) != "" {
			oauthEnabled = true
			break
		}
	}

	return c.JSON(http.StatusOK, AuthConfigResponse{
		SMTPConfigured:           smtpConfigured,
		OAuthEnabled:             oauthEnabled,
		EmailVerificationEnabled: true,
		MFASupported:             true,
	})
}

func (h *Handler) ListAuthTemplates(c echo.Context) error {
	rows, err := h.DB.Pool.Query(c.Request().Context(), `
		SELECT template_type, subject, body, description
		FROM _v_email_templates
		ORDER BY template_type ASC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	templates := make([]EmailTemplateResponse, 0)
	for rows.Next() {
		var item EmailTemplateResponse
		if err := rows.Scan(&item.Type, &item.Subject, &item.Body, &item.Description); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		templates = append(templates, item)
	}

	return c.JSON(http.StatusOK, templates)
}

func (h *Handler) UpdateAuthTemplate(c echo.Context) error {
	templateType := c.Param("type")
	if !supportedTemplateTypes[templateType] {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "unsupported template type"})
	}

	var req struct {
		Subject     string `json:"subject"`
		Body        string `json:"body"`
		Description string `json:"description"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	if strings.TrimSpace(req.Subject) == "" || strings.TrimSpace(req.Body) == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "subject and body are required"})
	}

	_, err := h.DB.Pool.Exec(c.Request().Context(), `
		INSERT INTO _v_email_templates (template_type, subject, body, description, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (template_type) DO UPDATE
		SET subject = EXCLUDED.subject,
			body = EXCLUDED.body,
			description = EXCLUDED.description,
			updated_at = NOW()
	`, templateType, req.Subject, req.Body, req.Description)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "updated"})
}
