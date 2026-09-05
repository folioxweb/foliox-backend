-- ============================================================================
-- 025_add_audit_and_logging_tables.sql
-- 1. Sets database and role default timezone to Indian Standard Time (Asia/Kolkata).
-- 2. Creates system_execution_logs table for all Edge Functions & Cron invocations.
-- 3. Creates user_audit_logs table for financial and security user state changes.
-- 4. Schedules automated 60-day log pruning cron.
-- 5. Configures Row Level Security (RLS) policies.
-- ============================================================================

-- 1. Set Database Default Timezone to IST (Asia/Kolkata)
-- Ensures existing timestamp columns display IST (+05:30) directly without manual conversion.
ALTER DATABASE postgres SET timezone TO 'Asia/Kolkata';
ALTER ROLE postgres SET timezone TO 'Asia/Kolkata';
ALTER ROLE authenticated SET timezone TO 'Asia/Kolkata';
ALTER ROLE anon SET timezone TO 'Asia/Kolkata';
ALTER ROLE service_role SET timezone TO 'Asia/Kolkata';

-- 2. Create system_execution_logs Table (Unified for Edge Functions & pg_cron)
CREATE TABLE IF NOT EXISTS public.system_execution_logs (
    id BIGSERIAL PRIMARY KEY,
    function_name TEXT NOT NULL,
    caller_type TEXT NOT NULL CHECK (caller_type IN ('CRON', 'USER', 'ANON', 'SYSTEM')),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_email TEXT,
    http_method TEXT NOT NULL DEFAULT 'POST',
    request_payload JSONB,
    response_status INT NOT NULL,
    response_data JSONB,
    duration_ms INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'SKIPPED')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sys_exec_fn_status ON public.system_execution_logs(function_name, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sys_exec_created ON public.system_execution_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sys_exec_errors ON public.system_execution_logs(response_status, created_at DESC) WHERE response_status >= 400;
CREATE INDEX IF NOT EXISTS idx_sys_exec_user ON public.system_execution_logs(user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- 3. Create user_audit_logs Table (Immutable User Action & Financial Audit Trail)
CREATE TABLE IF NOT EXISTS public.user_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_email TEXT,
    action TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('AUTH', 'PORTFOLIO', 'WATCHLIST', 'PAPER_TRADE', 'SETTINGS', 'AI')),
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    old_state JSONB,
    new_state JSONB,
    client_ip TEXT,
    user_agent TEXT,
    status TEXT NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'FAILED')),
    failure_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_audit_user ON public.user_audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_audit_action ON public.user_audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_audit_category ON public.user_audit_logs(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_audit_created ON public.user_audit_logs(created_at DESC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.system_execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow service_role full read/write on both tables
DROP POLICY IF EXISTS "Allow service_role full access on system_execution_logs" ON public.system_execution_logs;
CREATE POLICY "Allow service_role full access on system_execution_logs" 
    ON public.system_execution_logs FOR ALL 
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Allow service_role full access on user_audit_logs" ON public.user_audit_logs;
CREATE POLICY "Allow service_role full access on user_audit_logs" 
    ON public.user_audit_logs FOR ALL 
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Allow authenticated users to view only their own audit records
DROP POLICY IF EXISTS "Allow users to view own audit logs" ON public.user_audit_logs;
CREATE POLICY "Allow users to view own audit logs" 
    ON public.user_audit_logs FOR SELECT 
    USING (auth.uid() = user_id);

-- 5. Automated Database Audit Trigger for Financial & Portfolio Mutations
CREATE OR REPLACE FUNCTION public.fn_audit_log_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_user_email TEXT;
    v_category TEXT;
    v_entity_id TEXT;
    v_action TEXT;
    v_old JSONB := NULL;
    v_new JSONB := NULL;
BEGIN
    -- Determine user id (from Supabase auth context or row data)
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            BEGIN
                v_user_id := (to_jsonb(NEW) ->> 'user_id')::uuid;
            EXCEPTION WHEN OTHERS THEN
                v_user_id := NULL;
            END;
        ELSIF TG_OP = 'DELETE' THEN
            BEGIN
                v_user_id := (to_jsonb(OLD) ->> 'user_id')::uuid;
            EXCEPTION WHEN OTHERS THEN
                v_user_id := NULL;
            END;
        END IF;
    END IF;

    -- Lookup user email if user_id is resolved
    IF v_user_id IS NOT NULL THEN
        SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
    END IF;

    -- Determine category based on table
    IF TG_TABLE_NAME IN ('transactions', 'fixed_deposits') THEN
        v_category := 'PORTFOLIO';
    ELSIF TG_TABLE_NAME IN ('watchlist_items') THEN
        v_category := 'WATCHLIST';
    ELSIF TG_TABLE_NAME IN ('paper_trades', 'paper_portfolio') THEN
        v_category := 'PAPER_TRADE';
    ELSE
        v_category := 'SETTINGS';
    END IF;

    -- Build payload diff
    IF TG_OP = 'INSERT' THEN
        v_action := TG_TABLE_NAME || '_INSERT';
        v_new := to_jsonb(NEW);
        v_entity_id := COALESCE(v_new->>'id', v_new->>'transaction_id', v_new->>'fd_id', v_new->>'watchlist_id', v_new->>'asset_id');
    ELSIF TG_OP = 'UPDATE' THEN
        v_action := TG_TABLE_NAME || '_UPDATE';
        v_old := to_jsonb(OLD);
        v_new := to_jsonb(NEW);
        v_entity_id := COALESCE(v_new->>'id', v_new->>'transaction_id', v_new->>'fd_id', v_new->>'watchlist_id', v_new->>'asset_id');
    ELSIF TG_OP = 'DELETE' THEN
        v_action := TG_TABLE_NAME || '_DELETE';
        v_old := to_jsonb(OLD);
        v_entity_id := COALESCE(v_old->>'id', v_old->>'transaction_id', v_old->>'fd_id', v_old->>'watchlist_id', v_old->>'asset_id');
    END IF;

    -- Insert audit record safely
    INSERT INTO public.user_audit_logs (
        user_id,
        user_email,
        action,
        category,
        entity_type,
        entity_id,
        old_state,
        new_state,
        status
    ) VALUES (
        v_user_id,
        v_user_email,
        v_action,
        v_category,
        TG_TABLE_NAME,
        v_entity_id,
        v_old,
        v_new,
        'SUCCESS'
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Resilient: never block the primary business transaction if auditing encounters an error
    RAISE WARNING 'fn_audit_log_change error: %', SQLERRM;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- Apply triggers conditionally if tables exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'transactions') THEN
        DROP TRIGGER IF EXISTS trg_audit_transactions ON public.transactions;
        CREATE TRIGGER trg_audit_transactions
            AFTER INSERT OR UPDATE OR DELETE ON public.transactions
            FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_change();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fixed_deposits') THEN
        DROP TRIGGER IF EXISTS trg_audit_fixed_deposits ON public.fixed_deposits;
        CREATE TRIGGER trg_audit_fixed_deposits
            AFTER INSERT OR UPDATE OR DELETE ON public.fixed_deposits
            FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_change();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'watchlist_items') THEN
        DROP TRIGGER IF EXISTS trg_audit_watchlist_items ON public.watchlist_items;
        CREATE TRIGGER trg_audit_watchlist_items
            AFTER INSERT OR UPDATE OR DELETE ON public.watchlist_items
            FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_change();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'paper_trades') THEN
        DROP TRIGGER IF EXISTS trg_audit_paper_trades ON public.paper_trades;
        CREATE TRIGGER trg_audit_paper_trades
            AFTER INSERT OR UPDATE OR DELETE ON public.paper_trades
            FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log_change();
    END IF;
END $$;

-- 6. Automated 60-Day Log Pruning Maintenance Job (Runs every Sunday at 00:00 IST / 18:30 UTC Saturday)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('prune-old-logs') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-old-logs');
        PERFORM cron.schedule(
            'prune-old-logs',
            '30 18 * * 6', -- 18:30 UTC Saturday = 00:00 IST Sunday
            $cmd$
                DELETE FROM public.system_execution_logs WHERE created_at < NOW() - INTERVAL '60 days';
            $cmd$
        );
    END IF;
END $$;

