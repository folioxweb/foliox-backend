-- 018_update_sync_fund_holdings_cron.sql
-- Reschedule sync-fund-holdings to run daily at 4:00 AM IST (22:30 UTC -> 30 22 * * *)

SELECT cron.unschedule('invoke-sync-fund-holdings') 
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-fund-holdings');

SELECT cron.schedule(
  'invoke-sync-fund-holdings',
  '30 22 * * *',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-fund-holdings',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb
    );
  $$
);
