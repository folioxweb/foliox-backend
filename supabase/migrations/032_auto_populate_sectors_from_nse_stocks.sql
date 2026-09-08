-- 032_auto_populate_sectors_from_nse_stocks.sql
-- Backfill sector in assets and paper_assets from nse_stocks where sector is missing,
-- and add covering index for fast symbol-sector lookups.

CREATE INDEX IF NOT EXISTS idx_nse_stocks_symbol_sector 
ON nse_stocks (symbol, sector) 
WHERE sector IS NOT NULL;

-- 1. Backfill direct stock holdings in assets
UPDATE assets a
SET sector = ns.sector
FROM nse_stocks ns
WHERE a.symbol = ns.symbol
  AND (a.sector IS NULL OR a.sector = '')
  AND ns.sector IS NOT NULL;

-- 2. Backfill ISIN matches if symbol did not match directly
UPDATE assets a
SET sector = ns.sector
FROM nse_stocks ns
WHERE a.isin = ns.isin
  AND (a.sector IS NULL OR a.sector = '')
  AND ns.sector IS NOT NULL;

-- 3. Backfill paper trading assets
UPDATE paper_assets pa
SET sector = ns.sector
FROM nse_stocks ns
WHERE pa.symbol = ns.symbol
  AND (pa.sector IS NULL OR pa.sector = '')
  AND ns.sector IS NOT NULL;
