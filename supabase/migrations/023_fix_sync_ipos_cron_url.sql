-- 023_fix_sync_ipos_cron_url.sql
-- Reschedule invoke-sync-ipos to point to the current Supabase UAT project URL

SELECT cron.unschedule('invoke-sync-ipos') 
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-ipos');

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
