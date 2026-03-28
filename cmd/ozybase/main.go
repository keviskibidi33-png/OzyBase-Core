package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Xangel0s/OzyBase/internal/api"
	ozyauth "github.com/Xangel0s/OzyBase/internal/auth"
	"github.com/Xangel0s/OzyBase/internal/cli"
	"github.com/Xangel0s/OzyBase/internal/config"
	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/logger"
	"github.com/Xangel0s/OzyBase/internal/mailer"
	"github.com/Xangel0s/OzyBase/internal/migrations"
	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/Xangel0s/OzyBase/internal/storage"
	"github.com/Xangel0s/OzyBase/internal/typegen"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/time/rate"
)

func main() {
	if err := run(); err != nil {
		log.Printf("❌ Failed to start OzyBase: %v", err)
		os.Exit(1)
	}
}

func run() error {
	handled, err := cli.HandleGlobalCommands(os.Args)
	if err != nil {
		return err
	}
	if handled {
		return nil
	}

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	// Initialize Logger
	logger.Init(os.Getenv("DEBUG") == "true")
	logger.Log.Info().Msg("🎯 OzyBase initializing...")
	if cfg.GeneratedJWTSecret {
		logger.Log.Warn().Msg("JWT_SECRET was missing and has been generated automatically into .ozy_secret")
	}
	if cfg.GeneratedAnonKey {
		logger.Log.Warn().Msg("ANON_KEY was missing and has been generated automatically into .ozy_anon_key")
	}
	if cfg.GeneratedServiceRoleKey {
		logger.Log.Warn().Msg("SERVICE_ROLE_KEY was missing and has been generated automatically into .ozy_service_role_key")
	}
	if cfg.DerivedAllowedOrigin {
		logger.Log.Info().Strs("origins", cfg.AllowedOrigins).Msg("ALLOWED_ORIGINS was auto-derived from SITE_URL/APP_DOMAIN")
	}
	for _, warning := range cfg.SecurityWarnings {
		logger.Log.Warn().Str("area", "config-security").Msg(warning)
	}

	// Connect to database
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var embeddedDB *data.EmbeddedDB
	dbURL := cfg.DatabaseURL

	if dbURL == "" {
		embeddedDB = data.NewEmbeddedDB()
		if err := embeddedDB.Start(); err != nil {
			return fmt.Errorf("failed to start embedded database: %w", err)
		}
		dbURL = embeddedDB.GetConnectionString()
	}

	db, err := data.Connect(ctx, dbURL)
	if err != nil {
		if embeddedDB != nil {
			_ = embeddedDB.Stop()
		}
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	defer func() {
		db.Close()
		if embeddedDB != nil {
			_ = embeddedDB.Stop()
		}
	}()

	logger.Log.Info().Msg("✅ Connected to PostgreSQL")

	// Run migrations
	if err := db.RunMigrations(ctx); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	// 🔐 Initialize OAuth
	initOAuth()

	// 📦 Initialize Storage
	storageSvc, err := initStorage(cfg)
	if err != nil {
		return err
	}

	// Optional admin bootstrap.
	// Default flow keeps system uninitialized so Setup Wizard appears first.
	if shouldBootstrapAdminFromEnv() {
		ozyauth.EnsureAdminUser(db)
	} else {
		logger.Log.Info().Msg("Admin bootstrap skipped. Setup Wizard will handle first-time initialization.")
	}

	// CLI Commands handling
	if handleCLI(db) {
		return nil
	}

	// Initialize Realtime components
	broker, dispatcher, cronMgr := initRealtime(db)

	// 🔄 Initialize PubSub (for horizontal scaling)
	ps := initPubSub(cfg, broker)
	startRealtimePipelines(ctx, db, broker, dispatcher, ps, cfg)

	// Setup Mailer
	mailSvc := buildMailer(cfg)

	// 📝 Setup Audit Service (Go Best Practice: Async Logging)
	auditService := core.NewAuditService(db)
	auditService.Start()
	defer auditService.Stop()

	// 📜 Initialize Migrations Generator & Applier
	migrator := migrations.NewGenerator("./migrations")
	applier := migrations.NewApplier(db.Pool, "./migrations")

	// Initialize Server Components
	h := api.NewHandler(db, broker, dispatcher, mailSvc, storageSvc, ps, migrator, applier, auditService)

	// Start Log Export Worker
	go h.StartLogExporter(context.Background())
	// Start Integration Delivery Worker (queue + retry + DLQ)
	if h.Integrations != nil {
		go h.Integrations.StartDeliveryWorker(context.Background())
	}

	e := setupEcho(h, cfg, cronMgr)

	// 📊 Register Prometheus
	api.RegisterPrometheus(e)

	// Start server
	addr := fmt.Sprintf(":%s", cfg.Port)
	go func() {
		logger.Log.Info().Str("addr", addr).Msg("🚀 OzyBase server starting")
		if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
			logger.Log.Fatal().Err(err).Msg("Server crashed")
		}
	}()

	// Wait for interruption
	<-ctx.Done()
	logger.Log.Info().Msg("🛑 Shutting down server...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := e.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("failed to shutdown server: %w", err)
	}

	logger.Log.Info().Msg("👋 Server exited")
	return nil
}

