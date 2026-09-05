-- ============================================================================
-- 026_fix_watchlist_unique_constraint.sql
-- Replaces partial unique index on watchlist_items with a standard table constraint.
-- Enables PostgREST and Edge Function upserts via ON CONFLICT (user_id, symbol).
-- ============================================================================

-- 1. Drop the partial index if present
DROP INDEX IF EXISTS public.unique_user_watchlist_symbol;

-- 2. Drop existing constraint if present
ALTER TABLE public.watchlist_items 
    DROP CONSTRAINT IF EXISTS unique_user_watchlist_symbol;

-- 3. Add standard table-level unique constraint
ALTER TABLE public.watchlist_items 
    ADD CONSTRAINT unique_user_watchlist_symbol UNIQUE (user_id, symbol);
