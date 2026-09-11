-- ============================================================================
-- 036_fix_portfolio_cost_basis_and_fd.sql
-- Fixes:
-- 1. Adds cost_price and realized_gain to transactions and paper_transactions.
-- 2. Updates vw_holdings to compute cost basis using COALESCE(t.cost_price, t.price)
--    and exposes tx_id for Fixed Deposits.
-- 3. Updates vw_paper_holdings to use COALESCE(t.cost_price, t.price).
-- ============================================================================

-- 1. Alter transactions table
ALTER TABLE public.transactions 
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15, 4),
  ADD COLUMN IF NOT EXISTS realized_gain NUMERIC(15, 4);

UPDATE public.transactions 
SET cost_price = price 
WHERE cost_price IS NULL;

-- 2. Alter paper_transactions table
ALTER TABLE public.paper_transactions 
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(15, 4),
  ADD COLUMN IF NOT EXISTS realized_gain NUMERIC(15, 4);

UPDATE public.paper_transactions 
SET cost_price = price 
WHERE cost_price IS NULL;

-- 3. Update vw_holdings
CREATE OR REPLACE VIEW public.vw_holdings WITH (security_invoker = true) AS
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
    SUM(t.quantity * COALESCE(t.cost_price, t.price)) / NULLIF(SUM(t.quantity), 0) AS avg_price,
    SUM(t.quantity * COALESCE(t.cost_price, t.price)) AS invested_value,
    SUM(t.quantity) * a.current_price AS current_value,
    (SUM(t.quantity) * a.current_price) - SUM(t.quantity * COALESCE(t.cost_price, t.price)) AS return_abs,
    CASE 
        WHEN SUM(t.quantity * COALESCE(t.cost_price, t.price)) > 0 
        THEN ((SUM(t.quantity) * a.current_price) - SUM(t.quantity * COALESCE(t.cost_price, t.price))) / SUM(t.quantity * COALESCE(t.cost_price, t.price)) * 100 
        ELSE 0 
    END AS return_pct,
    SUM(t.quantity) * (a.current_price - a.prev_close) AS day_change_abs,
    CASE 
        WHEN a.prev_close > 0 
        THEN (a.current_price - a.prev_close) / a.prev_close * 100 
        ELSE 0 
    END AS day_change_pct,
    sip.is_enabled AS sip_enabled,
    sip.sip_day,
    sip.sip_amount,
    sip.last_sip_date,
    NULL::numeric AS fd_rate,
    NULL::date AS start_date,
    NULL::date AS maturity_date,
    NULL::uuid AS tx_id
FROM public.assets a
JOIN public.transactions t ON a.asset_id = t.asset_id
LEFT JOIN public.mf_sip_configs sip ON (a.asset_id = sip.asset_id AND t.user_id = sip.user_id)
WHERE a.asset_type IN ('STOCK', 'ETF', 'MF')
GROUP BY a.asset_id, a.symbol, a.name, a.asset_type, a.sector, a.category, a.confidence, a.trade_type, a.current_price, a.prev_close, sip.is_enabled, sip.sip_day, sip.sip_amount, sip.last_sip_date
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
    MAX(t.fd_maturity_date) AS maturity_date,
    MAX(t.tx_id::text)::uuid AS tx_id
FROM public.assets a
JOIN public.transactions t ON a.asset_id = t.asset_id
WHERE a.asset_type = 'FD'
GROUP BY a.asset_id, a.symbol, a.name, a.asset_type
HAVING SUM(t.fd_principal) > 0;

GRANT SELECT ON public.vw_holdings TO authenticated, anon, service_role;

-- 4. Update vw_paper_holdings
CREATE OR REPLACE VIEW public.vw_paper_holdings AS
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
    SUM(t.quantity * COALESCE(t.cost_price, t.price)) / NULLIF(SUM(t.quantity), 0::numeric) AS avg_price,
    SUM(t.quantity * COALESCE(t.cost_price, t.price)) AS invested_value,
    SUM(t.quantity) * a.current_price AS current_value,
    SUM(t.quantity) * a.current_price - SUM(t.quantity * COALESCE(t.cost_price, t.price)) AS return_abs,
    CASE
        WHEN SUM(t.quantity * COALESCE(t.cost_price, t.price)) > 0::numeric 
        THEN (SUM(t.quantity) * a.current_price - SUM(t.quantity * COALESCE(t.cost_price, t.price))) / SUM(t.quantity * COALESCE(t.cost_price, t.price)) * 100::numeric
        ELSE 0::numeric
    END AS return_pct,
    SUM(t.quantity) * (a.current_price - a.prev_close) AS day_change_abs,
    CASE
        WHEN a.prev_close > 0::numeric 
        THEN (a.current_price - a.prev_close) / a.prev_close * 100::numeric
        ELSE 0::numeric
    END AS day_change_pct,
    a.stop_loss,
    a.target_price
FROM public.paper_assets a
JOIN public.paper_transactions t ON a.asset_id = t.asset_id
GROUP BY a.asset_id, a.symbol, a.name, a.sector, a.confidence, a.trade_type, a.current_price, a.prev_close, a.stop_loss, a.target_price
HAVING SUM(t.quantity) > 0::numeric;

GRANT SELECT ON public.vw_paper_holdings TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