func buildMailer(cfg *config.Config) mailer.Mailer {
	if cfg != nil && cfg.SMTPHost != "" {
		logger.Log.Info().Msg("SMTP mailer initialized")
		return mailer.NewSMTPMailer(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPass, cfg.SMTPFrom)
	}

	logger.Log.Warn().Msg("SMTP is not configured; email flows will use the console mailer")
	return mailer.NewLogMailer()
}

func handleCLI(db *data.DB) bool {
	if len(os.Args) > 1 && os.Args[1] == "gen-types" {
		outputPath := "./OzyBase-types.ts"
		for i, arg := range os.Args {
			if arg == "--out" && i+1 < len(os.Args) {
				outputPath = os.Args[i+1]
			}
		}

		gen := typegen.NewGenerator(db)
		if err := gen.Generate(outputPath); err != nil {
			log.Fatalf("Failed to generate types: %v", err)
		}
		log.Printf("✅ Types generated successfully to %s", outputPath)
		return true
	}

	if len(os.Args) > 1 && os.Args[1] == "reset-admin" {
		ctx := context.Background()
		email := resolveInitialAdminEmail()
		if len(os.Args) <= 2 || strings.TrimSpace(os.Args[2]) == "" {
			log.Fatal("Usage: ozybase reset-admin <new-password>")
		}
		newPass := os.Args[2]

		log.Printf("🔐 Resetting password for %s...", email)

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPass), 12)
		if err != nil {
			log.Fatalf("Failed to hash password: %v", err)
		}

		_, err = db.Pool.Exec(ctx, "UPDATE _v_users SET password_hash = $1 WHERE email = $2", string(hashedPassword), email)
		if err != nil {
			log.Fatalf("Failed to update password: %v", err)
		}

		log.Printf("✅ Admin password reset successfully for: %s", email)
		return true
	}

	if len(os.Args) > 1 && os.Args[1] == "migrate-apply" {
		ctx := context.Background()
		applier := migrations.NewApplier(db.Pool, "./migrations")

		log.Println("⚡ Running Ozy-Apply: Checking for pending migrations...")
		if err := applier.ApplyPendingMigrations(ctx); err != nil {
			log.Fatalf("❌ Migration application failed: %v", err)
		}

		log.Println("✅ All migrations applied successfully.")
		return true
	}

	return false
}

func resolveInitialAdminEmail() string {
	if email := strings.TrimSpace(os.Getenv("INITIAL_ADMIN_EMAIL")); email != "" {
		return email
	}
	appDomain := strings.TrimSpace(os.Getenv("APP_DOMAIN"))
	if appDomain == "" || appDomain == "localhost" || strings.HasPrefix(appDomain, "localhost:") {
		return "system@ozybase.local"
	}
	return "admin@" + appDomain
}

func shouldBootstrapAdminFromEnv() bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("OZY_AUTO_BOOTSTRAP_ADMIN")), "true") {
		return true
	}
	if strings.TrimSpace(os.Getenv("INITIAL_ADMIN_EMAIL")) != "" {
		return true
	}
	if strings.TrimSpace(os.Getenv("INITIAL_ADMIN_PASSWORD")) != "" {
		return true
	}
	return false
}

func initOAuth() {
	if err := core.InitOAuth(); err != nil {
		logger.Log.Warn().Err(err).Msg("OAuth initialization failed")
	}
}

