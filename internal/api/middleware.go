package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
)

func AuthMiddleware(jwtSecret string, optional bool) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			authHeader := c.Request().Header.Get("Authorization")
			if authHeader == "" {
				if optional {
					return next(c)
				}
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "missing authorization header"})
			}

			tokenParts := strings.Split(authHeader, " ")
			if len(tokenParts) != 2 || strings.ToLower(tokenParts[0]) != "bearer" {
				if optional {
					return next(c)
				}
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid authorization header format"})
			}

			tokenString := tokenParts[1]
			token, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
				if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
				}
				return []byte(jwtSecret), nil
			})

			if err != nil || !token.Valid {
				if optional {
					return next(c)
				}
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid or expired token"})
			}

			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				if optional {
					return next(c)
				}
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid token claims"})
			}

			c.Set("user_id", claims["user_id"])
			c.Set("email", claims["email"])
			c.Set("role", claims["role"])

			return next(c)
		}
	}
}

// RLSMiddleware injects user context into Postgres for the duration of the request
func RLSMiddleware(db *data.DB) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			userID, _ := c.Get("user_id").(string)
			if userID == "" {
				return next(c)
			}

			email, _ := c.Get("email").(string)
			role, _ := c.Get("role").(string)

			// Inject RLS context into the database pool for this request
			// Note: This uses SET LOCAL, so it only affects the current session/transaction within the DB pool connection.
			// Since pgxpool connections are reused, we MUST ensure this is done per request.
			// However, SET LOCAL only works within a transaction.
			// If we are not in a transaction, we should use SET.
			// Best practice with pgxpool is to use a transaction for RLS.

			// Store the RLS context in the echo context so handlers can use it
			// when they start their own transactions.
			rlsCtx := data.RLSContext{
				UserID:  userID,
				Email:   email,
				Roles:   []string{role},
				IsAdmin: role == "admin",
			}
			c.Set("rls_ctx", rlsCtx)

			// Also wrap the Request Context
			c.SetRequest(c.Request().WithContext(data.NewContext(c.Request().Context(), rlsCtx)))

			return next(c)
		}
	}
}

// WorkspaceMiddleware ensures the user has access to the requested workspace
func WorkspaceMiddleware(db *data.DB) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			workspaceID := c.Request().Header.Get("X-Workspace-Id")
			if workspaceID == "" {
				// We don't block if no workspace is provided (might be public or global API)
				return next(c)
			}

			userID, _ := c.Get("user_id").(string)
			if userID == "" {
				// If not authenticated, they can't belong to a workspace
				return next(c)
			}

			// Check membership
			var role string
			err := db.Pool.QueryRow(c.Request().Context(), `
				SELECT role FROM _v_workspace_members
				WHERE workspace_id = $1 AND user_id = $2
			`, workspaceID, userID).Scan(&role)

			if err != nil {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "access to this workspace is denied or workspace does not exist"})
			}

			// Inject workspace context
			c.Set("workspace_id", workspaceID)
			c.Set("workspace_role", role)

			return next(c)
		}
	}
}

// APIKeyMiddleware validates OzyBase API keys (Enterprise Phase 1)
func APIKeyMiddleware(db *data.DB) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// Skip if already authenticated by JWT
			if c.Get("user_id") != nil {
				return next(c)
			}

			key := c.Request().Header.Get("apikey")
			if key == "" {
				key = c.Request().Header.Get("X-Ozy-Key")
			}

			if key == "" {
				return next(c) // Proceed for public routes or will fail in AccessMiddleware
			}

			// Validate Key
			hash := sha256.Sum256([]byte(key))
			keyHash := hex.EncodeToString(hash[:])

			var role string
			var id string
			err := db.Pool.QueryRow(c.Request().Context(), `
				UPDATE _v_api_keys 
				SET last_used_at = NOW() 
				WHERE key_hash = $1 AND is_active = true 
				  AND (expires_at IS NULL OR expires_at > NOW())
				RETURNING id, role
			`, keyHash).Scan(&id, &role)

			if err != nil {
				// We don't block here, just don't set user context.
				// AccessMiddleware will block if requirement is 'auth' or 'admin'
				return next(c)
			}

			// Service roles are treated as admin if specifically configured,
			// otherwise they are elevated system users.
			c.Set("user_id", "api_key_"+id)
			c.Set("role", role)
			c.Set("is_api_key", true)

			return next(c)
		}
	}
}

