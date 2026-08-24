-- 017_align_all_crons_to_ist.sql
-- Align sync-mfs and sync-news to exact IST schedules

-- 1. Reschedule sync-mfs to run daily at 7:30 AM IST (02:00 UTC -> 0 2 * * *)
SELECT cron.unschedule('invoke-sync-mfs') 
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-mfs');

SELECT cron.schedule(
  'invoke-sync-mfs',
  '0 2 * * *',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-mfs',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 2. Reschedule sync-news to run hourly at minute 0 (0 * * * *)
SELECT cron.unschedule('invoke-sync-news') 
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-news');

SELECT cron.schedule(
  'invoke-sync-news',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-news',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb
    );
  $$
);
