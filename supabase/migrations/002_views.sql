-- 002_views.sql

-- 1. vw_holdings: Core valuation engine replacing row-level calculations in Google Sheets
CREATE OR REPLACE VIEW vw_holdings AS
-- Market Priced Assets (Stocks, ETFs, MFs)
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

-- Fixed Deposits (Compounded mathematically using Postgres date functions)
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
    -- Current Value = Principal * (1 + r/n)^(n*t) where n=4, t = days/365.25
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

-- 2. vw_portfolio_summary: Global Aggregation Layer
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

-- 3. vw_indirect_exposure: Translates fund holdings into underlying asset exposures
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

-- 4. vw_global_sector_allocation: Combines direct stock sectors with indirect ETF/MF sectors
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

-- 5. vw_dashboard: The finalized JSON payload view allowing the Edge Function to just SELECT 1 row
CREATE OR REPLACE VIEW vw_dashboard AS
SELECT jsonb_build_object(
    'overallInvestments', (SELECT COALESCE(jsonb_agg(row_to_json(p)), '[]'::jsonb) FROM vw_portfolio_summary p),
    'sectorAllocation', (SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) FROM vw_global_sector_allocation s),
    'topHoldings', (SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::jsonb) FROM (SELECT * FROM vw_holdings WHERE asset_type = 'STOCK' ORDER BY current_value DESC LIMIT 7) sub)
) as dashboard_payload;
