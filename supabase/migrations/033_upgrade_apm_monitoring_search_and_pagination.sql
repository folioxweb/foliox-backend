-- Migration: 033_upgrade_apm_monitoring_search_and_pagination.sql
-- Description: Adds search, pagination, and failure filtering to pg_cron and execution log monitoring

-- Drop old signatures to avoid parameter mismatch in PostgREST schema cache
DROP FUNCTION IF EXISTS public.get_admin_cron_monitoring(integer);
DROP FUNCTION IF EXISTS public.get_admin_execution_logs(text, text, text, integer, integer);

-- 1. Upgraded get_admin_cron_monitoring with pagination, failure filter, and multi-column search
CREATE OR REPLACE FUNCTION public.get_admin_cron_monitoring(
    p_limit integer DEFAULT 50, 
    p_offset integer DEFAULT 0, 
    p_failure_only boolean DEFAULT false, 
    p_search text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    DECLARE
        v_jobs JSONB;
        v_runs JSONB;
        v_total_runs INT := 0;
        v_search TEXT := NULLIF(TRIM(p_search), '');
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

        -- Total count of runs matching filter and search
        SELECT COUNT(*) INTO v_total_runs
        FROM cron.job_run_details d
        LEFT JOIN cron.job j ON j.jobid = d.jobid
        WHERE (NOT p_failure_only OR d.status != 'succeeded')
          AND (v_search IS NULL OR (
              COALESCE(j.jobname, 'job_' || d.jobid::text) ILIKE '%' || v_search || '%' OR
              COALESCE(d.return_message, '') ILIKE '%' || v_search || '%' OR
              COALESCE(d.command, '') ILIKE '%' || v_search || '%' OR
              d.status ILIKE '%' || v_search || '%' OR
              d.runid::text ILIKE '%' || v_search || '%' OR
              d.jobid::text ILIKE '%' || v_search || '%'
          ));

        -- Recent cron runs paginated matching filter and search
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
            WHERE (NOT p_failure_only OR d.status != 'succeeded')
              AND (v_search IS NULL OR (
                  COALESCE(j.jobname, 'job_' || d.jobid::text) ILIKE '%' || v_search || '%' OR
                  COALESCE(d.return_message, '') ILIKE '%' || v_search || '%' OR
                  COALESCE(d.command, '') ILIKE '%' || v_search || '%' OR
                  d.status ILIKE '%' || v_search || '%' OR
                  d.runid::text ILIKE '%' || v_search || '%' OR
                  d.jobid::text ILIKE '%' || v_search || '%'
              ))
            ORDER BY d.start_time DESC
            LIMIT LEAST(p_limit, 100)
            OFFSET p_offset
        ) r_sub;

        RETURN jsonb_build_object(
            'jobs', v_jobs,
            'runs', v_runs,
            'total_runs', v_total_runs
        );
    END;
$function$;

-- 2. Upgraded get_admin_execution_logs with multi-column search
CREATE OR REPLACE FUNCTION public.get_admin_execution_logs(
    p_function_name text DEFAULT NULL::text, 
    p_status text DEFAULT NULL::text, 
    p_caller_type text DEFAULT NULL::text, 
    p_limit integer DEFAULT 50, 
    p_offset integer DEFAULT 0, 
    p_search text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    DECLARE
        v_logs JSONB;
        v_total_count INT := 0;
        v_search TEXT := NULLIF(TRIM(p_search), '');
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
          AND (p_caller_type IS NULL OR l.caller_type = p_caller_type)
          AND (v_search IS NULL OR (
              l.function_name ILIKE '%' || v_search || '%' OR
              l.user_email ILIKE '%' || v_search || '%' OR
              l.error_message ILIKE '%' || v_search || '%'
          ));

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
              AND (v_search IS NULL OR (
                  l.function_name ILIKE '%' || v_search || '%' OR
                  l.user_email ILIKE '%' || v_search || '%' OR
                  l.error_message ILIKE '%' || v_search || '%'
              ))
            ORDER BY l.created_at DESC
            LIMIT LEAST(p_limit, 100)
            OFFSET p_offset
        ) sub;

        RETURN jsonb_build_object(
            'total', v_total_count,
            'logs', v_logs
        );
    END;
$function$;

-- Permissions
GRANT EXECUTE ON FUNCTION public.get_admin_cron_monitoring(integer, integer, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_execution_logs(text, text, text, integer, integer, text) TO authenticated, service_role;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
