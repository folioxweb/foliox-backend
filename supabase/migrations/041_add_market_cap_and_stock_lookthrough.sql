-- ============================================================================
-- 041_add_market_cap_and_stock_lookthrough.sql
-- 1. Adds market_cap_category column to nse_stocks ('Large Cap', 'Mid Cap', 'Small Cap').
-- 2. Seeds official SEBI/AMFI Nifty 100 (Large Cap) & Nifty Midcap 150 (Mid Cap) symbols.
-- 3. Upgrades vw_global_stock_allocation to expose market_cap_category.
-- 4. Creates RPC get_stock_lookthrough(p_stock_name text) for X-Ray fund analysis.
-- ============================================================================

-- 1. Add column to nse_stocks if not exists
ALTER TABLE public.nse_stocks 
ADD COLUMN IF NOT EXISTS market_cap_category VARCHAR(20) DEFAULT 'Small Cap';

-- 2. Populate Large Cap (Nifty 100 Universe)
UPDATE public.nse_stocks
SET market_cap_category = 'Large Cap'
WHERE symbol IN (
    'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'BHARTIARTL', 'INFY', 'SBIN', 'ITC', 
    'LT', 'HINDUNILVR', 'BAJFINANCE', 'HCLTECH', 'SUNPHARMA', 'TATAMOTORS', 'ONGC', 
    'NTPC', 'M&M', 'KOTAKBANK', 'AXISBANK', 'COALINDIA', 'MARUTI', 'BEL', 'ADANIENT', 
    'ADANIPORTS', 'ULTRACEMCO', 'TITAN', 'POWERGRID', 'WIPRO', 'BAJAJFINSV', 'DMART', 
    'SIEMENS', 'BAJAJ-AUTO', 'IOC', 'TATASTEEL', 'HINDALCO', 'GRASIM', 'ZOMATO', 
    'SBILIFE', 'PFC', 'RECLTD', 'INDIGO', 'DLF', 'TRENT', 'NESTLEIND', 'VBL', 
    'JSWSTEEL', 'GAIL', 'TECHM', 'BPCL', 'JIOFIN', 'VEDL', 'ADANIGREEN', 'ADANIPOWER', 
    'PNB', 'BANKBARODA', 'SHRIRAMFIN', 'EICHERMOT', 'CHOLAFIN', 'HAVELLS', 'AMBUJACEM', 
    'CIPLA', 'DRREDDY', 'APOLLOHOSP', 'TVSMOTOR', 'MCDOWELL-N', 'TATAPOWER', 'ABB', 
    'DIVISLAB', 'POLYCAB', 'GODREJCP', 'PIDILITIND', 'LODHA', 'BOSCHLTD', 'HAL', 
    'CUMMINSIND', 'MOTHERSON', 'TORNTPHARM', 'COLPAL', 'CGPOWER', 'MAXHEALTH', 
    'BHARATFORG', 'FEDERALBNK', 'PERSISTENT', 'IRCTC', 'SUZLON', 'DIXON', 'AUBANK', 
    'JUBLFOOD', 'LUPIN', 'MUTHOOTFIN', 'SUPREMEIND', 'INDHOTEL', 'ASHOKLEY', 'CONCOR', 
    'BIOCON', 'PAGEIND', 'MRF', 'ASTRAL', 'DEEPAKNTR'
);

