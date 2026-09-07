-- ============================================================================
-- 028_admin_rbac_and_apm_monitoring.sql
-- 1. Creates public.app_admins table for dynamic role-based access control.
-- 2. Seeds initial Super Admin (parthdeshmukh291@gmail.com).
-- 3. Provides admin delegation functions: grant_admin_role, revoke_admin_role, list_app_admins.
-- 4. Exposes secure APM monitoring RPCs for Edge Functions & pg_cron execution logs.
-- ============================================================================

-- 1. Create app_admins Table
CREATE TABLE IF NOT EXISTS public.app_admins (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'ADMIN' CHECK (role IN ('SUPER_ADMIN', 'ADMIN')),
    assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for instant lookup
CREATE INDEX IF NOT EXISTS idx_app_admins_email ON public.app_admins(email);
CREATE INDEX IF NOT EXISTS idx_app_admins_user ON public.app_admins(user_id);

-- Enable RLS
ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service_role full access on app_admins" ON public.app_admins;
CREATE POLICY "Allow service_role full access on app_admins"
    ON public.app_admins FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- 2. Seed Initial Super Admin
DO $$
DECLARE
    v_target_user RECORD;
BEGIN
    -- Check if parthdeshmukh291@gmail.com exists in auth.users
    SELECT id, email INTO v_target_user 
    FROM auth.users 
    WHERE LOWER(email) = 'parthdeshmukh291@gmail.com' 
    LIMIT 1;

    IF v_target_user.id IS NOT NULL THEN
        INSERT INTO public.app_admins (user_id, email, role)
        VALUES (v_target_user.id, v_target_user.email, 'SUPER_ADMIN')
        ON CONFLICT (email) DO UPDATE SET role = 'SUPER_ADMIN';
    ELSE
        -- Fallback: Seed first created user in auth.users
        SELECT id, email INTO v_target_user 
        FROM auth.users 
        ORDER BY created_at ASC 
        LIMIT 1;

        IF v_target_user.id IS NOT NULL THEN
            INSERT INTO public.app_admins (user_id, email, role)
            VALUES (v_target_user.id, v_target_user.email, 'SUPER_ADMIN')
            ON CONFLICT (email) DO NOTHING;
        END IF;
    END IF;
END $$;

-- 3. Helper function: is_admin()
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
    -- Service role always has admin rights
    IF auth.role() = 'service_role' THEN
        RETURN TRUE;
    END IF;

    -- Check if authenticated user or token email exists in app_admins
    RETURN EXISTS (
        SELECT 1 FROM public.app_admins
        WHERE user_id = auth.uid() 
           OR LOWER(email) = LOWER(auth.jwt() ->> 'email')
    );
END;
$$;

-- Allow admins to read app_admins table via RLS
DROP POLICY IF EXISTS "Allow admins to read app_admins" ON public.app_admins;
CREATE POLICY "Allow admins to read app_admins"
    ON public.app_admins FOR SELECT
    USING (public.is_admin());

-- 4. Get Current Admin Status RPC (frontend bootstrap)
CREATE OR REPLACE FUNCTION public.get_admin_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_user_email TEXT;
    v_role TEXT;
    v_is_admin BOOLEAN := FALSE;
BEGIN
    v_user_email := auth.jwt() ->> 'email';
    
    IF v_user_email IS NULL AND auth.uid() IS NOT NULL THEN
        SELECT email INTO v_user_email FROM auth.users WHERE id = auth.uid();
    END IF;

    IF v_user_email IS NOT NULL THEN
        SELECT role INTO v_role
        FROM public.app_admins
        WHERE user_id = auth.uid() OR LOWER(email) = LOWER(v_user_email)
        LIMIT 1;
    END IF;

    IF v_role IS NOT NULL THEN
        v_is_admin := TRUE;
    END IF;

    RETURN jsonb_build_object(
        'is_admin', v_is_admin,
        'role', v_role,
        'email', v_user_email
    );
END;
$$;

-- 5. List All Admins RPC
CREATE OR REPLACE FUNCTION public.list_app_admins()
RETURNS TABLE (
    id BIGINT,
    user_id UUID,
    email TEXT,
    role TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied. Admin privileges required.';
    END IF;

    RETURN QUERY
    SELECT a.id, a.user_id, a.email, a.role, a.created_at
    FROM public.app_admins a
    ORDER BY (CASE WHEN a.role = 'SUPER_ADMIN' THEN 1 ELSE 2 END), a.created_at ASC;
END;
$$;

-- 6. Grant Admin Role RPC (Delegation)
CREATE OR REPLACE FUNCTION public.grant_admin_role(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_target_user_id UUID;
    v_clean_email TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied. Admin privileges required.';
    END IF;

    v_clean_email := LOWER(TRIM(p_email));
    IF v_clean_email IS NULL OR v_clean_email = '' THEN
        RAISE EXCEPTION 'Valid email address is required.';
    END IF;

    -- Lookup user in auth.users
    SELECT id INTO v_target_user_id FROM auth.users WHERE LOWER(email) = v_clean_email LIMIT 1;
    IF v_target_user_id IS NULL THEN
        RAISE EXCEPTION 'User % not found. They must register first before receiving admin access.', v_clean_email;
    END IF;

    -- Insert or update role to ADMIN
    INSERT INTO public.app_admins (user_id, email, role, assigned_by)
    VALUES (v_target_user_id, v_clean_email, 'ADMIN', auth.uid())
    ON CONFLICT (email) DO UPDATE
    SET role = 'ADMIN', user_id = v_target_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', format('Admin role granted to %s', v_clean_email),
        'email', v_clean_email
    );
END;
$$;

-- 7. Revoke Admin Role RPC
CREATE OR REPLACE FUNCTION public.revoke_admin_role(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_clean_email TEXT;
    v_target_role TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied. Admin privileges required.';
    END IF;

    v_clean_email := LOWER(TRIM(p_email));

    SELECT role INTO v_target_role FROM public.app_admins WHERE LOWER(email) = v_clean_email;
    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'Admin % does not exist.', v_clean_email;
    END IF;

    IF v_target_role = 'SUPER_ADMIN' THEN
        RAISE EXCEPTION 'Cannot revoke role from a SUPER_ADMIN.';
    END IF;

    DELETE FROM public.app_admins WHERE LOWER(email) = v_clean_email;

    RETURN jsonb_build_object(
        'success', true,
        'message', format('Admin role revoked from %s', v_clean_email)
    );
END;
$$;

-- 8. Allow Admins to View system_execution_logs
DROP POLICY IF EXISTS "Allow admins to view system_execution_logs" ON public.system_execution_logs;
CREATE POLICY "Allow admins to view system_execution_logs"
    ON public.system_execution_logs FOR SELECT
    USING (public.is_admin());

-- 9. APM Overview Metrics RPC
CREATE OR REPLACE FUNCTION public.get_admin_apm_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_total_runs INT := 0;
    v_success_runs INT := 0;
    v_failed_runs INT := 0;
    v_error_rate NUMERIC := 0;
    v_avg_duration NUMERIC := 0;
    v_max_duration INT := 0;
    v_active_crons INT := 0;
    v_cron_failures_24h INT := 0;
    v_function_breakdown JSONB;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied. Admin privileges required.';
    END IF;

    -- Edge Function 24h Aggregations
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'SUCCESS'),
        COUNT(*) FILTER (WHERE status = 'FAILED' OR response_status >= 400),
        COALESCE(ROUND(AVG(duration_ms)), 0),
        COALESCE(MAX(duration_ms), 0)
    INTO 
        v_total_runs, 
        v_success_runs, 
        v_failed_runs, 
        v_avg_duration, 
        v_max_duration
    FROM public.system_execution_logs
    WHERE created_at >= (NOW() - INTERVAL '24 hours');

    IF v_total_runs > 0 THEN
        v_error_rate := ROUND((v_failed_runs::numeric / v_total_runs::numeric) * 100, 2);
    END IF;

    -- Breakdown by function in last 24h
    SELECT COALESCE(jsonb_agg(f_sub), '[]'::jsonb) INTO v_function_breakdown
    FROM (
        SELECT 
            function_name,
            COUNT(*) AS total_runs,
            COUNT(*) FILTER (WHERE status = 'SUCCESS') AS success_runs,
            COUNT(*) FILTER (WHERE status = 'FAILED' OR response_status >= 400) AS failed_runs,
            ROUND(AVG(duration_ms)) AS avg_duration_ms,
            MAX(duration_ms) AS max_duration_ms,
            MAX(created_at) AS last_run_at
        FROM public.system_execution_logs
        WHERE created_at >= (NOW() - INTERVAL '24 hours')
        GROUP BY function_name
        ORDER BY total_runs DESC
    ) f_sub;

    -- Active pg_cron count
    SELECT COUNT(*) INTO v_active_crons
    FROM cron.job
    WHERE active = true;

    -- Cron failures in last 24h
    SELECT COUNT(*) INTO v_cron_failures_24h
    FROM cron.job_run_details
    WHERE status != 'succeeded'
      AND start_time >= (NOW() - INTERVAL '24 hours');

    RETURN jsonb_build_object(
        'total_runs_24h', v_total_runs,
        'success_runs_24h', v_success_runs,
        'failed_runs_24h', v_failed_runs,
        'error_rate_pct', v_error_rate,
        'avg_duration_ms', v_avg_duration,
        'max_duration_ms', v_max_duration,
        'active_crons_count', v_active_crons,
        'cron_failures_24h', v_cron_failures_24h,
        'function_breakdown', v_function_breakdown,
        'generated_at', NOW()
    );
END;
$$;

-- 10. Filtered & Paginated Execution Logs RPC
CREATE OR REPLACE FUNCTION public.get_admin_execution_logs(
    p_function_name TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_caller_type TEXT DEFAULT NULL,
    p_limit INT DEFAULT 50,
    p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_logs JSONB;
    v_total_count INT := 0;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied. Admin privileges required.';
    END IF;

    SELECT COUNT(*) INTO v_total_count
    FROM public.system_execution_logs l
    WHERE (p_function_name IS NULL OR l.function_name = p_function_name)
      AND (p_status IS NULL OR (
          CASE 
            WHEN p_status = 'FAILED' THEN (l.status = 'FAILED' OR l.response_status >= 400)
            ELSE l.status = p_status
          END
      ))
      AND (p_caller_type IS NULL OR l.caller_type = p_caller_type);

    SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb) INTO v_logs
    FROM (
        SELECT 
            l.id,
            l.function_name,
            l.caller_type,
            l.user_email,
            l.http_method,
            l.response_status,
            l.duration_ms,
            l.status,
            l.error_message,
            l.request_payload,
            l.response_data,
            l.created_at
        FROM public.system_execution_logs l
        WHERE (p_function_name IS NULL OR l.function_name = p_function_name)
          AND (p_status IS NULL OR (
              CASE 
                WHEN p_status = 'FAILED' THEN (l.status = 'FAILED' OR l.response_status >= 400)
                ELSE l.status = p_status
              END
          ))
          AND (p_caller_type IS NULL OR l.caller_type = p_caller_type)
        ORDER BY l.created_at DESC
        LIMIT LEAST(p_limit, 100)
        OFFSET p_offset
    ) sub;

    RETURN jsonb_build_object(
        'total', v_total_count,
        'logs', v_logs
    );
END;
$$;

-- 11. pg_cron Monitoring RPC
CREATE OR REPLACE FUNCTION public.get_admin_cron_monitoring(p_limit INT DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_jobs JSONB;
    v_runs JSONB;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied. Admin privileges required.';
    END IF;

    -- All scheduled cron jobs
    SELECT COALESCE(jsonb_agg(j_sub), '[]'::jsonb) INTO v_jobs
    FROM (
        SELECT 
            j.jobid,
            j.jobname,
            j.schedule,
            j.active,
            j.command
        FROM cron.job j
        ORDER BY j.jobid ASC
    ) j_sub;

    -- Recent cron runs
    SELECT COALESCE(jsonb_agg(r_sub), '[]'::jsonb) INTO v_runs
    FROM (
        SELECT 
            d.runid,
            d.jobid,
            COALESCE(j.jobname, 'job_' || d.jobid::text) AS jobname,
            d.status,
            d.return_message,
            d.start_time,
            d.end_time,
            ROUND(EXTRACT(EPOCH FROM (d.end_time - d.start_time)) * 1000) AS duration_ms
        FROM cron.job_run_details d
        LEFT JOIN cron.job j ON j.jobid = d.jobid
        ORDER BY d.start_time DESC
        LIMIT LEAST(p_limit, 100)
    ) r_sub;

    RETURN jsonb_build_object(
        'jobs', v_jobs,
        'runs', v_runs
    );
END;
$$;

-- 12. Permissions
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_status() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_app_admins() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_admin_role(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_admin_role(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_apm_overview() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_execution_logs(TEXT, TEXT, TEXT, INT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_cron_monitoring(INT) TO authenticated, service_role;
