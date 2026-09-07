-- ============================================================================
-- 026_fix_watchlist_unique_constraint.sql
-- Replaces partial unique index on watchlist_items with a standard table constraint.
-- Enables PostgREST and Edge Function upserts via ON CONFLICT (user_id, symbol).
-- ============================================================================

DO $$
BEGIN
    -- 1. If constraint already exists, drop constraint first
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_user_watchlist_symbol'
    ) THEN
        ALTER TABLE public.watchlist_items DROP CONSTRAINT unique_user_watchlist_symbol;
    END IF;

    -- 2. If standalone index exists (e.g. from partial index in 013), drop index
    IF EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'unique_user_watchlist_symbol'
    ) THEN
        DROP INDEX public.unique_user_watchlist_symbol;
    END IF;

    -- 3. Add standard table-level unique constraint
    ALTER TABLE public.watchlist_items 
        ADD CONSTRAINT unique_user_watchlist_symbol UNIQUE (user_id, symbol);
END $$;