-- 3. Populate Mid Cap (Nifty Midcap 150 Universe)
UPDATE public.nse_stocks
SET market_cap_category = 'Mid Cap'
WHERE market_cap_category <> 'Large Cap'
  AND symbol IN (
    'GMRINFRA', 'YESBANK', 'TATACOMM', 'IDFCFIRSTB', 'ABCAPITAL', 'LICHSGFIN', 'ACC', 
    'VOLTAS', 'OBEROIRLTY', 'PRESTIGE', 'PHOENIXLTD', 'BSOFT', 'MPHASIS', 'KPITTECH', 
    'TATAELXSI', 'LTTS', 'OFSS', 'COFORGE', 'CYIENT', 'SONACOMS', 'ESCORTS', 'EXIDEIND', 
    'BALKRISIND', 'APOLLOTYRE', 'SUNDRMFAST', 'ENDURANCE', 'GLENMARK', 'ALKEM', 'IPCALAB', 
    'JBCHEPHARM', 'NATCOPHARM', 'GRANULES', 'SANOFI', 'ABBOTINDIA', 'LAURUSLABS', 
    'SYNGENE', 'FORTIS', 'ASTERDM', 'NH', 'METROPOLIS', 'LALPATHLAB', 'DALBHARAT', 
    'RAMCOCEM', 'JKCEMENT', 'NUVOCO', 'STARCEMENT', 'KANSAINER', 'BERGEPAINT', 
    'ASIANPAINT', 'CLEAN', 'TATACHEM', 'FLUOROCHEM', 'AARTIIND', 'ATUL', 'VINATIORGA', 
    'NAVINFLUOR', 'SUMICHEM', 'UPL', 'PIIND', 'COROMANDEL', 'CHAMBLFERT', 'FACT', 
    'RCF', 'DEEPAKFERT', 'GODREJPROP', 'BRIGADE', 'SOBHA', 'SUNTECK', 'MAHLIFE', 
    'DELHIVERY', 'BLUEDART', 'TCI', 'ALLCARGO', 'VGUARD', 'CROMPTON', 'WHIRLPOOL', 
    'SYMPHONY', 'AMBER', 'BLUESTARCO', 'KAJARIACER', 'CERA', 'CENTURYPLY', 'GREENPANEL', 
    'GREENLAM', 'RADICO', 'TI', 'SOMATEX', 'UBL', 'DEVYANI', 'SAPPHIRE', 'WESTLIFE', 
    'BARBEQUE', 'RBA', 'BIKAJI', 'BECTORFOOD', 'BATAINDIA', 'RELAXO', 'METROBRAND', 
    'CAMPUS', 'KALYANKJIL', 'SENCO', 'THANGAMAYL', 'PVRINOX', 'ZEEL', 'SAREGAMA', 
    'TIPSINDLTD', 'SUNTV', 'TV18BRDCST', 'NETWORK18', 'NAZARA', 'INDIAMART', 'JUSTDIAL', 
    'FSL', 'ZENSARTECH', 'HAPPSTMNDS', 'MASTEK', 'TANLA', 'ROUTE', 'NEWGEN', 'CEATLTD', 
    'JKTYRE', 'MRPL', 'CHENNPETRO', 'HINDPETRO', 'GSPL', 'IGL', 'MGL', 'GUJGASLTD'
);

-- 4. Upgrade vw_global_stock_allocation with market_cap_category
DROP VIEW IF EXISTS public.vw_global_stock_allocation;

