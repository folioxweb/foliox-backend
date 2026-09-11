-- ============================================================================
-- 038_create_vw_tradebook.sql
-- Creates vw_tradebook view with security_invoker = true for the Tradebook ledger.
-- Joins transactions with asset metadata, computes turnover, cost basis,
-- and indexes transactions by user and date for fast pagination & filtering.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON public.transactions(user_id, tx_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_asset_date ON public.transactions(asset_id, tx_date DESC);

CREATE OR REPLACE VIEW public.vw_tradebook WITH (security_invoker = true) AS
SELECT 
    t.tx_id,
    t.user_id,
    t.asset_id,
    a.symbol,
    a.name,
    a.asset_type,
    a.sector,
    a.category,
    a.isin,
    a.current_price,
    t.tx_type,
    ABS(t.quantity) AS quantity,
    t.quantity AS signed_quantity,
    t.price,
    COALESCE(t.cost_price, t.price) AS cost_price,
    t.realized_gain,
    t.tx_date,
    t.fd_principal,
    t.fd_rate,
    t.fd_maturity_date,
    CASE 
        WHEN a.asset_type = 'FD' THEN COALESCE(t.fd_principal, t.price)
        ELSE ABS(t.quantity) * t.price 
    END AS turnover
FROM public.transactions t
JOIN public.assets a ON t.asset_id = a.asset_id
ORDER BY t.tx_date DESC;

GRANT SELECT ON public.vw_tradebook TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
