-- ============================================================================
-- MASTER REPLICATION SCRIPT FOR NEW SUPABASE PROJECT (yfyvceirbveamvcgbvps)
-- ============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================================
-- 2. TABLES CREATION
-- ============================================================================

-- 2.1 ASSETS TABLE
CREATE TABLE IF NOT EXISTS assets (
    asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    asset_type VARCHAR(20) NOT NULL CHECK(asset_type IN ('STOCK', 'ETF', 'MF', 'FD')),
    sector VARCHAR(100),
    category VARCHAR(100),
    confidence VARCHAR(20),
    trade_type VARCHAR(20),
    current_price NUMERIC(15, 4),
    prev_close NUMERIC(15, 4),
    last_updated TIMESTAMPTZ,
    api_code VARCHAR(50),
    isin VARCHAR(50)
);

-- 2.2 TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS transactions (
    tx_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    tx_type VARCHAR(10) NOT NULL CHECK(tx_type IN ('BUY', 'SELL')),
    quantity NUMERIC(15, 6) NOT NULL,
    price NUMERIC(15, 4) NOT NULL,
    tx_date TIMESTAMPTZ DEFAULT NOW(),
    fd_principal NUMERIC(15, 4),
    fd_rate NUMERIC(5, 2),
    fd_maturity_date DATE
);

-- 2.3 MF SIP CONFIGS TABLE
CREATE TABLE IF NOT EXISTS mf_sip_configs (
    asset_id UUID PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
    is_enabled BOOLEAN DEFAULT false,
    sip_day INT CHECK(sip_day BETWEEN 1 AND 28),
    sip_amount NUMERIC(15, 2),
    last_sip_date DATE
);

-- 2.4 FUND HOLDINGS TABLE
CREATE TABLE IF NOT EXISTS fund_holdings (
    fund_asset_id UUID NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    holding_type VARCHAR(20) NOT NULL CHECK(holding_type IN ('SECTOR', 'STOCK')),
    holding_name VARCHAR(100) NOT NULL,
    weight_percentage NUMERIC(5, 2) NOT NULL,
    PRIMARY KEY (fund_asset_id, holding_type, holding_name)
);

