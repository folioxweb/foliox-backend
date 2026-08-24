-- 016_schedule_sync_nse_stocks_cron.sql
-- Schedule sync-nse-stocks to run daily at 2:00 AM IST (20:30 UTC -> 30 20 * * *)

SELECT cron.unschedule('invoke-sync-nse-stocks') 
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-nse-stocks');

SELECT cron.schedule(
  'invoke-sync-nse-stocks',
  '30 20 * * *',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-nse-stocks',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb
    );
  $$
);