// AccessMiddleware checks per-collection permissions (ACL)
func AccessMiddleware(db *data.DB, requirement string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			collectionName := c.Param("name")
			if collectionName == "" {
				return next(c) // Public routes or collections management
			}

			var listRule, createRule, updateRule, deleteRule, rlsRule string
			var rlsEnabled bool
			err := db.Pool.QueryRow(c.Request().Context(),
				"SELECT list_rule, create_rule, update_rule, delete_rule, rls_enabled, rls_rule FROM _v_collections WHERE name = $1",
				collectionName).Scan(&listRule, &createRule, &updateRule, &deleteRule, &rlsEnabled, &rlsRule)

			if err != nil {
				fmt.Printf("[ACL-DEBUG] Collection NOT FOUND in _v_collections: %s\n", collectionName)
				return c.JSON(http.StatusNotFound, map[string]string{"error": "collection not found"})
			}

			// Store RLS config for later use in handlers
			c.Set("rls_enabled", rlsEnabled)
			c.Set("rls_rule", rlsRule)

			rule := listRule
			if requirement == "create" {
				rule = createRule
			}
			fmt.Printf("[ACL-DEBUG] Table: %s | Requirement: %s | Rule: %s | User: %v\n", collectionName, requirement, rule, c.Get("user_id"))

			// ACL Logic
			switch rule {
			case "public":
				return next(c)
			case "auth":
				if c.Get("user_id") == nil {
					fmt.Printf("[ACL-DEBUG] BLOCKED: Auth required for %s\n", collectionName)
					return c.JSON(http.StatusForbidden, map[string]string{"error": "authentication required for this collection"})
				}
				return next(c)
			case "admin":
				role := c.Get("role")
				if role == nil || role.(string) != "admin" {
					fmt.Printf("[ACL-DEBUG] BLOCKED: Admin required for %s | Current role: %v\n", collectionName, role)
					return c.JSON(http.StatusForbidden, map[string]string{"error": "admin access required for this collection"})
				}
				return next(c)
			default:
				// Support custom roles like 'role:manager'
				if strings.HasPrefix(rule, "role:") {
					requiredRole := strings.TrimPrefix(rule, "role:")
					userRole := c.Get("role")
					if userRole == nil || userRole.(string) != requiredRole {
						return c.JSON(http.StatusForbidden, map[string]string{"error": fmt.Sprintf("%s role required for this collection", requiredRole)})
					}
					return next(c)
				}
				return c.JSON(http.StatusForbidden, map[string]string{"error": "access denied"})
			}
		}
	}
}

// MetricsMiddleware tracks activity for the dashboard and persists audit logs
func MetricsMiddleware(h *Handler) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			path := c.Request().URL.Path
			lowerPath := strings.ToLower(path)

			// 🛡️ [Refined Exclusion] Strictly block automated polling noise
			// We block only the HEAD and background fetch events, allowing actual interactions
			isPolling := lowerPath == "/api/project/logs" ||
				lowerPath == "/api/analytics/traffic" ||
				lowerPath == "/api/analytics/geo" ||
				lowerPath == "/api/project/security/alerts" ||
				lowerPath == "/api/health" ||
				lowerPath == "/api/system/status"

			if isPolling {
				return next(c)
			}

			fmt.Fprintf(os.Stderr, "📝 [Audit] Tracking Request: %s\n", path)

			start := time.Now().UTC()
			err := next(c)
			stop := time.Now().UTC()

			// Add to logs with Geolocation
			ip := c.RealIP()
			latency := stop.Sub(start)
			status := c.Response().Status

			// Handle userID as UUID: convert "" to nil for Postgres safety
			rawUserID := c.Get("user_id")
			var userID any
			if s, ok := rawUserID.(string); ok && s != "" {
				userID = s
			} else {
				userID = nil
			}

			go func() {
				geo, _ := h.Geo.GetLocation(context.Background(), ip)

				entry := LogEntry{
					ID:        fmt.Sprintf("%d", time.Now().UTC().UnixNano()),
					Time:      stop.Format("15:04:05"),
					Method:    c.Request().Method,
					Path:      path,
					Status:    status,
					Latency:   fmt.Sprintf("%v", latency.Truncate(time.Millisecond)),
					IP:        ip,
					Country:   geo.Country,
					City:      geo.City,
					Timestamp: stop,
				}
				h.Metrics.AddLog(entry)

				// Check for Geo Breach
				isBreach, _ := h.Geo.CheckBreach(context.Background(), ip, geo.Country)

				// Persist to DB with explicit timestamp to align with server_time
				_, err := h.DB.Pool.Exec(context.Background(), `
					INSERT INTO _v_audit_logs (user_id, ip_address, method, path, status, latency_ms, country, city, user_agent, created_at)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
				`, userID, ip, entry.Method, entry.Path, entry.Status, latency.Milliseconds(), geo.Country, geo.City, c.Request().UserAgent(), stop)

				if err != nil {
					fmt.Fprintf(os.Stderr, "❌ [Audit Error] Failed to insert log: %v (Path: %s, User: %v)\n", err, path, userID)
				}

				if isBreach {
					details, _ := json.Marshal(map[string]any{
						"ip":      ip,
						"country": geo.Country,
						"city":    geo.City,
						"method":  entry.Method,
						"path":    entry.Path,
					})
					_, _ = h.DB.Pool.Exec(context.Background(), `
						INSERT INTO _v_security_alerts (type, severity, details)
						VALUES ($1, $2, $3)
					`, "geo_breach", "critical", details)

					// Send email notifications to all active recipients
					go func() {
						rows, err := h.DB.Pool.Query(context.Background(), `
							SELECT email FROM _v_security_notification_recipients
							WHERE is_active = true AND 'geo_breach' = ANY(alert_types)
						`)
						if err != nil {
							return
						}
						defer rows.Close()

						alertDetails := fmt.Sprintf("IP: %s from %s, %s attempted to access %s %s",
							ip, geo.Country, geo.City, entry.Method, entry.Path)

						for rows.Next() {
							var email string
							if err := rows.Scan(&email); err == nil {
								_ = h.Mailer.SendSecurityAlert(email, "Geographic Access Breach", alertDetails)
							}
						}
					}()

					// Send to webhook integrations (Slack, Discord, SIEM)
					go func() {
						var detailsMap map[string]any
						_ = json.Unmarshal(details, &detailsMap)

						_ = h.Integrations.SendSecurityAlert(context.Background(), realtime.SecurityAlertPayload{
							Type:      "geo_breach",
							Severity:  "critical",
							Details:   detailsMap,
							Timestamp: time.Now().Format(time.RFC3339),
						})
					}()
				}
			}()

			return err
		}
	}
}
