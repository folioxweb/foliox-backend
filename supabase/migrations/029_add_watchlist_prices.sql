-- ============================================================================
-- 029_add_watchlist_prices.sql
-- Adds current_price and prev_close to watchlist_items
-- Updates vw_watchlist to reflect live updated prices for watchlist stocks
-- ============================================================================

ALTER TABLE public.watchlist_items 
    ADD COLUMN IF NOT EXISTS current_price NUMERIC(15, 4),
    ADD COLUMN IF NOT EXISTS prev_close NUMERIC(15, 4),
    ADD COLUMN IF NOT EXISTS last_price_updated TIMESTAMPTZ;

-- Recreate vw_watchlist to use watchlist_items prices before defaulting to added_price
CREATE OR REPLACE VIEW vw_watchlist WITH (security_invoker = true) AS
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
    COALESCE(pa.current_price, a.current_price, w.current_price, w.added_price) AS current_price,
    COALESCE(pa.prev_close, a.prev_close, w.prev_close, w.added_price) AS prev_close,
    CASE 
        WHEN w.added_price > 0 THEN ((COALESCE(pa.current_price, a.current_price, w.current_price, w.added_price) - w.added_price) / w.added_price) * 100 
        ELSE 0 
    END AS return_since_added_pct,
    (COALESCE(pa.current_price, a.current_price, w.current_price, w.added_price) - w.added_price) AS return_since_added_abs,
    CASE 
        WHEN COALESCE(pa.prev_close, a.prev_close, w.prev_close, 0) > 0 THEN ((COALESCE(pa.current_price, a.current_price, w.current_price, 0) - COALESCE(pa.prev_close, a.prev_close, w.prev_close, 0)) / COALESCE(pa.prev_close, a.prev_close, w.prev_close, 1)) * 100 
        ELSE 0 
    END AS day_change_pct,
    (COALESCE(pa.current_price, a.current_price, w.current_price, 0) - COALESCE(pa.prev_close, a.prev_close, w.prev_close, 0)) AS day_change_abs,
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
LEFT JOIN paper_assets pa ON (w.symbol = pa.symbol AND w.user_id = pa.user_id);
