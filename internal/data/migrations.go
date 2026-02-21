package data

import (
	"context"
	"fmt"
	"log"
)

func (db *DB) RunMigrations(ctx context.Context) error {
	migrations := []string{
		`CREATE SCHEMA IF NOT EXISTS auth`,
		`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
			SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
		$$ LANGUAGE SQL STABLE`,

		// Internal schemas and tables
		`CREATE TABLE IF NOT EXISTS _v_users (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			email VARCHAR(255) UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			role VARCHAR(20) DEFAULT 'user',
			is_verified BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Storage Buckets
		`CREATE TABLE IF NOT EXISTS _v_buckets (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) UNIQUE NOT NULL,
			public BOOLEAN DEFAULT FALSE,
			rls_enabled BOOLEAN DEFAULT TRUE,
			rls_rule TEXT DEFAULT 'auth.uid() = owner_id',
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Storage Objects (Metadata for files)
		`CREATE TABLE IF NOT EXISTS _v_storage_objects (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			bucket_id UUID REFERENCES _v_buckets(id) ON DELETE CASCADE,
			owner_id UUID REFERENCES _v_users(id) ON DELETE SET NULL,
			name TEXT NOT NULL,
			size BIGINT NOT NULL,
			content_type VARCHAR(100),
			path TEXT NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE(bucket_id, name)
		)`,

		// Edge Functions
		`CREATE TABLE IF NOT EXISTS _v_functions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) UNIQUE NOT NULL,
			script TEXT NOT NULL,
			status VARCHAR(20) DEFAULT 'active',
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Webhooks
		`CREATE TABLE IF NOT EXISTS _v_webhooks (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255),
			url TEXT NOT NULL,
			events TEXT NOT NULL, -- comma separated list of "table:action" or just "table"
			secret TEXT,
			is_active BOOLEAN DEFAULT TRUE,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Collections Metadata
		`CREATE TABLE IF NOT EXISTS _v_collections (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) UNIQUE NOT NULL,
			display_name VARCHAR(255),
			schema_def JSONB NOT NULL,
			list_rule VARCHAR(50) DEFAULT 'auth',
			create_rule VARCHAR(50) DEFAULT 'admin',
			update_rule VARCHAR(50) DEFAULT 'admin',
			delete_rule VARCHAR(50) DEFAULT 'admin',
			rls_enabled BOOLEAN DEFAULT FALSE,
			rls_rule TEXT DEFAULT 'auth.uid() = owner_id',
			realtime_enabled BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Cron Jobs
		`CREATE TABLE IF NOT EXISTS _v_cron_jobs (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) UNIQUE NOT NULL,
			schedule TEXT NOT NULL, -- Cron syntax: "* * * * *"
			command TEXT NOT NULL,  -- SQL command or script reference
			is_active BOOLEAN DEFAULT TRUE,
			last_run TIMESTAMPTZ,
			next_run TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Audit Logs with Geolocation
		`CREATE TABLE IF NOT EXISTS _v_audit_logs (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID REFERENCES _v_users(id) ON DELETE SET NULL,
			ip_address VARCHAR(45),
			method VARCHAR(10),
			path TEXT,
			status INTEGER,
			latency_ms BIGINT,
			country VARCHAR(100),
			city VARCHAR(100),
			user_agent TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON _v_audit_logs(created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON _v_audit_logs(status)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_logs_path ON _v_audit_logs(path)`,

		// IP Geolocation Cache
		`CREATE TABLE IF NOT EXISTS _v_ip_geo (
			ip_address VARCHAR(45) PRIMARY KEY,
			country VARCHAR(100),
			city VARCHAR(100),
			lat FLOAT,
			lon FLOAT,
			last_updated TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Security Policies (e.g., Geo-fencing)
		`CREATE TABLE IF NOT EXISTS _v_security_policies (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			type VARCHAR(50) UNIQUE NOT NULL,
			config JSONB NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Security Alerts (Geographical Breaches, etc.)
		`CREATE TABLE IF NOT EXISTS _v_security_alerts (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			type VARCHAR(50) NOT NULL,
			severity VARCHAR(20) DEFAULT 'critical',
			message TEXT,
			metadata JSONB NOT NULL DEFAULT '{}',
			is_resolved BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Security Notification Recipients
		`CREATE TABLE IF NOT EXISTS _v_security_notification_recipients (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			email VARCHAR(255) NOT NULL,
			alert_types TEXT[] DEFAULT ARRAY['geo_breach', 'unauthorized_access', 'rate_limit_exceeded'],
			is_active BOOLEAN DEFAULT TRUE,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Two-Factor Authentication
		`CREATE TABLE IF NOT EXISTS _v_user_2fa (
			user_id UUID PRIMARY KEY REFERENCES _v_users(id) ON DELETE CASCADE,
			secret VARCHAR(255) NOT NULL,
			is_enabled BOOLEAN DEFAULT FALSE,
			backup_codes TEXT[],
			created_at TIMESTAMPTZ DEFAULT NOW(),
			last_used_at TIMESTAMPTZ
		)`,

		// Webhook Integrations (Slack, Discord, SIEM)
		`CREATE TABLE IF NOT EXISTS _v_integrations (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) NOT NULL,
			type VARCHAR(50) NOT NULL,
			webhook_url TEXT NOT NULL,
			config JSONB,
			is_active BOOLEAN DEFAULT TRUE,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			last_triggered_at TIMESTAMPTZ
		)`,

		// IP Firewall Rules (Whitelist/Blacklist)
		`CREATE TABLE IF NOT EXISTS _v_ip_rules (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			ip_address VARCHAR(45) NOT NULL UNIQUE,
			rule_type VARCHAR(10) NOT NULL CHECK (rule_type IN ('ALLOW', 'BLOCK')),
			reason TEXT,
			expires_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			created_by VARCHAR(255)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ip_rules_ip ON _v_ip_rules(ip_address)`,

		// Realtime & Hooks Trigger Function
		`CREATE OR REPLACE FUNCTION notify_event() RETURNS TRIGGER AS $$
		DECLARE
			payload JSON;
		BEGIN
			payload = json_build_object(
				'table', TG_TABLE_NAME,
				'action', TG_OP,
				'record', CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD) ELSE row_to_json(NEW) END,
				'old', CASE WHEN TG_OP = 'UPDATE' THEN row_to_json(OLD) ELSE NULL END
			);
			PERFORM pg_notify('ozy_events', payload::text);
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;`,

		// Identities (OAuth)
		`CREATE TABLE IF NOT EXISTS _v_identities (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID REFERENCES _v_users(id) ON DELETE CASCADE,
			provider VARCHAR(50) NOT NULL,
			provider_id TEXT NOT NULL,
			identity_data JSONB,
			last_signin_at TIMESTAMPTZ DEFAULT NOW(),
			created_at TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE(provider, provider_id)
		)`,

		// Verification Tokens (Email)
		`CREATE TABLE IF NOT EXISTS _v_verification_tokens (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID REFERENCES _v_users(id) ON DELETE CASCADE,
			token TEXT NOT NULL UNIQUE,
			expires_at TIMESTAMPTZ NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Password Reset Tokens
		`CREATE TABLE IF NOT EXISTS _v_reset_tokens (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID REFERENCES _v_users(id) ON DELETE CASCADE,
			token TEXT NOT NULL UNIQUE,
			expires_at TIMESTAMPTZ NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Migrations History
		`CREATE TABLE IF NOT EXISTS _v_migrations_history (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			file_name VARCHAR(255) UNIQUE NOT NULL,
			applied_at TIMESTAMPTZ DEFAULT NOW(),
			description TEXT
		)`,

		// Safety Schema Evolution (Repair missing columns in existing deployments)
		`ALTER TABLE _v_collections ADD COLUMN IF NOT EXISTS rls_enabled BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE _v_collections ADD COLUMN IF NOT EXISTS rls_rule TEXT DEFAULT 'auth.uid() = owner_id'`,
		`ALTER TABLE _v_collections ADD COLUMN IF NOT EXISTS update_rule VARCHAR(50) DEFAULT 'admin'`,
		`ALTER TABLE _v_collections ADD COLUMN IF NOT EXISTS delete_rule VARCHAR(50) DEFAULT 'admin'`,
		`ALTER TABLE _v_collections ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)`,
		`UPDATE _v_collections SET display_name = name WHERE display_name IS NULL OR display_name = ''`,
		`ALTER TABLE _v_users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE _v_security_alerts ADD COLUMN IF NOT EXISTS message TEXT`,
		`ALTER TABLE _v_security_alerts ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'`,
		`ALTER TABLE _v_collections ADD COLUMN IF NOT EXISTS realtime_enabled BOOLEAN DEFAULT FALSE`,

		// API Keys (Enterprise Phase 1)
		`CREATE TABLE IF NOT EXISTS _v_api_keys (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) NOT NULL,
			key_hash TEXT UNIQUE NOT NULL,
			prefix VARCHAR(10) NOT NULL, -- OZY_... for visibility
			role VARCHAR(20) DEFAULT 'anon', -- 'anon' or 'service_role'
			is_active BOOLEAN DEFAULT TRUE,
			expires_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			last_used_at TIMESTAMPTZ
		)`,
		`CREATE INDEX IF NOT EXISTS idx_api_keys_active ON _v_api_keys(is_active)`,
		`ALTER TABLE _v_api_keys ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES _v_users(id) ON DELETE SET NULL`,

		// API Key Lifecycle Events (Enterprise Security Program v2)
		`CREATE TABLE IF NOT EXISTS _v_api_key_events (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			api_key_id UUID,
			workspace_id UUID REFERENCES _v_workspaces(id) ON DELETE CASCADE,
			action VARCHAR(30) NOT NULL CHECK (action IN ('create', 'rotate', 'toggle', 'delete')),
			actor_user_id UUID REFERENCES _v_users(id) ON DELETE SET NULL,
			details JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_api_key_events_created_at ON _v_api_key_events(created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_api_key_events_api_key_id ON _v_api_key_events(api_key_id)`,

		// Metrics Cache (Prometheus)
		`CREATE TABLE IF NOT EXISTS _v_metrics_cache (
			id VARCHAR(100) PRIMARY KEY,
			value DOUBLE PRECISION NOT NULL,
			labels JSONB DEFAULT '{}',
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Workspaces (Enterprise Phase 2)
		`CREATE TABLE IF NOT EXISTS _v_workspaces (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) NOT NULL,
			slug VARCHAR(255) UNIQUE NOT NULL,
			config JSONB DEFAULT '{}',
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Workspace Membership
		`CREATE TABLE IF NOT EXISTS _v_workspace_members (
			workspace_id UUID REFERENCES _v_workspaces(id) ON DELETE CASCADE,
			user_id UUID REFERENCES _v_users(id) ON DELETE CASCADE,
			role VARCHAR(20) DEFAULT 'member', -- 'owner', 'admin', 'member', 'viewer'
			joined_at TIMESTAMPTZ DEFAULT NOW(),
			PRIMARY KEY (workspace_id, user_id)
		)`,

		// Session Tracking (Security Depth)
		`CREATE TABLE IF NOT EXISTS _v_sessions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID REFERENCES _v_users(id) ON DELETE CASCADE,
			token_hash TEXT UNIQUE NOT NULL,
			ip_address VARCHAR(45),
			user_agent TEXT,
			is_mfa_verified BOOLEAN DEFAULT FALSE,
			expires_at TIMESTAMPTZ NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			last_used_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_user ON _v_sessions(user_id)`,

		// Scoping existing items to workspaces (Evolution)
		`ALTER TABLE _v_collections ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES _v_workspaces(id) ON DELETE CASCADE`,
		`ALTER TABLE _v_api_keys ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES _v_workspaces(id) ON DELETE CASCADE`,
	}

	for i, migration := range migrations {
		if _, err := db.Pool.Exec(ctx, migration); err != nil {
			return fmt.Errorf("migration %d failed: %w", i+1, err)
		}
	}

	log.Println("🛠️ Migrations completed successfully")
	return nil
}
