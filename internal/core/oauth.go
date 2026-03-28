package core

import (
	"fmt"
	"os"
	"strings"

	"github.com/markbates/goth"
	"github.com/markbates/goth/providers/github"
	"github.com/markbates/goth/providers/google"
)

func defaultOAuthSiteURL() string {
	siteURL := strings.TrimRight(os.Getenv("SITE_URL"), "/")
	if siteURL != "" && !strings.Contains(siteURL, "example.com") && !strings.Contains(siteURL, "example.org") {
		return siteURL
	}

	appDomain := strings.TrimSpace(os.Getenv("APP_DOMAIN"))
	if appDomain != "" && !strings.Contains(appDomain, "example.com") && !strings.Contains(appDomain, "example.org") {
		return "https://" + strings.TrimRight(appDomain, "/")
	}

	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8090"
	}

	return fmt.Sprintf("http://localhost:%s", port)
}

func OAuthCallbackURL(provider string) string {
	callbackURL := os.Getenv("OZY_CALLBACK_URL")
	siteURL := defaultOAuthSiteURL()

	if callbackURL == "" {
		return fmt.Sprintf("%s/api/auth/callback/%s", siteURL, provider)
	}

	if strings.Contains(callbackURL, "%s") {
		return fmt.Sprintf(callbackURL, provider)
	}

	callbackURL = strings.TrimRight(callbackURL, "/")
	if strings.HasSuffix(callbackURL, "/api/auth/callback") {
		return callbackURL + "/" + provider
	}

	return callbackURL
}

// InitOAuth initializes the OAuth providers using gothic/goth
func InitOAuth() error {
	githubClient := os.Getenv("GITHUB_CLIENT_ID")
	githubSecret := os.Getenv("GITHUB_CLIENT_SECRET")
	googleClient := os.Getenv("GOOGLE_CLIENT_ID")
	googleSecret := os.Getenv("GOOGLE_CLIENT_SECRET")

	var providers []goth.Provider

	if githubClient != "" && githubSecret != "" {
		providers = append(providers, github.New(githubClient, githubSecret, OAuthCallbackURL("github")))
	}

	if googleClient != "" && googleSecret != "" {
		providers = append(providers, google.New(googleClient, googleSecret, OAuthCallbackURL("google")))
	}

	if len(providers) > 0 {
		goth.UseProviders(providers...)
	}

	return nil
}

// GetProviderUser common interface for OAuth users
type OAuthUser struct {
	ID        string
	Email     string
	Name      string
	AvatarURL string
	Provider  string
}