func initStorage(cfg *config.Config) (storage.Provider, error) {
	if cfg.StorageProvider == "s3" {
		svc, err := storage.NewS3Provider(cfg.S3Endpoint, cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3UseSSL)
		if err != nil {
			if cfg.StorageFallbackLocal {
				logger.Log.Warn().Err(err).Str("path", cfg.StoragePath).Msg("S3 storage unavailable, falling back to local storage")
				return storage.NewLocalProvider(cfg.StoragePath), nil
			}
			return nil, fmt.Errorf("failed to initialize S3 storage: %w", err)
		}
		logger.Log.Info().Msg("Using S3-compatible storage")
		return svc, nil
	}
	if cfg.StorageProvider != "local" {
		logger.Log.Warn().Str("provider", cfg.StorageProvider).Msg("Unknown storage provider, defaulting to local storage")
	}
	logger.Log.Info().Str("path", cfg.StoragePath).Msg("Using local storage")
	return storage.NewLocalProvider(cfg.StoragePath), nil
}

func initRealtime(db *data.DB) (*realtime.Broker, *realtime.WebhookDispatcher, *realtime.CronManager) {
	broker := realtime.NewBroker()
	dispatcher := realtime.NewWebhookDispatcher(db.Pool)

	cronMgr := realtime.NewCronManager(db.Pool)
	cronMgr.Start()

	return broker, dispatcher, cronMgr
}

func startRealtimePipelines(ctx context.Context, db *data.DB, broker *realtime.Broker, dispatcher *realtime.WebhookDispatcher, ps realtime.PubSub, cfg *config.Config) {
	nodeID := strings.TrimSpace(cfg.RealtimeNodeID)
	if nodeID == "" {
		nodeID = realtime.DefaultNodeID()
	}
	channel := strings.TrimSpace(cfg.RealtimeChannel)
	if channel == "" {
		channel = realtime.DefaultClusterChannel
	}
	broker.SetNodeID(nodeID)
	if err := realtime.StartPubSubBridge(ctx, ps, broker, nodeID, channel); err != nil {
		logger.Log.Warn().Err(err).Str("mode", ps.Mode()).Msg("realtime pubsub bridge failed to start")
	}
	go realtime.ListenForEvents(ctx, db.Pool, broker, dispatcher, ps, nodeID, channel)
}

func initPubSub(cfg *config.Config, broker *realtime.Broker) realtime.PubSub {
	if cfg.RealtimeBroker == "redis" {
		logger.Log.Info().Msg("🔄 Using Redis PubSub")
		return realtime.NewRedisPubSub(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB)
	}
	logger.Log.Info().Msg("🔄 Using Local PubSub")
	return realtime.NewLocalPubSub(broker)
}

