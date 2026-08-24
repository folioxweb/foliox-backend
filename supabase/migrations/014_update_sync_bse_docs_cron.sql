-- 014_update_sync_bse_docs_cron.sql
-- Reschedule sync-bse-docs to run every 2 hours (0 */2 * * *)

SELECT cron.unschedule('invoke-sync-bse-docs') 
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-sync-bse-docs');

SELECT cron.schedule(
  'invoke-sync-bse-docs',
  '0 */2 * * *',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-bse-docs',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb,
      body:='{}'::jsonb,
      timeout_milliseconds:=60000
    );
  $$
);
