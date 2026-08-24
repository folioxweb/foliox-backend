-- 020_schedule_sync_mf_master_cron.sql
-- Schedules sync-mf-master Edge Function to run daily at 5:00 AM IST (23:30 UTC -> 30 23 * * *)

SELECT cron.unschedule('invoke-sync-mf-master') 
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-mf-master');

SELECT cron.schedule(
  'invoke-sync-mf-master',
  '30 23 * * *',
  $$
    SELECT net.http_post(
      url:='https://yfyvceirbveamvcgbvps.supabase.co/functions/v1/sync-mf-master',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeXZjZWlyYnZlYW12Y2didnBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMjAwODcsImV4cCI6MjEwMjg5NjA4N30.m3haNbby4HhkIKisL3MniA2RwJI7KWLU3QanNe_Qmns", "Content-Type": "application/json"}'::jsonb
    );
  $$
);
