-- OzyBase Auto-Generated Migration
-- Description: create_collection_test_col_b_1771304657

CREATE TABLE IF NOT EXISTS test_col_b_1771304657 (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	title TEXT,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW(),
	deleted_at TIMESTAMPTZ
)