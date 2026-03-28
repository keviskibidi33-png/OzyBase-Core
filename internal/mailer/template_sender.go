package mailer

import (
	"context"
	"fmt"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/data"
)

type templateDefinition struct {
	Subject string
	Body    string
}

var defaultTemplateDefinitions = map[string]templateDefinition{
	"verification": {
		Subject: "Verify your {{app_name}} account",
		Body:    "Click here to verify your account: {{action_link}}\n\nToken: {{token}}\n\nThanks,\n{{app_name}}",
	},
	"password_reset": {
		Subject: "Reset your {{app_name}} password",
		Body:    "Click here to reset your password: {{action_link}}\n\nToken: {{token}}\n\nIf you did not request this, you can ignore this email.\n\n{{app_name}}",
	},
	"workspace_invite": {
		Subject: "Invitation to join {{workspace_name}} on {{app_name}}",
		Body:    "{{inviter_email}} invited you to collaborate on {{workspace_name}}.\n\nSign in to {{app_name}} to get started.",
	},
	"security_alert": {
		Subject: "Security alert on {{app_name}}: {{alert_type}}",
		Body:    "A security event was detected.\n\nType: {{alert_type}}\nDetails: {{details}}\n\nPlease review your dashboard immediately.",
	},
}

func SendTemplateEmail(ctx context.Context, db *data.DB, sender Mailer, templateType, to string, variables map[string]string) error {
	definition, err := loadTemplateDefinition(ctx, db, templateType)
	if err != nil {
		return err
	}

	subject := renderTemplateString(definition.Subject, variables)
	body := renderTemplateString(definition.Body, variables)
	return sender.Send(to, subject, body)
}

func loadTemplateDefinition(ctx context.Context, db *data.DB, templateType string) (templateDefinition, error) {
	fallback, ok := defaultTemplateDefinitions[templateType]
	if !ok {
		return templateDefinition{}, fmt.Errorf("unknown email template %q", templateType)
	}

	if db == nil {
		return fallback, nil
	}

	var subject string
	var body string
	err := db.Pool.QueryRow(ctx, `
		SELECT subject, body
		FROM _v_email_templates
		WHERE template_type = $1
	`, templateType).Scan(&subject, &body)
	if err != nil {
		return fallback, nil
	}

	return templateDefinition{
		Subject: subject,
		Body:    body,
	}, nil
}

func renderTemplateString(template string, variables map[string]string) string {
	if len(variables) == 0 {
		return template
	}

	rendered := template
	for key, value := range variables {
		rendered = strings.ReplaceAll(rendered, "{{"+key+"}}", value)
	}
	return rendered
}
