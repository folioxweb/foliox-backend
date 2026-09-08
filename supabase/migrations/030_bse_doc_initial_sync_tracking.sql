-- 030_bse_doc_initial_sync_tracking.sql
-- Adds tracking columns to `assets` table for BSE corporate documents initial sync and historical backfill

ALTER TABLE assets 
ADD COLUMN IF NOT EXISTS bse_initial_sync_done BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS bse_doc_synced_at TIMESTAMPTZ;

-- Index for quickly filtering assets that need initial backfill vs incremental sync
CREATE INDEX IF NOT EXISTS idx_assets_bse_initial_sync_done 
ON assets (bse_initial_sync_done, asset_type);

-- Backfill existing assets that already have documents in company_documents
-- so they are marked as completed and continue with normal daily incremental syncs
UPDATE assets
SET bse_initial_sync_done = TRUE,
    bse_doc_synced_at = NOW()
WHERE bse_initial_sync_done IS NOT TRUE
  AND asset_id IN (
    SELECT DISTINCT asset_id FROM company_documents
  );
