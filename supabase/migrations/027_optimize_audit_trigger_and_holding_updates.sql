-- ============================================================================
-- 027_optimize_audit_trigger_and_holding_updates.sql
-- Optimizes fn_audit_log_change to read email from JWT directly, avoiding
-- synchronous table queries to auth.users during high-frequency mutations.
-- ============================================================================

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
    -- 1. Fast resolve user id from Supabase auth session or row
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

    -- 2. Fast resolve email: read from JWT session first (0ms), fallback to table only if needed
    BEGIN
        v_user_email := auth.jwt() ->> 'email';
    EXCEPTION WHEN OTHERS THEN
        v_user_email := NULL;
    END;

    IF v_user_email IS NULL AND v_user_id IS NOT NULL THEN
        SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
    END IF;

    -- 3. Determine category based on table
    IF TG_TABLE_NAME IN ('transactions', 'fixed_deposits') THEN
        v_category := 'PORTFOLIO';
    ELSIF TG_TABLE_NAME IN ('watchlist_items') THEN
        v_category := 'WATCHLIST';
    ELSIF TG_TABLE_NAME IN ('paper_trades', 'paper_portfolio') THEN
        v_category := 'PAPER_TRADE';
    ELSE
        v_category := 'SETTINGS';
    END IF;

    -- 4. Build payload diff
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

    -- 5. Insert audit record safely
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
    -- Resilient: never block the primary transaction if auditing encounters an issue
    RAISE WARNING 'fn_audit_log_change error: %', SQLERRM;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;
