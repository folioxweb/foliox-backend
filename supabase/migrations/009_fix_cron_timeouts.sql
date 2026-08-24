-- 009_fix_cron_timeouts.sql

-- 1. Fix migrate_bse_live_to_his function
CREATE OR REPLACE FUNCTION migrate_bse_live_to_his()
RETURNS void AS $$
BEGIN
    UPDATE company_documents
    SET pdf_url = REPLACE(pdf_url, 'AttachLive', 'AttachHis')
    WHERE pdf_url LIKE '%AttachLive%'
      AND CURRENT_DATE - announcement_date::DATE > 3;
END;
$$ LANGUAGE plpgsql;

-- 2. Reschedule sync-bse-docs with a longer timeout (60 seconds)
SELECT cron.unschedule('invoke-sync-bse-docs') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-bse-docs');

SELECT cron.schedule(
  'invoke-sync-bse-docs',
  '30 18 * * *',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-bse-docs',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb,
      body:='{}'::jsonb,
      timeout_milliseconds:=60000
    );
  $$
);
