-- 015_update_sync_ipos_cron.sql
-- Reschedule sync-ipos to run every 30 minutes at minutes :15 and :45 (15,45 * * * *)

SELECT cron.unschedule('invoke-sync-ipos') 
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-ipos');

SELECT cron.schedule(
  'invoke-sync-ipos',
  '15,45 * * * *',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-ipos',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb
    );
  $$
);