CREATE VIEW public.vw_global_stock_allocation WITH (security_invoker = true) AS
WITH direct_stocks AS (
    SELECT
        TRIM(REGEXP_REPLACE(h.name, '\s+(Limited|Ltd\.?)$', ' Ltd', 'i')) AS stock_name,
        COALESCE(NULLIF(TRIM(h.sector), ''), 'Other') AS sector,
        SUM(h.current_value) AS direct_value,
        0::numeric AS indirect_value,
        SUM(h.current_value) AS stock_value
    FROM public.vw_holdings h
    WHERE h.asset_type = 'STOCK'
    GROUP BY 
        TRIM(REGEXP_REPLACE(h.name, '\s+(Limited|Ltd\.?)$', ' Ltd', 'i')),
        COALESCE(NULLIF(TRIM(h.sector), ''), 'Other')
),
clean_nse AS (
    SELECT DISTINCT ON (LOWER(TRIM(REGEXP_REPLACE(name, '\s+(Limited|Ltd\.?)$', ' Ltd', 'i'))))
        LOWER(TRIM(REGEXP_REPLACE(name, '\s+(Limited|Ltd\.?)$', ' Ltd', 'i'))) AS clean_name,
        sector,
        COALESCE(market_cap_category, 'Small Cap') AS market_cap_category
    FROM public.nse_stocks
    WHERE (sector IS NOT NULL AND TRIM(sector) <> '') OR market_cap_category IS NOT NULL
),
clean_assets AS (
    SELECT DISTINCT ON (LOWER(TRIM(REGEXP_REPLACE(name, '\s+(Limited|Ltd\.?)$', ' Ltd', 'i'))))
        LOWER(TRIM(REGEXP_REPLACE(name, '\s+(Limited|Ltd\.?)$', ' Ltd', 'i'))) AS clean_name,
        sector
    FROM public.assets
    WHERE asset_type = 'STOCK' AND sector IS NOT NULL AND TRIM(sector) <> ''
),
user_funds AS (
    SELECT 
        h.asset_id,
        h.current_value AS fund_current_value
    FROM public.vw_holdings h
    WHERE h.asset_type IN ('MF', 'ETF')
      AND h.current_value > 0
),
matched_fund_holdings AS (
    SELECT 
        TRIM(REGEXP_REPLACE(fh.holding_name, '\s+(Limited|Ltd\.?)$', ' Ltd', 'i')) AS stock_name,
        ROUND(uf.fund_current_value * (fh.weight_percentage / 100.0), 2) AS indirect_value
    FROM user_funds uf
    JOIN LATERAL (
        SELECT fh_inner.holding_name, fh_inner.weight_percentage
        FROM public.fund_holdings fh_inner
        WHERE fh_inner.fund_asset_id = uf.asset_id
          AND fh_inner.holding_type = 'STOCK'
        
        UNION ALL
        
        SELECT fh_inner.holding_name, fh_inner.weight_percentage
        FROM public.fund_holdings fh_inner
        WHERE fh_inner.holding_type = 'STOCK'
          AND NOT EXISTS (
              SELECT 1 FROM public.fund_holdings fh_check 
              WHERE fh_check.fund_asset_id = uf.asset_id
          )
          AND fh_inner.fund_asset_id = (
              SELECT a_other.asset_id 
              FROM public.assets a_user
              JOIN public.assets a_other ON a_other.isin = a_user.isin 
                                        AND a_other.isin IS NOT NULL 
                                        AND a_other.asset_id <> a_user.asset_id
              WHERE a_user.asset_id = uf.asset_id
                AND EXISTS (SELECT 1 FROM public.fund_holdings fh_exist WHERE fh_exist.fund_asset_id = a_other.asset_id)
              LIMIT 1
          )
    ) fh ON true
),
indirect_stocks AS (
    SELECT
        mfh.stock_name,
        COALESCE(
            NULLIF(TRIM(MAX(ns.sector)), ''),
            NULLIF(TRIM(MAX(ca.sector)), ''),
            'Other'
        ) AS sector,
        COALESCE(MAX(ns.market_cap_category), 'Small Cap') AS market_cap_category,
        0::numeric AS direct_value,
        SUM(mfh.indirect_value) AS indirect_value,
        SUM(mfh.indirect_value) AS stock_value
    FROM matched_fund_holdings mfh
    LEFT JOIN clean_nse ns ON ns.clean_name = LOWER(mfh.stock_name)
    LEFT JOIN clean_assets ca ON ca.clean_name = LOWER(mfh.stock_name)
    GROUP BY mfh.stock_name
),
combined_stocks AS (
    SELECT 
        ds.stock_name, 
        ds.sector, 
        COALESCE(ns.market_cap_category, 'Small Cap') AS market_cap_category,
        ds.direct_value, 
        ds.indirect_value, 
        ds.stock_value 
    FROM direct_stocks ds
    LEFT JOIN clean_nse ns ON ns.clean_name = LOWER(ds.stock_name)
    
    UNION ALL
    
    SELECT 
        ind.stock_name, 
        ind.sector, 
        ind.market_cap_category,
        ind.direct_value, 
        ind.indirect_value, 
        ind.stock_value 
    FROM indirect_stocks ind
)
SELECT
    stock_name,
    SUM(stock_value) AS total_exposure,
    SUM(stock_value) / NULLIF(SUM(SUM(stock_value)) OVER (), 0) * 100 AS allocation_pct,
    COALESCE(NULLIF(MAX(sector), 'Other'), 'Other') AS sector,
    COALESCE(NULLIF(MAX(market_cap_category), ''), 'Small Cap') AS market_cap_category,
    SUM(direct_value) AS direct_value,
    SUM(indirect_value) AS indirect_value
