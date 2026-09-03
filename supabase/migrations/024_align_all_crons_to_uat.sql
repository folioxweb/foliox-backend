-- ============================================================================
-- 024_align_all_crons_to_uat.sql
-- Reschedules all pg_cron scheduled jobs to point to the current UAT project:
-- URL: https://auflgeottunktfkwakab.supabase.co
-- ============================================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT jobname FROM cron.job WHERE jobname IN (
            'invoke-sync-prices-1',
            'invoke-sync-prices-2',
            'invoke-sync-prices-3',
            'invoke-sync-news',
            'invoke-sync-ipos',
            'invoke-sync-bse-docs',
            'invoke-sync-mfs',
            'invoke-sync-fund-holdings',
            'invoke-sync-nse-stocks',
            'invoke-sync-mf-master'
        )
    ) LOOP
        PERFORM cron.unschedule(r.jobname);
    END LOOP;
END $$;

-- 1. SYNC PRICES: Mon-Fri 09:00 - 09:29 IST (03:30 - 03:59 UTC)
SELECT cron.schedule(
  'invoke-sync-prices-1',
  '30-59 3 * * 1-5',
  $$
    SELECT net.http_post(
      url:='https://auflgeottunktfkwakab.supabase.co/functions/v1/sync-prices',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1ZmxnZW90dHVua3Rma3dha2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODg0NDAsImV4cCI6MjEwMzE2NDQ0MH0.bdkJ20xQ3GlfG5CkDPkA-sh1VNpqWtTMRcaHlRSL54I", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 2. SYNC PRICES: Mon-Fri 09:30 - 15:29 IST (04:00 - 09:59 UTC)
SELECT cron.schedule(
  'invoke-sync-prices-2',
  '* 4-9 * * 1-5',
  $$
    SELECT net.http_post(
      url:='https://auflgeottunktfkwakab.supabase.co/functions/v1/sync-prices',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1ZmxnZW90dHVua3Rma3dha2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODg0NDAsImV4cCI6MjEwMzE2NDQ0MH0.bdkJ20xQ3GlfG5CkDPkA-sh1VNpqWtTMRcaHlRSL54I", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 3. SYNC PRICES: Mon-Fri 15:30 - 16:00 IST (10:00 - 10:30 UTC)
SELECT cron.schedule(
  'invoke-sync-prices-3',
  '0-30 10 * * 1-5',
  $$
    SELECT net.http_post(
      url:='https://auflgeottunktfkwakab.supabase.co/functions/v1/sync-prices',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1ZmxnZW90dHVua3Rma3dha2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODg0NDAsImV4cCI6MjEwMzE2NDQ0MH0.bdkJ20xQ3GlfG5CkDPkA-sh1VNpqWtTMRcaHlRSL54I", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 4. SYNC NEWS: Hourly at minute 0 (0 * * * *)
SELECT cron.schedule(
  'invoke-sync-news',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url:='https://auflgeottunktfkwakab.supabase.co/functions/v1/sync-news',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1ZmxnZW90dHVua3Rma3dha2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODg0NDAsImV4cCI6MjEwMzE2NDQ0MH0.bdkJ20xQ3GlfG5CkDPkA-sh1VNpqWtTMRcaHlRSL54I", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 5. SYNC IPOS: Every 30 mins at :15 and :45 (15,45 * * * *)
SELECT cron.schedule(
  'invoke-sync-ipos',
  '15,45 * * * *',
  $$
    SELECT net.http_post(
      url:='https://auflgeottunktfkwakab.supabase.co/functions/v1/sync-ipos',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1ZmxnZW90dHVua3Rma3dha2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODg0NDAsImV4cCI6MjEwMzE2NDQ0MH0.bdkJ20xQ3GlfG5CkDPkA-sh1VNpqWtTMRcaHlRSL54I", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 6. SYNC BSE DOCS: Every 2 hours at minute 0 (0 */2 * * *)
SELECT cron.schedule(
  'invoke-sync-bse-docs',
  '0 */2 * * *',
  $$
    SELECT net.http_post(
      url:='https://auflgeottunktfkwakab.supabase.co/functions/v1/sync-bse-docs',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1ZmxnZW90dHVua3Rma3dha2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODg0NDAsImV4cCI6MjEwMzE2NDQ0MH0.bdkJ20xQ3GlfG5CkDPkA-sh1VNpqWtTMRcaHlRSL54I", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 7. SYNC MFS: Daily at 7:30 AM IST / 02:00 UTC (0 2 * * *)
SELECT cron.schedule(
  'invoke-sync-mfs',
  '0 2 * * *',
  $$
    SELECT net.http_post(
      url:='https://auflgeottunktfkwakab.supabase.co/functions/v1/sync-mfs',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1ZmxnZW90dHVua3Rma3dha2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODg0NDAsImV4cCI6MjEwMzE2NDQ0MH0.bdkJ20xQ3GlfG5CkDPkA-sh1VNpqWtTMRcaHlRSL54I", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 8. SYNC FUND HOLDINGS: Daily at 04:00 AM IST / 22:30 UTC (30 22 * * *)
SELECT cron.schedule(
  'invoke-sync-fund-holdings',
  '30 22 * * *',
  $$
    SELECT net.http_post(
      url:='https://auflgeottunktfkwakab.supabase.co/functions/v1/sync-fund-holdings',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1ZmxnZW90dHVua3Rma3dha2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODg0NDAsImV4cCI6MjEwMzE2NDQ0MH0.bdkJ20xQ3GlfG5CkDPkA-sh1VNpqWtTMRcaHlRSL54I", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 9. SYNC NSE STOCKS: Daily at 02:00 AM IST / 20:30 UTC (30 20 * * *)
SELECT cron.schedule(
  'invoke-sync-nse-stocks',
  '30 20 * * *',
  $$
    SELECT net.http_post(
      url:='https://auflgeottunktfkwakab.supabase.co/functions/v1/sync-nse-stocks',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1ZmxnZW90dHVua3Rma3dha2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODg0NDAsImV4cCI6MjEwMzE2NDQ0MH0.bdkJ20xQ3GlfG5CkDPkA-sh1VNpqWtTMRcaHlRSL54I", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 10. SYNC MF MASTER: Weekly Sunday at 11:30 PM IST / 18:00 UTC (0 18 * * 0)
SELECT cron.schedule(
  'invoke-sync-mf-master',
  '0 18 * * 0',
  $$
    SELECT net.http_post(
      url:='https://auflgeottunktfkwakab.supabase.co/functions/v1/sync-mf-master',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1ZmxnZW90dHVua3Rma3dha2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODg0NDAsImV4cCI6MjEwMzE2NDQ0MH0.bdkJ20xQ3GlfG5CkDPkA-sh1VNpqWtTMRcaHlRSL54I", "Content-Type": "application/json"}'::jsonb
    );
  $$
);
