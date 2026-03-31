package data

import (
	"context"
	"fmt"
	"log"
)

const migrationsAdvisoryLockKey int64 = 80900301

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
			max_file_size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (max_file_size_bytes >= 0),
			max_total_size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (max_total_size_bytes >= 0),
			lifecycle_delete_after_days INTEGER NOT NULL DEFAULT 0 CHECK (lifecycle_delete_after_days >= 0),
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
		`CREATE TABLE IF NOT EXISTS _v_storage_upload_sessions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			bucket_id UUID NOT NULL REFERENCES _v_buckets(id) ON DELETE CASCADE,
			owner_id UUID REFERENCES _v_users(id) ON DELETE SET NULL,
			name TEXT NOT NULL,
			size BIGINT NOT NULL CHECK (size >= 0),
			content_type VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
			storage_key TEXT NOT NULL,
			mode VARCHAR(20) NOT NULL DEFAULT 'stream' CHECK (mode IN ('stream', 'multipart')),
			chunk_size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (chunk_size_bytes >= 0),
			expires_at TIMESTAMPTZ NOT NULL,
			used_at TIMESTAMPTZ,
			completed_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_upload_sessions_storage_key ON _v_storage_upload_sessions(storage_key)`,
		`CREATE INDEX IF NOT EXISTS idx_storage_upload_sessions_expiry ON _v_storage_upload_sessions(expires_at, used_at)`,
		`CREATE TABLE IF NOT EXISTS _v_storage_upload_session_parts (
			session_id UUID NOT NULL REFERENCES _v_storage_upload_sessions(id) ON DELETE CASCADE,
			part_number INTEGER NOT NULL CHECK (part_number >= 1),
			size BIGINT NOT NULL CHECK (size >= 0),
			storage_path TEXT NOT NULL,
			uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (session_id, part_number)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_storage_upload_session_parts_uploaded_at ON _v_storage_upload_session_parts(uploaded_at DESC)`,

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
		`CREATE TABLE IF NOT EXISTS _v_admin_audit_events (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			request_id TEXT NOT NULL,
			action VARCHAR(120) NOT NULL,
			target TEXT,
			actor_user_id UUID REFERENCES _v_users(id) ON DELETE SET NULL,
			actor_role VARCHAR(30) NOT NULL DEFAULT 'unknown',
			workspace_id UUID,
			method VARCHAR(10) NOT NULL,
			path TEXT NOT NULL,
			route TEXT NOT NULL,
			status INTEGER NOT NULL,
			success BOOLEAN NOT NULL DEFAULT FALSE,
			duration_ms BIGINT NOT NULL DEFAULT 0,
			source_ip VARCHAR(45),
			user_agent TEXT,
			metadata JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_admin_audit_events_created_at ON _v_admin_audit_events(created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_admin_audit_events_actor ON _v_admin_audit_events(actor_user_id, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_admin_audit_events_action ON _v_admin_audit_events(action, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_admin_audit_events_status ON _v_admin_audit_events(status, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_admin_audit_events_workspace ON _v_admin_audit_events(workspace_id, created_at DESC)`,

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
		`CREATE TABLE IF NOT EXISTS _v_integration_deliveries (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			integration_id UUID NOT NULL REFERENCES _v_integrations(id) ON DELETE CASCADE,
			delivery_type VARCHAR(40) NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			headers JSONB NOT NULL DEFAULT '{}',
			status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'retry', 'delivered', 'dlq')),
			attempts INTEGER NOT NULL DEFAULT 0,
			max_attempts INTEGER NOT NULL DEFAULT 5,
			next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			last_error TEXT,
			last_status_code INTEGER,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW(),
			delivered_at TIMESTAMPTZ
		)`,
		`CREATE INDEX IF NOT EXISTS idx_integration_deliveries_status_next ON _v_integration_deliveries(status, next_attempt_at)`,
		`CREATE INDEX IF NOT EXISTS idx_integration_deliveries_integration_status ON _v_integration_deliveries(integration_id, status)`,
		`CREATE INDEX IF NOT EXISTS idx_integration_deliveries_created_at ON _v_integration_deliveries(created_at DESC)`,

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

		// Vector Search Config (pgvector runtime setup is applied via API endpoint)
		`CREATE TABLE IF NOT EXISTS _v_vector_config (
			id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
			dimension INTEGER NOT NULL DEFAULT 1536 CHECK (dimension >= 2 AND dimension <= 8192),
			metric VARCHAR(16) NOT NULL DEFAULT 'cosine' CHECK (metric IN ('cosine', 'l2', 'ip')),
			index_lists INTEGER NOT NULL DEFAULT 100 CHECK (index_lists >= 1 AND index_lists <= 32768),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`INSERT INTO _v_vector_config (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING`,

		// Extension Marketplace Catalog + Install State
		`CREATE TABLE IF NOT EXISTS _v_extension_marketplace (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			slug VARCHAR(120) UNIQUE NOT NULL,
			name VARCHAR(255) NOT NULL,
			extension_name VARCHAR(255) NOT NULL,
			kind VARCHAR(20) NOT NULL CHECK (kind IN ('postgres', 'wasm')),
			version VARCHAR(64) NOT NULL DEFAULT 'latest',
			description TEXT,
			homepage TEXT,
			repository TEXT,
			verified BOOLEAN NOT NULL DEFAULT TRUE,
			metadata JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_extension_marketplace_kind ON _v_extension_marketplace(kind, slug)`,
		`CREATE TABLE IF NOT EXISTS _v_extension_installations (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			marketplace_id UUID REFERENCES _v_extension_marketplace(id) ON DELETE CASCADE,
			slug VARCHAR(120) NOT NULL,
			extension_name VARCHAR(255) NOT NULL,
			kind VARCHAR(20) NOT NULL CHECK (kind IN ('postgres', 'wasm')),
			status VARCHAR(20) NOT NULL DEFAULT 'installed' CHECK (status IN ('installed', 'disabled', 'error')),
			installed_version VARCHAR(64),
			metadata JSONB NOT NULL DEFAULT '{}',
			installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(slug, kind)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_extension_installations_kind_status ON _v_extension_installations(kind, status, updated_at DESC)`,
		`INSERT INTO _v_extension_marketplace (slug, name, extension_name, kind, version, description, homepage, repository, verified, metadata)
		 VALUES
		  ('pgvector', 'pgvector', 'vector', 'postgres', 'latest', 'Vector similarity search for PostgreSQL', 'https://github.com/pgvector/pgvector', 'https://github.com/pgvector/pgvector', TRUE, '{"category":"ai"}'),
		  ('pg_trgm', 'pg_trgm', 'pg_trgm', 'postgres', 'latest', 'Text similarity and trigram indexing', 'https://www.postgresql.org/docs/current/pgtrgm.html', 'https://www.postgresql.org/docs/current/pgtrgm.html', TRUE, '{"category":"search"}'),
		  ('pg_stat_statements', 'pg_stat_statements', 'pg_stat_statements', 'postgres', 'latest', 'Track execution statistics of SQL statements', 'https://www.postgresql.org/docs/current/pgstatstatements.html', 'https://www.postgresql.org/docs/current/pgstatstatements.html', TRUE, '{"category":"observability"}'),
		  ('postgis', 'PostGIS', 'postgis', 'postgres', 'latest', 'Spatial and geographic objects support', 'https://postgis.net/', 'https://github.com/postgis/postgis', TRUE, '{"category":"geo"}'),
		  ('wasm-core-runtime', 'WASM Core Runtime', 'wasm_core_runtime', 'wasm', 'v1', 'Native WASM runtime support for Edge Functions', 'https://webassembly.org/', 'https://webassembly.org/', TRUE, '{"category":"edge"}')
		 ON CONFLICT (slug) DO UPDATE SET
		  name = EXCLUDED.name,
		  extension_name = EXCLUDED.extension_name,
		  kind = EXCLUDED.kind,
		  version = EXCLUDED.version,
		  description = EXCLUDED.description,
		  homepage = EXCLUDED.homepage,
		  repository = EXCLUDED.repository,
		  verified = EXCLUDED.verified,
		  metadata = EXCLUDED.metadata,
		  updated_at = NOW()`,

		// Safety Schema Evolution (Repair missing columns in existing deployments)
		`ALTER TABLE _v_functions ADD COLUMN IF NOT EXISTS runtime VARCHAR(20) NOT NULL DEFAULT 'js'`,
		`ALTER TABLE _v_functions ADD COLUMN IF NOT EXISTS wasm_module BYTEA`,
		`ALTER TABLE _v_functions ADD COLUMN IF NOT EXISTS timeout_ms INTEGER NOT NULL DEFAULT 2000`,
		`ALTER TABLE _v_functions ADD COLUMN IF NOT EXISTS entrypoint VARCHAR(64) NOT NULL DEFAULT '_start'`,
		`ALTER TABLE _v_functions DROP CONSTRAINT IF EXISTS _v_functions_runtime_check`,
		`ALTER TABLE _v_functions ADD CONSTRAINT _v_functions_runtime_check CHECK (runtime IN ('js', 'wasm'))`,
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
		`ALTER TABLE _v_buckets ADD COLUMN IF NOT EXISTS max_file_size_bytes BIGINT NOT NULL DEFAULT 0`,
		`ALTER TABLE _v_buckets ADD COLUMN IF NOT EXISTS max_total_size_bytes BIGINT NOT NULL DEFAULT 0`,
		`ALTER TABLE _v_buckets ADD COLUMN IF NOT EXISTS lifecycle_delete_after_days INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE _v_buckets DROP CONSTRAINT IF EXISTS _v_buckets_max_file_size_bytes_check`,
		`ALTER TABLE _v_buckets ADD CONSTRAINT _v_buckets_max_file_size_bytes_check CHECK (max_file_size_bytes >= 0)`,
		`ALTER TABLE _v_buckets DROP CONSTRAINT IF EXISTS _v_buckets_max_total_size_bytes_check`,
		`ALTER TABLE _v_buckets ADD CONSTRAINT _v_buckets_max_total_size_bytes_check CHECK (max_total_size_bytes >= 0)`,
		`ALTER TABLE _v_buckets DROP CONSTRAINT IF EXISTS _v_buckets_lifecycle_delete_after_days_check`,
		`ALTER TABLE _v_buckets ADD CONSTRAINT _v_buckets_lifecycle_delete_after_days_check CHECK (lifecycle_delete_after_days >= 0)`,
		`ALTER TABLE _v_storage_upload_sessions ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'stream'`,
		`ALTER TABLE _v_storage_upload_sessions ADD COLUMN IF NOT EXISTS chunk_size_bytes BIGINT NOT NULL DEFAULT 0`,
		`ALTER TABLE _v_storage_upload_sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
		`ALTER TABLE _v_storage_upload_sessions DROP CONSTRAINT IF EXISTS _v_storage_upload_sessions_mode_check`,
		`ALTER TABLE _v_storage_upload_sessions ADD CONSTRAINT _v_storage_upload_sessions_mode_check CHECK (mode IN ('stream', 'multipart'))`,
		`ALTER TABLE _v_storage_upload_sessions DROP CONSTRAINT IF EXISTS _v_storage_upload_sessions_chunk_size_bytes_check`,
		`ALTER TABLE _v_storage_upload_sessions ADD CONSTRAINT _v_storage_upload_sessions_chunk_size_bytes_check CHECK (chunk_size_bytes >= 0)`,

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
		`ALTER TABLE _v_api_keys ADD COLUMN IF NOT EXISTS key_group_id UUID`,
		`UPDATE _v_api_keys SET key_group_id = id WHERE key_group_id IS NULL`,
		`ALTER TABLE _v_api_keys ADD COLUMN IF NOT EXISTS key_version INTEGER NOT NULL DEFAULT 1`,
		`ALTER TABLE _v_api_keys ADD COLUMN IF NOT EXISTS rotated_to_key_id UUID REFERENCES _v_api_keys(id) ON DELETE SET NULL`,
		`ALTER TABLE _v_api_keys ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ`,
		`ALTER TABLE _v_api_keys ADD COLUMN IF NOT EXISTS valid_after TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
		`ALTER TABLE _v_api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ`,
		`ALTER TABLE _v_api_keys ADD COLUMN IF NOT EXISTS managed_kind VARCHAR(20) NOT NULL DEFAULT 'custom'`,
		`ALTER TABLE _v_api_keys ADD COLUMN IF NOT EXISTS secret_ciphertext TEXT`,
		`UPDATE _v_api_keys SET managed_kind = 'custom' WHERE managed_kind IS NULL OR managed_kind = ''`,
		`ALTER TABLE _v_api_keys DROP CONSTRAINT IF EXISTS _v_api_keys_managed_kind_check`,
		`ALTER TABLE _v_api_keys ADD CONSTRAINT _v_api_keys_managed_kind_check CHECK (managed_kind IN ('custom', 'essential'))`,
		`CREATE INDEX IF NOT EXISTS idx_api_keys_group_version ON _v_api_keys(key_group_id, key_version DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_api_keys_auth_lookup ON _v_api_keys(key_hash, is_active, valid_after, expires_at, grace_until, revoked_at)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_active_essential_role ON _v_api_keys(role) WHERE managed_kind = 'essential' AND is_active = TRUE AND revoked_at IS NULL`,

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
		`CREATE TABLE IF NOT EXISTS _v_secrets (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			key VARCHAR(255) UNIQUE NOT NULL,
			value TEXT NOT NULL,
			description TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS _v_email_templates (
			template_type VARCHAR(64) PRIMARY KEY,
			subject TEXT NOT NULL,
			body TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`INSERT INTO _v_email_templates (template_type, subject, body, description)
		 VALUES
		  ('verification', 'Verify your {{app_name}} account', 'Click here to verify your account: {{action_link}}\n\nToken: {{token}}\n\nThanks,\n{{app_name}}', 'Verification email used after signup'),
		  ('password_reset', 'Reset your {{app_name}} password', 'Click here to reset your password: {{action_link}}\n\nToken: {{token}}\n\nIf you did not request this, you can ignore this email.\n\n{{app_name}}', 'Password recovery email'),
		  ('workspace_invite', 'Invitation to join {{workspace_name}} on {{app_name}}', '{{inviter_email}} invited you to collaborate on {{workspace_name}}.\n\nSign in to {{app_name}} to get started.', 'Workspace collaboration invite'),
		  ('security_alert', 'Security alert on {{app_name}}: {{alert_type}}', 'A security event was detected.\n\nType: {{alert_type}}\nDetails: {{details}}\n\nPlease review your dashboard immediately.', 'Operational security notification')
		 ON CONFLICT (template_type) DO NOTHING`,

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
		`CREATE INDEX IF NOT EXISTS idx_collections_workspace_id ON _v_collections(workspace_id)`,
		`CREATE INDEX IF NOT EXISTS idx_collections_updated_at ON _v_collections(updated_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_api_keys_workspace_id ON _v_api_keys(workspace_id)`,
		`CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON _v_workspace_members(user_id)`,

		// SLO History (Observability + Alerting)
		`CREATE TABLE IF NOT EXISTS _v_slo_history (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			window_minutes INTEGER NOT NULL,
			total_requests BIGINT NOT NULL DEFAULT 0,
			successful_requests BIGINT NOT NULL DEFAULT 0,
			server_errors BIGINT NOT NULL DEFAULT 0,
			availability_pct DOUBLE PRECISION NOT NULL DEFAULT 100,
			error_rate_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
			latency_p95_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
			thresholds JSONB NOT NULL DEFAULT '{}',
			breaches JSONB NOT NULL DEFAULT '{}'
		)`,
		`CREATE INDEX IF NOT EXISTS idx_slo_history_recorded_at ON _v_slo_history(recorded_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_slo_history_breach ON _v_slo_history(((breaches->>'breached')::boolean), recorded_at DESC)`,

		// RLS Coverage History (Enterprise Governance)
		`CREATE TABLE IF NOT EXISTS _v_rls_coverage_history (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			total_tables INTEGER NOT NULL,
			fully_covered INTEGER NOT NULL,
			coverage_ratio DOUBLE PRECISION NOT NULL,
			details JSONB NOT NULL DEFAULT '[]'
		)`,
		`CREATE INDEX IF NOT EXISTS idx_rls_coverage_history_recorded_at ON _v_rls_coverage_history(recorded_at DESC)`,
		`CREATE TABLE IF NOT EXISTS _v_query_explain_samples (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			endpoint TEXT NOT NULL,
			table_name TEXT,
			sample_query TEXT NOT NULL,
			plan_summary TEXT,
			has_seq_scan BOOLEAN NOT NULL DEFAULT FALSE,
			estimated_rows BIGINT NOT NULL DEFAULT 0,
			recommendation JSONB NOT NULL DEFAULT '{}',
			recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_query_explain_samples_endpoint_time ON _v_query_explain_samples(endpoint, recorded_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_query_explain_samples_table_time ON _v_query_explain_samples(table_name, recorded_at DESC)`,
	}

	conn, err := db.Pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("failed to acquire migration connection: %w", err)
	}
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin migration transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", migrationsAdvisoryLockKey); err != nil {
		return fmt.Errorf("failed to acquire migration lock: %w", err)
	}

	for i, migration := range migrations {
		if _, err := tx.Exec(ctx, migration); err != nil {
			return fmt.Errorf("migration %d failed: %w", i+1, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit migrations: %w", err)
	}

	log.Println("🛠️ Migrations completed successfully")
	return nil
}
