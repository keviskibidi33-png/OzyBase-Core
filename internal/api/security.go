package api

import (
	"crypto/subtle"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
)

// SecurityConfig holds configuration for security middleware
type SecurityConfig struct {
	// ContentSecurityPolicy - Controls resources the browser is allowed to load
	ContentSecurityPolicy string
	// XFrameOptions - Prevents clickjacking attacks
	XFrameOptions string
	// XContentTypeOptions - Prevents MIME type sniffing
	XContentTypeOptions string
	// XSSProtection - XSS filter in browsers
	XSSProtection string
	// HSTSMaxAge - HTTP Strict Transport Security max age in seconds
	HSTSMaxAge int
	// HSTSIncludeSubdomains - Include subdomains in HSTS
	HSTSIncludeSubdomains bool
	// ReferrerPolicy - Controls how much referrer info is sent
	ReferrerPolicy string
	// PermissionsPolicy - Controls browser features
	PermissionsPolicy string
}

// DefaultSecurityConfig returns production-ready security headers configuration
func DefaultSecurityConfig() SecurityConfig {
	return SecurityConfig{
		ContentSecurityPolicy: "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://flagcdn.com; font-src 'self' data:; connect-src 'self' https://ipapi.co; worker-src 'self' blob:",
		XFrameOptions:         "DENY",
		XContentTypeOptions:   "nosniff",
		XSSProtection:         "1; mode=block",
		HSTSMaxAge:            31536000, // 1 year
		HSTSIncludeSubdomains: true,
		ReferrerPolicy:        "strict-origin-when-cross-origin",
		PermissionsPolicy:     "geolocation=(), camera=(), microphone=()",
	}
}

// SecurityHeadersMiddleware adds security headers to all responses
func SecurityHeadersMiddleware(config SecurityConfig) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			res := c.Response()

			// Prevent MIME type sniffing
			res.Header().Set("X-Content-Type-Options", config.XContentTypeOptions)

			// Prevent clickjacking
			res.Header().Set("X-Frame-Options", config.XFrameOptions)

			// XSS Protection (legacy but still useful)
			res.Header().Set("X-XSS-Protection", config.XSSProtection)

			// Content Security Policy
			if config.ContentSecurityPolicy != "" {
				res.Header().Set("Content-Security-Policy", config.ContentSecurityPolicy)
			}

			// HTTP Strict Transport Security (only in production with HTTPS)
			if config.HSTSMaxAge > 0 {
				hstsValue := "max-age=" + strconv.Itoa(config.HSTSMaxAge)
				if config.HSTSIncludeSubdomains {
					hstsValue += "; includeSubDomains"
				}
				res.Header().Set("Strict-Transport-Security", hstsValue)
			}

			// Referrer Policy
			if config.ReferrerPolicy != "" {
				res.Header().Set("Referrer-Policy", config.ReferrerPolicy)
			}

			// Permissions Policy (formerly Feature-Policy)
			if config.PermissionsPolicy != "" {
				res.Header().Set("Permissions-Policy", config.PermissionsPolicy)
			}

			// Remove server identification
			res.Header().Set("X-Powered-By", "")
			res.Header().Del("Server")

			return next(c)
		}
	}
}

// SecurityHeadersDefault is a convenience function using default config
func SecurityHeadersDefault() echo.MiddlewareFunc {
	return SecurityHeadersMiddleware(DefaultSecurityConfig())
}

// ConstantTimeCompare performs a constant-time comparison of two strings
// This prevents timing attacks when comparing sensitive data like tokens
func ConstantTimeCompare(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// TimeoutMiddleware adds a timeout to each request
func TimeoutMiddleware(timeout time.Duration) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// Set timeout in context
			c.Set("request_timeout", timeout)
			return next(c)
		}
	}
}

// APIVersionHeader adds API version header to responses
func APIVersionHeader(version string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Response().Header().Set("X-API-Version", version)
			return next(c)
		}
	}
}
