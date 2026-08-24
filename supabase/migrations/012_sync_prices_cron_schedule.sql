-- 012_sync_prices_cron_schedule.sql

-- Unschedule existing sync-prices jobs
SELECT cron.unschedule('invoke-sync-prices') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-prices');
SELECT cron.unschedule('invoke-sync-prices-1') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-prices-1');
SELECT cron.unschedule('invoke-sync-prices-2') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-prices-2');
SELECT cron.unschedule('invoke-sync-prices-3') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-prices-3');

-- Schedule sync-prices every 1 minute from 9:00 AM to 4:00 PM IST (Monday to Friday)
-- 9:00 AM IST to 4:00 PM IST corresponds to 03:30 AM UTC to 10:30 AM UTC (Mon-Fri)

-- Part 1: 03:30 AM to 03:59 AM UTC (9:00 AM to 9:29 AM IST)
SELECT cron.schedule(
  'invoke-sync-prices-1',
  '30-59 3 * * 1-5',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-prices',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- Part 2: 04:00 AM to 09:59 AM UTC (9:30 AM to 3:29 PM IST)
SELECT cron.schedule(
  'invoke-sync-prices-2',
  '* 4-9 * * 1-5',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-prices',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- Part 3: 10:00 AM to 10:30 AM UTC (3:30 PM to 4:00 PM IST)
SELECT cron.schedule(
  'invoke-sync-prices-3',
  '0-30 10 * * 1-5',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-prices',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb
    );
  $$
);
