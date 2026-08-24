-- 006_stock_allocation_view.sql
-- Creates vw_global_stock_allocation combining:
--   1. Direct stock holdings (current value)
--   2. Indirect exposure through ETFs and MFs (fund current value × stock weight%)

CREATE OR REPLACE VIEW vw_global_stock_allocation AS
WITH 
-- Direct equity stock holdings
direct_stocks AS (
    SELECT
        h.name AS stock_name,
        SUM(h.current_value) AS stock_value
    FROM vw_holdings h
    WHERE h.asset_type = 'STOCK'
    GROUP BY h.name
),
-- Indirect exposure via ETF/MF fund holdings
indirect_stocks AS (
    SELECT
        fh.holding_name AS stock_name,
        SUM(h.current_value * (fh.weight_percentage / 100.0)) AS stock_value
    FROM fund_holdings fh
    JOIN vw_holdings h ON fh.fund_asset_id = h.asset_id
    WHERE fh.holding_type = 'STOCK'
    GROUP BY fh.holding_name
),
-- Combine both sources
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
