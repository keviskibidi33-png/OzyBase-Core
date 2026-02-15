-- OzyBase Auto-Generated Migration
-- Description: create_collection_test_types_1770866982847

CREATE TABLE IF NOT EXISTS test_types_1770866982847 (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID,
	col_text TEXT,
	col_int4 INT4,
	col_bool BOOL,
	col_jsonb JSONB,
	col_uuid UUID,
	col_date DATE,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW(),
	deleted_at TIMESTAMPTZ
)


		CREATE TRIGGER tr_notify_test_types_1770866982847
		AFTER INSERT OR UPDATE OR DELETE ON test_types_1770866982847
		FOR EACH ROW EXECUTE FUNCTION notify_event();
	