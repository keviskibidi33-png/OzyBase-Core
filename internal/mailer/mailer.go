package mailer

import (
	"fmt"
	"log"
	"net/smtp"
	"net/url"
	"os"
	"strings"
	"time"
)

// Mailer defines the interface for sending emails
type Mailer interface {
	Send(to, subject, body string) error
	SendVerificationEmail(to, token string) error
	SendPasswordResetEmail(to, token string) error
	SendSecurityAlert(to, alertType, details string) error
	SendWorkspaceInvite(to, workspaceName, inviterEmail string) error
}

// LogMailer is a mock mailer that logs emails to the console
type LogMailer struct{}

func NewLogMailer() *LogMailer {
	return &LogMailer{}
}

func (m *LogMailer) Send(to, subject, body string) error {
	log.Printf("\n--- EMAIL SENT ---\nTo: %s\nSubject: %s\nBody: %s\n------------------\n", to, subject, body)
	return nil
}

func (m *LogMailer) SendVerificationEmail(to, token string) error {
	subject := "Verify your OzyBase Account"
	link := buildTokenURL("/verify-email", token)
	body := fmt.Sprintf("Click here to verify your account: %s\nToken: %s", link, token)
	return m.Send(to, subject, body)
}

func (m *LogMailer) SendPasswordResetEmail(to, token string) error {
	subject := "Reset your OzyBase Password"
	link := buildTokenURL("/reset-password", token)
	body := fmt.Sprintf("Click here to reset your password: %s\nToken: %s", link, token)
	return m.Send(to, subject, body)
}

func (m *LogMailer) SendSecurityAlert(to, alertType, details string) error {
	subject := fmt.Sprintf("⚠️ SECURITY ALERT: %s", alertType)
	body := fmt.Sprintf("A critical security event has been detected:\n\nType: %s\nDetails: %s\n\nDate: %s\nAction Required: Check your OzyBase Dashboard immediately.", alertType, details, time.Now().Format(time.RFC1123))
	return m.Send(to, subject, body)
}

func (m *LogMailer) SendWorkspaceInvite(to, workspaceName, inviterEmail string) error {
	subject := fmt.Sprintf("Invitation to join %s on OzyBase", workspaceName)
	body := fmt.Sprintf("%s has invited you to collaborate on the workspace '%s'.\n\nLog in to your dashboard to get started.", inviterEmail, workspaceName)
	return m.Send(to, subject, body)
}

// SMTPMailer implementation
type SMTPMailer struct {
	Host     string
	Port     string
	Username string
	Password string
	From     string
}

func NewSMTPMailer(host, port, user, pass, from string) *SMTPMailer {
	return &SMTPMailer{
		Host:     host,
		Port:     port,
		Username: user,
		Password: pass,
		From:     from,
	}
}

func (m *SMTPMailer) Send(to, subject, body string) error {
	msg := []byte("To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n" +
		"\r\n" +
		body + "\r\n")

	auth := smtp.PlainAuth("", m.Username, m.Password, m.Host)
	addr := fmt.Sprintf("%s:%s", m.Host, m.Port)

	err := smtp.SendMail(addr, auth, m.From, []string{to}, msg)
	if err != nil {
		log.Printf("❌ Failed to send email via SMTP: %v", err)
		return err
	}
	log.Printf("📧 Email sent to %s via SMTP", to)
	return nil
}

func (m *SMTPMailer) SendVerificationEmail(to, token string) error {
	subject := "Verify your OzyBase Account"
	link := buildTokenURL("/verify-email", token)
	body := fmt.Sprintf("Click here to verify your account: %s\nToken: %s", link, token)
	return m.Send(to, subject, body)
}

func (m *SMTPMailer) SendPasswordResetEmail(to, token string) error {
	subject := "Reset your OzyBase Password"
	link := buildTokenURL("/reset-password", token)
	body := fmt.Sprintf("Click here to reset your password: %s\nToken: %s", link, token)
	return m.Send(to, subject, body)
}

func (m *SMTPMailer) SendSecurityAlert(to, alertType, details string) error {
	subject := fmt.Sprintf("⚠️ SECURITY ALERT: %s", alertType)
	body := fmt.Sprintf("A critical security event has been detected:\n\nType: %s\nDetails: %s\n\nDate: %s\nAction Required: Check your OzyBase Dashboard immediately.", alertType, details, time.Now().Format(time.RFC1123))
	return m.Send(to, subject, body)
}

func (m *SMTPMailer) SendWorkspaceInvite(to, workspaceName, inviterEmail string) error {
	subject := fmt.Sprintf("Invitation to join %s on OzyBase", workspaceName)
	body := fmt.Sprintf("%s has invited you to collaborate on the workspace '%s'.\n\nLog in to your dashboard to get started.", inviterEmail, workspaceName)
	return m.Send(to, subject, body)
}

func buildTokenURL(path, token string) string {
	base := strings.TrimSpace(os.Getenv("SITE_URL"))
	if base == "" {
		base = "http://localhost:5342"
	}
	base = strings.TrimRight(base, "/")

	u, err := url.Parse(base)
	if err != nil || u.Scheme == "" || u.Host == "" {
		u, _ = url.Parse("http://localhost:5342")
	}

	u.Path = strings.TrimRight(u.Path, "/") + path
	query := u.Query()
	query.Set("token", token)
	u.RawQuery = query.Encode()

	return u.String()
}