FROM combined_stocks
GROUP BY stock_name
ORDER BY total_exposure DESC;

GRANT SELECT ON public.vw_global_stock_allocation TO authenticated, anon, service_role;

-- 5. Create RPC get_stock_lookthrough(p_stock_name text)
CREATE OR REPLACE FUNCTION public.get_stock_lookthrough(p_stock_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
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
    WITH user_funds AS (
        SELECT 
            h.asset_id,
            h.name AS fund_name,
            h.asset_type AS fund_type,
            h.category AS scheme_category,
            h.current_value AS fund_current_value
        FROM public.vw_holdings h
        WHERE h.asset_type IN ('MF', 'ETF')
          AND h.current_value > 0
    ),
    matched_holdings AS (
        SELECT 
            uf.fund_name,
            uf.fund_type,
            uf.asset_id AS fund_asset_id,
            COALESCE(uf.scheme_category, uf.fund_type) AS scheme_category,
            fh.weight_percentage,
            ROUND(uf.fund_current_value * (fh.weight_percentage / 100.0), 2) AS user_exposure,
            ROUND(uf.fund_current_value, 2) AS fund_total_value
        FROM user_funds uf
        JOIN LATERAL (
            SELECT fh_inner.holding_name, fh_inner.weight_percentage
            FROM public.fund_holdings fh_inner
            WHERE fh_inner.fund_asset_id = uf.asset_id
              AND fh_inner.holding_type = 'STOCK'
              AND LOWER(TRIM(REGEXP_REPLACE(fh_inner.holding_name, '\s+(Limited|Ltd\.?)$', '', 'i'))) = LOWER(v_core_name)
            
            UNION ALL
            
            SELECT fh_inner.holding_name, fh_inner.weight_percentage
            FROM public.fund_holdings fh_inner
            WHERE fh_inner.holding_type = 'STOCK'
              AND LOWER(TRIM(REGEXP_REPLACE(fh_inner.holding_name, '\s+(Limited|Ltd\.?)$', '', 'i'))) = LOWER(v_core_name)
              AND NOT EXISTS (
                  SELECT 1 FROM public.fund_holdings fh_check 
                  WHERE fh_check.fund_asset_id = uf.asset_id
              )
              AND fh_inner.fund_asset_id = (
                  SELECT a_other.asset_id 
                  FROM public.assets a_user
                  JOIN public.assets a_other ON a_other.isin = a_user.isin 
                                            AND a_other.isin IS NOT NULL 
                                            AND a_other.asset_id <> a_user.asset_id
                  WHERE a_user.asset_id = uf.asset_id
                    AND EXISTS (SELECT 1 FROM public.fund_holdings fh_exist WHERE fh_exist.fund_asset_id = a_other.asset_id)
                  LIMIT 1
              )
        ) fh ON true
    )
    SELECT 
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'fund_name', mh.fund_name,
                'fund_type', mh.fund_type,
                'fund_asset_id', mh.fund_asset_id,
                'scheme_category', mh.scheme_category,
                'weight_percentage', mh.weight_percentage,
                'user_exposure', mh.user_exposure,
                'fund_total_value', mh.fund_total_value
            ) ORDER BY mh.user_exposure DESC
        ), '[]'::jsonb),
        COALESCE(SUM(mh.user_exposure), 0)
    INTO v_funds, v_indirect_val
    FROM matched_holdings mh;

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
