-- ============================================================================
-- 040_stagger_sync_news_cron_uat.sql
-- 1. Staggers invoke-sync-news to run at minute 10 of every hour (10 * * * *)
--    to avoid collision with sync-prices, sync-mfs, and sync-bse-docs at minute 0.
-- 2. Increases timeout_milliseconds to 120,000 ms (2 minutes) to prevent
--    pg_net prematurely severing connections when RSS fetches experience latency.
-- ============================================================================

DO $$
BEGIN
    -- Safeguard: Only apply on UAT environment
    IF EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%yfyvceirbveamvcgbvps%') THEN
        RAISE NOTICE 'Production environment detected. Skipping 040_stagger_sync_news_cron_uat.sql.';
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-news') THEN
        PERFORM cron.unschedule('invoke-sync-news');
    END IF;

    PERFORM cron.schedule(
      'invoke-sync-news',
      '10 * * * *',
      $cmd$
        SELECT net.http_post(
          url:='https://auflgeottunktfkwakab.supabase.co/functions/v1/sync-news',
          headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1ZmxnZW90dHVua3Rma3dha2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODg0NDAsImV4cCI6MjEwMzE2NDQ0MH0.bdkJ20xQ3GlfG5CkDPkA-sh1VNpqWtTMRcaHlRSL54I", "Content-Type": "application/json"}'::jsonb,
          timeout_milliseconds:=120000
        );
      $cmd$
    );
END $$;
