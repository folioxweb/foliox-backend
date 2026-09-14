-- ============================================================================
-- 042_fix_stock_lookthrough_rpc.sql
-- Fixes:
-- 1. Uses correct column names from public.vw_holdings:
--    - h.total_quantity (instead of h.quantity)
--    - h.avg_price (instead of h.avg_cost_price)
--    - h.return_abs (instead of h.unrealized_pnl)
--    - h.return_pct (instead of h.unrealized_pnl_pct)
-- 2. Enhanced stock name matching across trailing 'Limited'/'Ltd' variations.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_stock_lookthrough(p_stock_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_clean_name text;
    v_core_name text;
    v_direct jsonb := null;
    v_funds jsonb := '[]'::jsonb;
    v_sector text := 'Other';
    v_mcap text := 'Small Cap';
    v_total_exposure numeric := 0;
    v_direct_val numeric := 0;
    v_indirect_val numeric := 0;
BEGIN
    v_clean_name := TRIM(REGEXP_REPLACE(p_stock_name, '\s+(Limited|Ltd\.?)$', ' Ltd', 'i'));
    v_core_name := TRIM(REGEXP_REPLACE(p_stock_name, '\s+(Limited|Ltd\.?)$', '', 'i'));

    -- 1. Sector & Market Cap
    SELECT 
        COALESCE(NULLIF(TRIM(ns.sector), ''), 'Other'),
        COALESCE(ns.market_cap_category, 'Small Cap')
    INTO v_sector, v_mcap
    FROM public.nse_stocks ns
    WHERE LOWER(TRIM(REGEXP_REPLACE(ns.name, '\s+(Limited|Ltd\.?)$', '', 'i'))) = LOWER(v_core_name)
       OR LOWER(ns.symbol) = LOWER(p_stock_name)
       OR LOWER(ns.symbol) = LOWER(v_core_name)
    LIMIT 1;

    -- If not found in nse_stocks, fallback to assets table
    IF v_sector = 'Other' OR v_sector IS NULL THEN
        SELECT COALESCE(NULLIF(TRIM(a.sector), ''), 'Other')
        INTO v_sector
        FROM public.assets a
        WHERE a.asset_type = 'STOCK'
          AND (
              LOWER(TRIM(REGEXP_REPLACE(a.name, '\s+(Limited|Ltd\.?)$', '', 'i'))) = LOWER(v_core_name)
              OR LOWER(a.symbol) = LOWER(p_stock_name)
              OR LOWER(a.symbol) = LOWER(v_core_name)
          )
        LIMIT 1;
        v_sector := COALESCE(v_sector, 'Other');
    END IF;

    -- 2. Direct Holding Position from vw_holdings
    SELECT jsonb_build_object(
        'shares', COALESCE(h.total_quantity, 0),
        'avg_price', ROUND(COALESCE(h.avg_price, 0), 2),
        'current_price', ROUND(COALESCE(h.current_price, 0), 2),
        'invested_value', ROUND(COALESCE(h.invested_value, 0), 2),
        'current_value', ROUND(COALESCE(h.current_value, 0), 2),
        'pnl', ROUND(COALESCE(h.return_abs, 0), 2),
        'pnl_pct', ROUND(COALESCE(h.return_pct, 0), 2)
    )
    INTO v_direct
    FROM public.vw_holdings h
    WHERE h.asset_type = 'STOCK'
      AND (
          LOWER(TRIM(REGEXP_REPLACE(h.name, '\s+(Limited|Ltd\.?)$', '', 'i'))) = LOWER(v_core_name)
          OR LOWER(h.symbol) = LOWER(p_stock_name)
          OR LOWER(h.symbol) = LOWER(v_core_name)
      )
    LIMIT 1;

    IF v_direct IS NOT NULL THEN
        v_direct_val := COALESCE((v_direct->>'current_value')::numeric, 0);
    END IF;

    -- 3. Indirect Fund Breakdown from fund_holdings joined to vw_holdings
    SELECT COALESCE(jsonb_agg(f_item), '[]'::jsonb)
    INTO v_funds
    FROM (
        SELECT jsonb_build_object(
            'fund_name', a_fund.name,
            'fund_type', a_fund.asset_type,
            'fund_asset_id', a_fund.asset_id,
            'scheme_category', COALESCE(a_fund.category, a_fund.asset_type),
            'weight_percentage', fh.weight_percentage,
            'user_exposure', ROUND(COALESCE(h.current_value, 0) * (fh.weight_percentage / 100.0), 2),
            'fund_total_value', ROUND(COALESCE(h.current_value, 0), 2)
        ) AS f_item
        FROM public.fund_holdings fh
        JOIN public.assets a_fund ON a_fund.asset_id = fh.fund_asset_id
        JOIN public.vw_holdings h ON (
            h.asset_id = fh.fund_asset_id 
            OR EXISTS (
                SELECT 1 FROM public.assets a_holding 
                WHERE a_holding.asset_id = h.asset_id 
                  AND a_holding.isin IS NOT NULL 
                  AND a_holding.isin = a_fund.isin
            )
        )
        WHERE fh.holding_type = 'STOCK'
          AND LOWER(TRIM(REGEXP_REPLACE(fh.holding_name, '\s+(Limited|Ltd\.?)$', '', 'i'))) = LOWER(v_core_name)
        ORDER BY (COALESCE(h.current_value, 0) * (fh.weight_percentage / 100.0)) DESC
    ) sub;

    SELECT COALESCE(SUM((elem->>'user_exposure')::numeric), 0)
    INTO v_indirect_val
    FROM jsonb_array_elements(v_funds) AS elem;

    v_total_exposure := v_direct_val + v_indirect_val;

    RETURN jsonb_build_object(
        'stock_name', v_clean_name,
        'sector', v_sector,
        'market_cap_category', v_mcap,
        'total_exposure', v_total_exposure,
        'direct_value', v_direct_val,
        'indirect_value', v_indirect_val,
        'direct_holding', v_direct,
        'fund_holdings', v_funds
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_stock_lookthrough(text) TO authenticated, anon, service_role;