func setupEcho(h *api.Handler, cfg *config.Config, cronMgr *realtime.CronManager) *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.HTTPErrorHandler = api.HTTPErrorHandler

	// Middleware
	e.Use(api.RequestIDMiddleware())
	e.Use(api.ErrorEnvelopeMiddleware())
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogStatus: true,
		LogURI:    true,
		LogValuesFunc: func(c echo.Context, v middleware.RequestLoggerValues) error {
			logger.Log.Info().
				Int("status", v.Status).
				Str("uri", v.URI).
				Msg("request")
			return nil
		},
	}))
	e.Use(h.FirewallMiddleware()) // 🛡️ IP Firewall (Whitelist/Blacklist) - Very First Defense
	e.Use(middleware.Recover())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: cfg.AllowedOrigins,
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization},
	}))
	e.Use(middleware.RateLimiter(middleware.NewRateLimiterMemoryStoreWithConfig(
		middleware.RateLimiterMemoryStoreConfig{
			Rate:      rate.Limit(cfg.RateLimitRPS),
			Burst:     cfg.RateLimitBurst,
			ExpiresIn: 3 * time.Minute,
		},
	)))
	e.Use(api.SecurityHeadersDefault())
	e.Use(middleware.BodyLimit(cfg.BodyLimit))
	e.Use(api.PrometheusMiddleware()) // 📊 Stats
	e.Use(api.APIKeyMiddleware(h.DB, api.StaticAPIKeys{
		AnonKey:                cfg.AnonKey,
		ServiceRoleKey:         cfg.ServiceRoleKey,
		PreviousAnonKey:        cfg.PreviousAnonKey,
		PreviousServiceRoleKey: cfg.PreviousServiceRoleKey,
		StaticGraceUntil:       cfg.StaticKeyGraceUntil,
	})) // 🔐 API Key Auth (Enterprise Phase 1)
	e.Use(api.RLSMiddleware(h.DB)) // 🛡️ RLS Context Injection
	e.Use(api.AdminAuditMiddleware(h))
	// #nosec G101 -- CSRF token lookup/cookie fields are static identifiers, not credentials.
	e.Use(middleware.CSRFWithConfig(middleware.CSRFConfig{
		TokenLookup:    "header:X-CSRF-Token",
		ContextKey:     "csrf",
		CookieName:     "_ozy_csrf",
		CookiePath:     "/",
		CookieHTTPOnly: true,
		CookieSecure:   !strings.EqualFold(os.Getenv("DEBUG"), "true"),
		CookieSameSite: http.SameSiteStrictMode,
		Skipper: func(c echo.Context) bool {
			// Skip CSRF for API requests with Bearer token or API keys
			authHeader := c.Request().Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") || c.Get("is_api_key") == true {
				return true
			}
			// Skip CSRF for login endpoint
			path := c.Request().URL.Path
			if path == "/api/auth/login" || path == "/api/auth/signup" || path == "/api/system/status" || path == "/api/system/setup" || path == "/api/project/metrics" {
				return true
			}
			return false
		},
	}))

	// Services and Handlers
	// Setup Mailer
	mailSvc := h.Mailer
	if mailSvc == nil {
		mailSvc = buildMailer(cfg)
		h.Mailer = mailSvc
	}

	authService := core.NewAuthService(h.DB, cfg.JWTSecret, mailSvc)
	h.Auth = authService // Inject dependency for System Setup
	authHandler := api.NewAuthHandler(authService)
	twoFactorService := core.NewTwoFactorService(h.DB)
	twoFactorHandler := api.NewTwoFactorHandler(twoFactorService, authService)
	realtimeHandler := api.NewRealtimeHandler(h.Broker)
	fileHandler := api.NewFileHandler(h.DB, "./data/storage")
	functionsHandler := api.NewFunctionsHandler(h.DB, "./functions")
	webhookHandler := api.NewWebhookHandler(h.DB)
	cronHandler := api.NewCronHandler(h.DB, cronMgr)
	workspaceService := core.NewWorkspaceService(h.DB)
	workspaceHandler := api.NewWorkspaceHandler(workspaceService, mailSvc)

	// API Groups and Middlewares
	authRequired := api.AuthMiddleware(h.DB, cfg.JWTSecret, false)
	authOptional := api.AuthMiddleware(h.DB, cfg.JWTSecret, true)
	adminOnly := api.RequireRole("admin")
	accessList := api.AccessMiddleware(h.DB, "list")
	accessCreate := api.AccessMiddleware(h.DB, "create")
	accessUpdate := api.AccessMiddleware(h.DB, "update")
	accessDelete := api.AccessMiddleware(h.DB, "delete")

	apiGroup := e.Group("/api")
	apiGroup.Use(api.MetricsMiddleware(h))
	apiGroup.Use(api.WorkspaceMiddleware(h.DB, cfg.JWTSecret))
	{
		apiGroup.GET("/health", h.Health)
		apiGroup.GET("/project/metrics", h.GetPrometheusMetrics) // 📊 Enterprise Phase 1
		apiGroup.GET("/project/stats", h.GetStats, authRequired)
		apiGroup.GET("/realtime", realtimeHandler.Stream)
		apiGroup.GET("/project/realtime/status", h.GetRealtimeStatus, authRequired, adminOnly)

		// ... (Auth/System/etc) ...

		// API Keys (Enterprise Phase 1)
		keysGroup := apiGroup.Group("/project/keys", authRequired, adminOnly)
		keysGroup.GET("", h.ListAPIKeys)
		keysGroup.GET("/events", h.ListAPIKeyEvents)
		keysGroup.POST("", h.CreateAPIKey)
		keysGroup.DELETE("/:id", h.DeleteAPIKey)
		keysGroup.PATCH("/:id/toggle", h.ToggleAPIKey)
		keysGroup.POST("/:id/rotate", h.RotateAPIKey)

		// Workspaces
		workspacesGroup := apiGroup.Group("/workspaces", authRequired)
		workspacesGroup.POST("", workspaceHandler.Create)
		workspacesGroup.GET("", workspaceHandler.List)
		workspacesGroup.PATCH("/:id", workspaceHandler.Update)
		workspacesGroup.DELETE("/:id", workspaceHandler.Delete)
		workspacesGroup.GET("/:id/members", workspaceHandler.ListMembers)
		workspacesGroup.POST("/:id/members", workspaceHandler.AddMember)
		workspacesGroup.DELETE("/:id/members/:userId", workspaceHandler.RemoveMember)

		// Auth
		authGroup := apiGroup.Group("/auth")
		authGroup.POST("/login", authHandler.Login)
		// Signup is now protected, only an authenticated user (admin) can create others
		authGroup.POST("/signup", authHandler.Signup, authRequired, adminOnly)
		authGroup.POST("/reset-password/request", authHandler.RequestReset)
		authGroup.POST("/reset-password/confirm", authHandler.ConfirmReset)
		authGroup.GET("/verify-email", authHandler.VerifyEmail)
		authGroup.POST("/verify-email", authHandler.VerifyEmail)
		authGroup.GET("/users", authHandler.ListUsers, authRequired, adminOnly)
		authGroup.PATCH("/users/:id/role", authHandler.UpdateRole, authRequired, adminOnly)
		authGroup.GET("/providers", h.ListAuthProviders, authRequired, adminOnly)
		authGroup.GET("/config", h.GetAuthConfig, authRequired, adminOnly)
		authGroup.GET("/templates", h.ListAuthTemplates, authRequired, adminOnly)
		authGroup.PUT("/templates/:type", h.UpdateAuthTemplate, authRequired, adminOnly)

		// Social Login
		authGroup.GET("/login/:provider", authHandler.GetOAuthURL)
		authGroup.GET("/callback/:provider", authHandler.OAuthCallback)

		// Sessions (Enterprise Phase 2)
		authGroup.GET("/sessions", authHandler.ListSessions, authRequired)
		authGroup.DELETE("/sessions/:id", authHandler.RevokeSession, authRequired)
		authGroup.POST("/sessions/revoke-all", authHandler.RevokeAllSessions, authRequired, adminOnly)

		// System Setup (Public, but protected by logic inside)
		apiGroup.GET("/system/status", h.GetSystemStatus)
		apiGroup.POST("/system/setup", h.SetupSystem)

		// Two-Factor Authentication
		authGroup.POST("/2fa/setup", twoFactorHandler.Setup2FA, authRequired)
		authGroup.POST("/2fa/enable", twoFactorHandler.Enable2FA, authRequired)
		authGroup.POST("/2fa/disable", twoFactorHandler.Disable2FA, authRequired)
		authGroup.GET("/2fa/status", twoFactorHandler.Get2FAStatus, authRequired)
		authGroup.POST("/2fa/verify", twoFactorHandler.Verify2FA)

		// Functions
		apiGroup.GET("/functions", functionsHandler.List, authRequired)
		apiGroup.POST("/functions", functionsHandler.Create, authRequired)
		apiGroup.DELETE("/functions/:name", functionsHandler.Delete, authRequired, adminOnly)
		apiGroup.POST("/functions/:name/invoke", functionsHandler.Invoke)

		// Files
		apiGroup.POST("/files", fileHandler.Upload, authRequired)
		apiGroup.GET("/files", fileHandler.List, authRequired)
		apiGroup.GET("/files/buckets", fileHandler.ListBuckets, authRequired)
		apiGroup.POST("/files/buckets", fileHandler.CreateBucket, authRequired)
		e.Static("/api/files", "./data/storage")

		// Collections
		collectionsGroup := apiGroup.Group("/collections", authRequired)
		collectionsGroup.POST("", h.CreateCollection)
		collectionsGroup.GET("", h.ListCollections)
		collectionsGroup.DELETE("/:name", h.DeleteCollection) // New
		collectionsGroup.GET("/schemas", h.ListSchemas)
		collectionsGroup.GET("/visualize", h.GetVisualizeSchema)
		collectionsGroup.PATCH("/rules", h.UpdateCollectionRules)
		collectionsGroup.PATCH("/realtime", h.UpdateRealtimeToggle)

		// Tables (Alias for Frontend compatibility)
		tablesGroup := apiGroup.Group("/tables", authRequired)
		tablesGroup.GET("/:name", h.ListRecords)
		tablesGroup.POST("/:name", h.CreateRecord)
		tablesGroup.DELETE("/:name/:id", h.DeleteRecord)
		tablesGroup.GET("/:name/:id", h.GetRecord)

		// Project Info
		apiGroup.GET("/project/info", h.GetProjectInfo, authRequired)
		apiGroup.GET("/project/connection", h.GetProjectConnection, authRequired, adminOnly)
		apiGroup.GET("/project/health", h.GetHealthIssues, authRequired)
		apiGroup.GET("/project/performance/advisor", h.GetPerformanceAdvisor, authRequired, adminOnly)
		apiGroup.GET("/project/performance/advisor/history", h.GetPerformanceAdvisorHistory, authRequired, adminOnly)
		apiGroup.GET("/project/vector/status", h.GetVectorStatus, authRequired, adminOnly)
		apiGroup.POST("/project/vector/setup", h.SetupVectorStore, authRequired, adminOnly)
		apiGroup.POST("/project/vector/upsert", h.UpsertVectorItems, authRequired, adminOnly)
		apiGroup.POST("/project/vector/search", h.SearchVectorItems, authRequired, adminOnly)
		apiGroup.POST("/project/nlq/translate", h.TranslateNLQ, authRequired, adminOnly)
		apiGroup.POST("/project/nlq/query", h.ExecuteNLQ, authRequired, adminOnly)
		apiGroup.GET("/project/mcp/tools", h.GetMCPTools, authRequired, adminOnly)
		apiGroup.POST("/project/mcp/invoke", h.InvokeMCPTool, authRequired, adminOnly)
		apiGroup.GET("/project/security/policies", h.GetSecurityPolicies, authRequired)
		apiGroup.POST("/project/security/policies", h.UpdateSecurityPolicy, authRequired, adminOnly)
		apiGroup.GET("/project/security/stats", h.GetSecurityStats, authRequired)
		apiGroup.GET("/project/security/alerts", h.GetSecurityAlerts, authRequired)
		apiGroup.GET("/project/security/notifications", h.GetNotificationRecipients, authRequired)
		apiGroup.POST("/project/security/notifications", h.AddNotificationRecipient, authRequired, adminOnly)
		apiGroup.DELETE("/project/security/notifications/:id", h.DeleteNotificationRecipient, authRequired, adminOnly)
		apiGroup.GET("/project/observability/slo", h.GetSLOStatus, authRequired, adminOnly)
		apiGroup.GET("/project/security/alert-routing", h.GetAlertRouting, authRequired, adminOnly)
		apiGroup.POST("/project/security/alert-routing", h.UpdateAlertRouting, authRequired, adminOnly)
		apiGroup.GET("/project/security/rls/coverage", h.GetRLSPolicyCoverage, authRequired, adminOnly)
		apiGroup.GET("/project/security/rls/coverage/history", h.GetRLSPolicyCoverageHistory, authRequired, adminOnly)
		apiGroup.POST("/project/security/rls/enforce", h.EnforceRLSAll, authRequired, adminOnly)
		apiGroup.POST("/project/security/rls/closeout", h.RunRLSCloseout, authRequired, adminOnly)
		apiGroup.GET("/project/security/admin-audit", h.ListAdminAuditEvents, authRequired, adminOnly)

		// Integrations (Slack, Discord, SIEM)
		apiGroup.GET("/project/integrations", h.ListIntegrations, authRequired)
		apiGroup.POST("/project/integrations", h.CreateIntegration, authRequired, adminOnly)
		apiGroup.DELETE("/project/integrations/:id", h.DeleteIntegration, authRequired, adminOnly)
		apiGroup.POST("/project/integrations/:id/test", h.TestIntegration, authRequired, adminOnly)
		apiGroup.GET("/project/integrations/metrics", h.GetIntegrationDeliveryMetrics, authRequired, adminOnly)
		apiGroup.GET("/project/integrations/dlq", h.ListIntegrationDLQ, authRequired, adminOnly)
		apiGroup.POST("/project/integrations/dlq/:id/retry", h.RetryIntegrationDLQ, authRequired, adminOnly)

		// Analytics (High Performance Go Aggregations)
		apiGroup.GET("/analytics/traffic", h.GetTrafficStats, authRequired)
		apiGroup.GET("/analytics/geo", h.GetGeoStats, authRequired)

		// Security Dashboard Routes
		apiGroup.POST("/project/health/fix", h.FixHealthIssues, authRequired, adminOnly)
		apiGroup.GET("/project/logs", h.GetLogs, authRequired)
		apiGroup.GET("/project/logs/export", h.ExportLogs, authRequired)
		apiGroup.GET("/security/firewall", h.ListIPRules, authRequired)
		apiGroup.POST("/security/firewall", h.CreateIPRule, authRequired, adminOnly)
		apiGroup.DELETE("/security/firewall/:id", h.DeleteIPRule, authRequired, adminOnly)

		// Extensions
		apiGroup.GET("/extensions", h.ListExtensions, authRequired)
		apiGroup.POST("/extensions/:name", h.ToggleExtension, authRequired, adminOnly)
		apiGroup.GET("/extensions/marketplace", h.ListExtensionMarketplace, authRequired, adminOnly)
		apiGroup.POST("/extensions/marketplace/sync", h.SyncExtensionMarketplace, authRequired, adminOnly)
		apiGroup.POST("/extensions/marketplace/:slug/install", h.InstallMarketplaceExtension, authRequired, adminOnly)
		apiGroup.DELETE("/extensions/marketplace/:slug/install", h.UninstallMarketplaceExtension, authRequired, adminOnly)

		// Integrations (Modern Handlers)
		apiGroup.GET("/webhooks", webhookHandler.List, authRequired)
		apiGroup.POST("/webhooks", webhookHandler.Create, authRequired)
		apiGroup.DELETE("/webhooks/:id", webhookHandler.Delete, authRequired)

		apiGroup.GET("/cron", cronHandler.List, authRequired, adminOnly)
		apiGroup.POST("/cron/enable", cronHandler.Enable, authRequired, adminOnly)
		apiGroup.POST("/cron", cronHandler.Create, authRequired, adminOnly)
		apiGroup.DELETE("/cron/:id", cronHandler.Delete, authRequired, adminOnly)

		apiGroup.GET("/vault", h.ListSecrets, authRequired)
		apiGroup.POST("/vault", h.CreateSecret, authRequired, adminOnly)
		apiGroup.DELETE("/vault/:id", h.DeleteSecret, authRequired, adminOnly)

		apiGroup.GET("/wrappers", h.ListWrappers, authRequired)
		apiGroup.POST("/wrappers", h.CreateWrapper, authRequired, adminOnly)
		apiGroup.DELETE("/wrappers/:name", h.DeleteWrapper, authRequired, adminOnly)
		apiGroup.POST("/graphql/v1", h.HandleGraphQL, authRequired)

		apiGroup.GET("/schema/:name", h.GetTableSchema, authRequired)
		apiGroup.POST("/sql", h.HandleExecuteSQL, authRequired, adminOnly)
		apiGroup.POST("/sql/sync", h.HandleSyncSystem, authRequired, adminOnly)

		// Records
		apiGroup.POST("/collections/:name/records", h.CreateRecord, authOptional, accessCreate)
		apiGroup.GET("/collections/:name/records", h.ListRecords, authOptional, accessList)
		apiGroup.GET("/collections/:name/records/:id", h.GetRecord, authOptional, accessList)
		apiGroup.PATCH("/collections/:name/records/:id", h.UpdateRecord, authOptional, accessUpdate)
		apiGroup.DELETE("/collections/:name/records/:id", h.DeleteRecord, authOptional, accessDelete)

		// Tables (Generic/Dashboard endpoints) - Now PROTECTED
		apiGroup.POST("/tables/:name/rows", h.CreateRecord, authRequired)
		apiGroup.PATCH("/tables/:name/rows/:id", h.UpdateRecord, authRequired)
		apiGroup.DELETE("/tables/:name/rows/:id", h.DeleteRecord, authRequired)
		apiGroup.POST("/tables/:name/rows/bulk", h.BulkRowsAction, authRequired)
		apiGroup.POST("/tables/:name/import", h.ImportRecords, authRequired)
		apiGroup.POST("/tables/:name/columns", h.AddColumn, authRequired)           // New
		apiGroup.DELETE("/tables/:name/columns/:col", h.DeleteColumn, authRequired) // New
		apiGroup.GET("/tables/:name/views", h.ListTableViews, authRequired)
		apiGroup.POST("/tables/:name/views", h.CreateTableView, authRequired)
		apiGroup.PATCH("/tables/:name/views/:id", h.UpdateTableView, authRequired)
		apiGroup.DELETE("/tables/:name/views/:id", h.DeleteTableView, authRequired)
	}

	// Static Frontend (SPA)
	api.RegisterStaticRoutes(e)

	return e
}
