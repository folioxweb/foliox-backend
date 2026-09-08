-- ============================================================================
-- 034_add_paper_trading_stop_loss_target_price.sql
-- Adds stop_loss and target_price columns to paper_assets and updates vw_paper_holdings
-- ============================================================================

ALTER TABLE public.paper_assets 
  ADD COLUMN IF NOT EXISTS stop_loss NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_price NUMERIC DEFAULT NULL;

CREATE OR REPLACE VIEW public.vw_paper_holdings AS
SELECT a.asset_id,
    a.symbol,
    a.name,
    a.sector,
    a.confidence,
    a.trade_type AS badge,
    a.current_price,
    a.prev_close,
    a.stop_loss,
    a.target_price,
    sum(t.quantity) AS total_quantity,
    sum(t.quantity * t.price) / NULLIF(sum(t.quantity), 0::numeric) AS avg_price,
    sum(t.quantity * t.price) AS invested_value,
    sum(t.quantity) * a.current_price AS current_value,
    sum(t.quantity) * a.current_price - sum(t.quantity * t.price) AS return_abs,
        CASE
            WHEN sum(t.quantity * t.price) > 0::numeric THEN (sum(t.quantity) * a.current_price - sum(t.quantity * t.price)) / sum(t.quantity * t.price) * 100::numeric
            ELSE 0::numeric
        END AS return_pct,
    sum(t.quantity) * (a.current_price - a.prev_close) AS day_change_abs,
        CASE
            WHEN a.prev_close > 0::numeric THEN (a.current_price - a.prev_close) / a.prev_close * 100::numeric
            ELSE 0::numeric
        END AS day_change_pct
   FROM paper_assets a
     JOIN paper_transactions t ON a.asset_id = t.asset_id
  GROUP BY a.asset_id, a.symbol, a.name, a.sector, a.confidence, a.trade_type, a.current_price, a.prev_close, a.stop_loss, a.target_price
 HAVING sum(t.quantity) > 0::numeric;

GRANT SELECT ON public.vw_paper_holdings TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