-- 2.5 NEWS TABLE
CREATE TABLE IF NOT EXISTS news (
    guid TEXT PRIMARY KEY,
    asset_id UUID REFERENCES assets(asset_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source VARCHAR(100),
    category VARCHAR(50),
    published_at TIMESTAMPTZ,
    url TEXT,
    original_url TEXT,
    is_read BOOLEAN DEFAULT false,
    retrieved_at TIMESTAMPTZ DEFAULT NOW(),
    content TEXT,
    ai_summary_json JSONB,
    ai_status VARCHAR(20) DEFAULT 'PENDING',
    ai_model VARCHAR(50),
    ai_generated_on TIMESTAMPTZ
);

-- 2.6 COMPANY DOCUMENTS TABLE
CREATE TABLE IF NOT EXISTS company_documents (
    attachment_id VARCHAR(255) PRIMARY KEY,
    asset_id UUID NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    symbol VARCHAR(50),
    scrip_code VARCHAR(50),
    company VARCHAR(255),
    title TEXT,
    original_title TEXT,
    document_type VARCHAR(50),
    reporting_period VARCHAR(50),
    pdf_url TEXT,
    attachment_name TEXT,
    retrieved_on TIMESTAMPTZ,
    ai_summary_json JSONB,
    ai_status VARCHAR(20) DEFAULT 'PENDING',
    ai_model VARCHAR(50),
    ai_generated_on TIMESTAMPTZ,
    announcement_date DATE,
    announcement_time VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.7 NSE STOCKS MASTER TABLE
CREATE TABLE IF NOT EXISTS nse_stocks (
    symbol VARCHAR(50) PRIMARY KEY,
    isin VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    series VARCHAR(10) DEFAULT 'EQ',
    sector VARCHAR(100),
    industry VARCHAR(100),
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nse_stocks_search ON nse_stocks (symbol, name, isin);

-- 2.8 WATCHLIST ITEMS TABLE
CREATE TABLE IF NOT EXISTS watchlist_items (
    watchlist_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(50) NOT NULL,
    isin VARCHAR(50),
    name VARCHAR(255) NOT NULL,
    sector VARCHAR(100),
    confidence VARCHAR(20) DEFAULT 'Medium',
    badge VARCHAR(20) DEFAULT 'Trade',
    added_price NUMERIC(15, 4) NOT NULL DEFAULT 0,
    target_price NUMERIC(15, 4),
    notes TEXT,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_watchlist_symbol UNIQUE (symbol)
);

-- 2.9 PAPER PORTFOLIO CONFIG TABLE
CREATE TABLE IF NOT EXISTS paper_portfolio_config (
    id INT PRIMARY KEY DEFAULT 1,
    initial_capital NUMERIC(15, 2) NOT NULL DEFAULT 5000000.00,
    current_cash NUMERIC(15, 2) NOT NULL DEFAULT 5000000.00,
    realized_pnl NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT single_paper_config CHECK (id = 1)
);

INSERT INTO paper_portfolio_config (id, initial_capital, current_cash, realized_pnl)
VALUES (1, 5000000.00, 5000000.00, 0.00)
ON CONFLICT (id) DO NOTHING;

-- 2.10 PAPER ASSETS TABLE
CREATE TABLE IF NOT EXISTS paper_assets (
    asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    sector VARCHAR(100),
    confidence VARCHAR(20) DEFAULT 'Medium',
    trade_type VARCHAR(20) DEFAULT 'Trade',
    current_price NUMERIC(15, 4) DEFAULT 0,
    prev_close NUMERIC(15, 4) DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    isin VARCHAR(50)
);

-- 2.11 PAPER TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS paper_transactions (
    tx_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES paper_assets(asset_id) ON DELETE CASCADE,
    tx_type VARCHAR(10) NOT NULL CHECK (tx_type IN ('BUY', 'SELL')),
    quantity NUMERIC(15, 6) NOT NULL,
    price NUMERIC(15, 4) NOT NULL,
    realized_gain NUMERIC(15, 4) DEFAULT 0,
    tx_date TIMESTAMPTZ DEFAULT NOW()
);

-- 2.12 MAINBOARD IPOS TABLE
CREATE TABLE IF NOT EXISTS mainboard_ipos (
    id BIGINT PRIMARY KEY,
    ipo_name TEXT NOT NULL,
    category TEXT DEFAULT 'IPO',
    status TEXT,
    status_badge TEXT,
    gmp_amount NUMERIC DEFAULT 0,
    gmp_percent NUMERIC DEFAULT 0,
    gmp_trend TEXT,
    rating_flames INT DEFAULT 0,
    price_str TEXT,
    price_num NUMERIC DEFAULT 0,
    ipo_size TEXT,
    lot_size INT DEFAULT 1,
    pe_ratio TEXT,
    subscription TEXT,
    open_date TEXT,
    close_date TEXT,
    boa_date TEXT,
    listing_date TEXT,
    sort_open DATE,
    sort_close DATE,
    sort_boa DATE,
    sort_listing DATE,
    updated_on_text TEXT,
    anchor_available BOOLEAN DEFAULT false,
    investorgain_url TEXT,
    allotment_url TEXT,
    highlight_row TEXT,
    raw_json JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mainboard_ipos_status ON mainboard_ipos(status);
CREATE INDEX IF NOT EXISTS idx_mainboard_ipos_sort_open ON mainboard_ipos(sort_open DESC);
CREATE INDEX IF NOT EXISTS idx_mainboard_ipos_gmp_percent ON mainboard_ipos(gmp_percent DESC);

-- ============================================================================
-- 3. VIEWS CREATION
-- ============================================================================

-- 3.1 vw_holdings
CREATE OR REPLACE VIEW vw_holdings AS
SELECT 
    a.asset_id,
    a.symbol,
    a.name,
    a.asset_type,
    a.sector,
    a.category,
    a.confidence,
    a.trade_type,
    a.current_price,
    a.prev_close,
    SUM(t.quantity) AS total_quantity,
    SUM(t.quantity * t.price) / NULLIF(SUM(t.quantity), 0) AS avg_price,
    SUM(t.quantity * t.price) AS invested_value,
    SUM(t.quantity) * a.current_price AS current_value,
    (SUM(t.quantity) * a.current_price) - SUM(t.quantity * t.price) AS return_abs,
    CASE WHEN SUM(t.quantity * t.price) > 0 THEN ((SUM(t.quantity) * a.current_price) - SUM(t.quantity * t.price)) / SUM(t.quantity * t.price) * 100 ELSE 0 END AS return_pct,
    SUM(t.quantity) * (a.current_price - a.prev_close) AS day_change_abs,
    CASE WHEN a.prev_close > 0 THEN (a.current_price - a.prev_close) / a.prev_close * 100 ELSE 0 END AS day_change_pct,
    sip.is_enabled AS sip_enabled,
    sip.sip_day,
    sip.sip_amount,
    sip.last_sip_date,
    NULL::numeric AS fd_rate,
    NULL::date AS start_date,
    NULL::date AS maturity_date
FROM assets a
JOIN transactions t ON a.asset_id = t.asset_id
LEFT JOIN mf_sip_configs sip ON a.asset_id = sip.asset_id
WHERE a.asset_type IN ('STOCK', 'ETF', 'MF')
GROUP BY a.asset_id, sip.is_enabled, sip.sip_day, sip.sip_amount, sip.last_sip_date
HAVING SUM(t.quantity) > 0

UNION ALL

SELECT 
    a.asset_id,
    a.symbol,
    a.name,
    a.asset_type,
    NULL AS sector,
    NULL AS category,
    NULL AS confidence,
    NULL AS trade_type,
    NULL AS current_price,
    NULL AS prev_close,
    1 AS total_quantity,
    SUM(t.fd_principal) AS avg_price,
    SUM(t.fd_principal) AS invested_value,
    SUM(t.fd_principal) * POWER(1 + (MAX(t.fd_rate)/100/4), 4 * ((CURRENT_DATE - MIN(t.tx_date::DATE)) / 365.25)) AS current_value,
    (SUM(t.fd_principal) * POWER(1 + (MAX(t.fd_rate)/100/4), 4 * ((CURRENT_DATE - MIN(t.tx_date::DATE)) / 365.25))) - SUM(t.fd_principal) AS return_abs,
    ((SUM(t.fd_principal) * POWER(1 + (MAX(t.fd_rate)/100/4), 4 * ((CURRENT_DATE - MIN(t.tx_date::DATE)) / 365.25))) - SUM(t.fd_principal)) / NULLIF(SUM(t.fd_principal), 0) * 100 AS return_pct,
    0 AS day_change_abs,
    0 AS day_change_pct,
    NULL::boolean AS sip_enabled,
    NULL::int AS sip_day,
    NULL::numeric AS sip_amount,
    NULL::date AS last_sip_date,
    MAX(t.fd_rate) AS fd_rate,
    MIN(t.tx_date::DATE) AS start_date,
    MAX(t.fd_maturity_date) AS maturity_date
FROM assets a
JOIN transactions t ON a.asset_id = t.asset_id
WHERE a.asset_type = 'FD'
GROUP BY a.asset_id
HAVING SUM(t.fd_principal) > 0;

-- 3.2 vw_portfolio_summary
CREATE OR REPLACE VIEW vw_portfolio_summary AS
SELECT
    asset_type,
    SUM(invested_value) AS total_invested,
    SUM(current_value) AS total_current,
    SUM(return_abs) AS total_return,
    SUM(day_change_abs) AS total_day_change,
    SUM(current_value) / NULLIF(SUM(SUM(current_value)) OVER (), 0) * 100 AS allocation_pct
FROM 
    vw_holdings
GROUP BY 
    asset_type;

-- 3.3 vw_indirect_exposure
CREATE OR REPLACE VIEW vw_indirect_exposure AS
SELECT 
    fh.holding_type,
    fh.holding_name,
    SUM(h.current_value * (fh.weight_percentage / 100.0)) AS exposure_value
FROM 
    fund_holdings fh
JOIN 
    vw_holdings h ON fh.fund_asset_id = h.asset_id
GROUP BY 
    fh.holding_type, fh.holding_name;

-- 3.4 vw_global_sector_allocation
CREATE OR REPLACE VIEW vw_global_sector_allocation AS
WITH direct_sectors AS (
    SELECT sector AS sector_name, SUM(current_value) AS sector_value
    FROM vw_holdings
    WHERE asset_type = 'STOCK' AND sector IS NOT NULL
    GROUP BY sector
),
indirect_sectors AS (
    SELECT holding_name AS sector_name, SUM(exposure_value) AS sector_value
    FROM vw_indirect_exposure
    WHERE holding_type = 'SECTOR'
    GROUP BY holding_name
),
combined_sectors AS (
    SELECT sector_name, sector_value FROM direct_sectors
    UNION ALL
    SELECT sector_name, sector_value FROM indirect_sectors
)
SELECT 
    sector_name,
    SUM(sector_value) AS total_exposure,
    SUM(sector_value) / NULLIF(SUM(SUM(sector_value)) OVER (), 0) * 100 AS allocation_pct
FROM combined_sectors
GROUP BY sector_name
ORDER BY total_exposure DESC;

-- 3.5 vw_global_stock_allocation
CREATE OR REPLACE VIEW vw_global_stock_allocation AS
WITH direct_stocks AS (
    SELECT
        h.name AS stock_name,
        SUM(h.current_value) AS stock_value
    FROM vw_holdings h
    WHERE h.asset_type = 'STOCK'
    GROUP BY h.name
),
indirect_stocks AS (
    SELECT
        fh.holding_name AS stock_name,
        SUM(h.current_value * (fh.weight_percentage / 100.0)) AS stock_value
    FROM fund_holdings fh
    JOIN vw_holdings h ON fh.fund_asset_id = h.asset_id
    WHERE fh.holding_type = 'STOCK'
    GROUP BY fh.holding_name
),
combined_stocks AS (
    SELECT stock_name, stock_value FROM direct_stocks
    UNION ALL
    SELECT stock_name, stock_value FROM indirect_stocks
)
SELECT
    stock_name,
    SUM(stock_value) AS total_exposure,
    SUM(stock_value) / NULLIF(SUM(SUM(stock_value)) OVER (), 0) * 100 AS allocation_pct
FROM combined_stocks
GROUP BY stock_name
ORDER BY total_exposure DESC;

-- 3.6 vw_dashboard
CREATE OR REPLACE VIEW vw_dashboard AS
SELECT jsonb_build_object(
    'overallInvestments', (SELECT COALESCE(jsonb_agg(row_to_json(p)), '[]'::jsonb) FROM vw_portfolio_summary p),
    'sectorAllocation', (SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) FROM vw_global_sector_allocation s),
    'topHoldings', (SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::jsonb) FROM (SELECT * FROM vw_holdings WHERE asset_type = 'STOCK' ORDER BY current_value DESC LIMIT 7) sub)
) as dashboard_payload;

-- 3.7 vw_watchlist
CREATE OR REPLACE VIEW vw_watchlist AS
SELECT 
    w.watchlist_id,
    w.symbol,
    w.isin,
    w.name,
    w.sector,
    w.confidence,
    w.badge,
    w.added_price,
    w.target_price,
    w.notes,
    w.added_at,
    COALESCE(pa.current_price, a.current_price, w.added_price) AS current_price,
    COALESCE(pa.prev_close, a.prev_close, w.added_price) AS prev_close,
    CASE 
        WHEN w.added_price > 0 THEN ((COALESCE(pa.current_price, a.current_price, w.added_price) - w.added_price) / w.added_price) * 100 
        ELSE 0 
    END AS return_since_added_pct,
    (COALESCE(pa.current_price, a.current_price, w.added_price) - w.added_price) AS return_since_added_abs,
    CASE 
        WHEN COALESCE(pa.prev_close, a.prev_close, 0) > 0 THEN ((COALESCE(pa.current_price, a.current_price, 0) - COALESCE(pa.prev_close, a.prev_close, 0)) / COALESCE(pa.prev_close, a.prev_close, 1)) * 100 
        ELSE 0 
    END AS day_change_pct,
    (COALESCE(pa.current_price, a.current_price, 0) - COALESCE(pa.prev_close, a.prev_close, 0)) AS day_change_abs,
    EXISTS (
        SELECT 1 
        FROM assets real_a 
        JOIN transactions real_t ON real_a.asset_id = real_t.asset_id 
        WHERE real_a.symbol = w.symbol 
        GROUP BY real_a.asset_id 
        HAVING SUM(real_t.quantity) > 0
    ) AS in_portfolio
FROM watchlist_items w
LEFT JOIN assets a ON w.symbol = a.symbol
LEFT JOIN paper_assets pa ON w.symbol = pa.symbol;

-- 3.8 vw_paper_holdings
CREATE OR REPLACE VIEW vw_paper_holdings AS
SELECT 
    a.asset_id,
    a.symbol,
    a.name,
    a.sector,
    a.confidence,
    a.trade_type AS badge,
    a.current_price,
    a.prev_close,
    SUM(t.quantity) AS total_quantity,
    SUM(t.quantity * t.price) / NULLIF(SUM(t.quantity), 0) AS avg_price,
    SUM(t.quantity * t.price) AS invested_value,
    SUM(t.quantity) * a.current_price AS current_value,
    (SUM(t.quantity) * a.current_price) - SUM(t.quantity * t.price) AS return_abs,
    CASE WHEN SUM(t.quantity * t.price) > 0 THEN ((SUM(t.quantity) * a.current_price) - SUM(t.quantity * t.price)) / SUM(t.quantity * t.price) * 100 ELSE 0 END AS return_pct,
    SUM(t.quantity) * (a.current_price - a.prev_close) AS day_change_abs,
    CASE WHEN a.prev_close > 0 THEN (a.current_price - a.prev_close) / a.prev_close * 100 ELSE 0 END AS day_change_pct
FROM paper_assets a
JOIN paper_transactions t ON a.asset_id = t.asset_id
GROUP BY a.asset_id
HAVING SUM(t.quantity) > 0;

-- 3.9 vw_paper_summary
CREATE OR REPLACE VIEW vw_paper_summary AS
WITH holdings_agg AS (
    SELECT 
        COALESCE(SUM(invested_value), 0) AS total_invested,
        COALESCE(SUM(current_value), 0) AS total_current,
        COALESCE(SUM(return_abs), 0) AS unrealized_pnl,
        COALESCE(SUM(day_change_abs), 0) AS total_day_change
    FROM vw_paper_holdings
)
SELECT 
    cfg.initial_capital,
    cfg.current_cash,
    cfg.realized_pnl,
    h.total_invested,
    h.total_current,
    h.unrealized_pnl,
    h.total_day_change,
    (h.total_current + cfg.current_cash) AS portfolio_value,
    (h.unrealized_pnl + cfg.realized_pnl) AS total_pnl,
    CASE WHEN cfg.initial_capital > 0 THEN ((h.unrealized_pnl + cfg.realized_pnl) / cfg.initial_capital) * 100 ELSE 0 END AS total_pnl_pct
FROM paper_portfolio_config cfg
CROSS JOIN holdings_agg h
WHERE cfg.id = 1;

-- ============================================================================
-- 4. STORED PROCEDURES
-- ============================================================================

CREATE OR REPLACE FUNCTION migrate_bse_live_to_his()
RETURNS void AS $$
BEGIN
    UPDATE company_documents
    SET pdf_url = REPLACE(pdf_url, 'AttachLive', 'AttachHis')
    WHERE pdf_url LIKE '%AttachLive%'
      AND EXTRACT(DAY FROM CURRENT_DATE - announcement_date::DATE) > 3;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. PG_CRON SCHEDULES (Configured for yfyvceirbveamvcgbvps)
-- ============================================================================

-- Unschedule any previous jobs to prevent duplicate triggers
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT jobname FROM cron.job WHERE jobname IN (
        'invoke-sync-prices-1', 'invoke-sync-prices-2', 'invoke-sync-prices-3',
        'invoke-sync-news', 'invoke-sync-ipos', 'invoke-sync-bse-docs',
        'invoke-sync-mfs', 'invoke-sync-fund-holdings', 'invoke-sync-nse-stocks',
        'migrate-bse-urls', 'invoke-sync-prices', 'invoke-process-sips'
    )) LOOP
        PERFORM cron.unschedule(r.jobname);
    END LOOP;
END $$;

-- 5.1 SYNC PRICES: Mon-Fri 09:00 - 09:29 IST (03:30 - 03:59 UTC)
SELECT cron.schedule(
  'invoke-sync-prices-1',
  '30-59 3 * * 1-5',
  $$
    SELECT net.http_post(
      url:='https://yfyvceirbveamvcgbvps.supabase.co/functions/v1/sync-prices',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeXZjZWlyYnZlYW12Y2didnBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMjAwODcsImV4cCI6MjEwMjg5NjA4N30.m3haNbby4HhkIKisL3MniA2RwJI7KWLU3QanNe_Qmns", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 5.2 SYNC PRICES: Mon-Fri 09:30 - 15:29 IST (04:00 - 09:59 UTC)
SELECT cron.schedule(
  'invoke-sync-prices-2',
  '* 4-9 * * 1-5',
  $$
    SELECT net.http_post(
      url:='https://yfyvceirbveamvcgbvps.supabase.co/functions/v1/sync-prices',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeXZjZWlyYnZlYW12Y2didnBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMjAwODcsImV4cCI6MjEwMjg5NjA4N30.m3haNbby4HhkIKisL3MniA2RwJI7KWLU3QanNe_Qmns", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 5.3 SYNC PRICES: Mon-Fri 15:30 - 16:00 IST (10:00 - 10:30 UTC)
SELECT cron.schedule(
  'invoke-sync-prices-3',
  '0-30 10 * * 1-5',
  $$
    SELECT net.http_post(
      url:='https://yfyvceirbveamvcgbvps.supabase.co/functions/v1/sync-prices',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeXZjZWlyYnZlYW12Y2didnBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMjAwODcsImV4cCI6MjEwMjg5NjA4N30.m3haNbby4HhkIKisL3MniA2RwJI7KWLU3QanNe_Qmns", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 5.4 SYNC NEWS: Every 15 minutes
SELECT cron.schedule(
  'invoke-sync-news',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url:='https://yfyvceirbveamvcgbvps.supabase.co/functions/v1/sync-news',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeXZjZWlyYnZlYW12Y2didnBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMjAwODcsImV4cCI6MjEwMjg5NjA4N30.m3haNbby4HhkIKisL3MniA2RwJI7KWLU3QanNe_Qmns", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 5.5 SYNC IPOS: Every 30 mins at :15 and :45
SELECT cron.schedule(
  'invoke-sync-ipos',
  '15,45 * * * *',
  $$
    SELECT net.http_post(
      url:='https://yfyvceirbveamvcgbvps.supabase.co/functions/v1/sync-ipos',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeXZjZWlyYnZlYW12Y2didnBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMjAwODcsImV4cCI6MjEwMjg5NjA4N30.m3haNbby4HhkIKisL3MniA2RwJI7KWLU3QanNe_Qmns", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 5.6 SYNC BSE DOCS: Every 2 hours
SELECT cron.schedule(
  'invoke-sync-bse-docs',
  '0 */2 * * *',
  $$
    SELECT net.http_post(
      url:='https://yfyvceirbveamvcgbvps.supabase.co/functions/v1/sync-bse-docs',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeXZjZWlyYnZlYW12Y2didnBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMjAwODcsImV4cCI6MjEwMjg5NjA4N30.m3haNbby4HhkIKisL3MniA2RwJI7KWLU3QanNe_Qmns", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 5.7 SYNC MFS: Every 30 minutes
SELECT cron.schedule(
  'invoke-sync-mfs',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url:='https://yfyvceirbveamvcgbvps.supabase.co/functions/v1/sync-mfs',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeXZjZWlyYnZlYW12Y2didnBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMjAwODcsImV4cCI6MjEwMjg5NjA4N30.m3haNbby4HhkIKisL3MniA2RwJI7KWLU3QanNe_Qmns", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 5.8 SYNC FUND HOLDINGS: Daily at 22:30 UTC / 04:00 AM IST
SELECT cron.schedule(
  'invoke-sync-fund-holdings',
  '30 22 * * *',
  $$
    SELECT net.http_post(
      url:='https://yfyvceirbveamvcgbvps.supabase.co/functions/v1/sync-fund-holdings',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeXZjZWlyYnZlYW12Y2didnBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMjAwODcsImV4cCI6MjEwMjg5NjA4N30.m3haNbby4HhkIKisL3MniA2RwJI7KWLU3QanNe_Qmns", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 5.9 SYNC NSE STOCKS: Daily at 20:30 UTC / 02:00 AM IST
SELECT cron.schedule(
  'invoke-sync-nse-stocks',
  '30 20 * * *',
  $$
    SELECT net.http_post(
      url:='https://yfyvceirbveamvcgbvps.supabase.co/functions/v1/sync-nse-stocks',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeXZjZWlyYnZlYW12Y2didnBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMjAwODcsImV4cCI6MjEwMjg5NjA4N30.m3haNbby4HhkIKisL3MniA2RwJI7KWLU3QanNe_Qmns", "Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- 5.10 MIGRATE BSE LIVE TO HIS URLS: Daily at midnight (00:00 UTC / 05:30 AM IST)
SELECT cron.schedule(
  'migrate-bse-urls',
  '0 0 * * *',
  $$ SELECT migrate_bse_live_to_his(); $$
);
