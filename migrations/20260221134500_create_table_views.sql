-- Table views for Table Editor (saved filters/sorts/search)
CREATE TABLE IF NOT EXISTS _v_table_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    workspace_id UUID NULL,
    table_name TEXT NOT NULL,
    name TEXT NOT NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_table_views_user_table
    ON _v_table_views (user_id, table_name);

CREATE INDEX IF NOT EXISTS idx_table_views_workspace
    ON _v_table_views (workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_table_views_name
    ON _v_table_views (user_id, workspace_id, table_name, name);
