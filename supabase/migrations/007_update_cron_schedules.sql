-- 006_update_cron_schedules.sql

-- Unschedule existing jobs
SELECT cron.unschedule('invoke-sync-prices') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-prices');
SELECT cron.unschedule('invoke-sync-news') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-news');
SELECT cron.unschedule('invoke-sync-bse-docs') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-bse-docs');

-- 1. Schedule sync-prices to run every minute during Indian market hours (roughly 4-10 UTC, Mon-Fri)
SELECT cron.schedule(
  'invoke-sync-prices',
  '* 4-10 * * 1-5',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-prices',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 4. Schedule sync-mfs (Mutual Funds NAV sync and SIP process) to run every 30 minutes
SELECT cron.schedule(
  'invoke-sync-mfs',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-mfs',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 2. Schedule sync-news to run every 15 minutes
SELECT cron.schedule(
  'invoke-sync-news',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-news',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 3. Schedule sync-bse-docs to run every 30 minutes
SELECT cron.schedule(
  'invoke-sync-bse-docs',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-bse-docs',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb
    );
  $$
);
