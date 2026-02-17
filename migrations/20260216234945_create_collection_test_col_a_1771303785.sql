-- OzyBase Auto-Generated Migration
-- Description: create_collection_test_col_a_1771303785

CREATE TABLE IF NOT EXISTS test_col_a_1771303785 (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	title TEXT,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW(),
	deleted_at TIMESTAMPTZ
)