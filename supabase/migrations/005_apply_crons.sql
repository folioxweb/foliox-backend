-- 005_apply_crons.sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule any previous versions of these jobs if they exist
SELECT cron.unschedule('invoke-sync-prices') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-prices');
SELECT cron.unschedule('invoke-sync-news') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-news');
SELECT cron.unschedule('invoke-sync-bse-docs') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-bse-docs');
SELECT cron.unschedule('invoke-process-sips') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-process-sips');
SELECT cron.unschedule('migrate-bse-urls') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'migrate-bse-urls');
SELECT cron.unschedule('invoke-sync-fund-holdings') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-fund-holdings');

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

-- 2. Schedule sync-news to run hourly
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

-- 3. Schedule sync-bse-docs to run daily at 18:30
SELECT cron.schedule(
  'invoke-sync-bse-docs',
  '30 18 * * *',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-bse-docs',
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

-- 5. URL Migration Function & Cron
CREATE OR REPLACE FUNCTION migrate_bse_live_to_his()
RETURNS void AS $$
BEGIN
    UPDATE company_documents
    SET pdf_url = REPLACE(pdf_url, 'AttachLive', 'AttachHis')
    WHERE pdf_url LIKE '%AttachLive%'
      AND EXTRACT(DAY FROM CURRENT_DATE - announcement_date::DATE) > 3;
END;
$$ LANGUAGE plpgsql;

SELECT cron.schedule(
  'migrate-bse-urls',
  '0 0 * * *',
  $$ SELECT migrate_bse_live_to_his(); $$
);

-- 6. Schedule sync-fund-holdings to run weekly on Sunday at 3 AM
SELECT cron.schedule(
  'invoke-sync-fund-holdings',
  '0 3 * * 0',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-fund-holdings',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb
    );
  $$
);
