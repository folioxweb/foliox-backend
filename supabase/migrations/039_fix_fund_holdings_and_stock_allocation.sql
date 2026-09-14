-- ============================================================================
-- 039_fix_fund_holdings_and_stock_allocation.sql
-- 1. Expands fund_holdings.holding_name to VARCHAR(255) to prevent truncation.
-- 2. Upgrades vw_global_stock_allocation with sector resolution, company name
--    normalization ('Limited' -> 'Ltd'), and direct vs indirect exposure tracking.
-- 3. Upgrades vw_global_sector_allocation to ensure full sector look-through.
-- 4. Seeds baseline holdings & sectors across all active portfolio funds and ETFs.
-- ============================================================================

-- 1. Safely widen holding_name column
ALTER TABLE public.fund_holdings 
    ALTER COLUMN holding_name TYPE VARCHAR(255);

-- 2. Upgrade vw_global_stock_allocation
CREATE OR REPLACE VIEW public.vw_global_stock_allocation WITH (security_invoker = true) AS
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
indirect_stocks AS (
    SELECT
        TRIM(REGEXP_REPLACE(fh.holding_name, '\s+(Limited|Ltd\.?)$', ' Ltd', 'i')) AS stock_name,
        COALESCE(
            NULLIF(TRIM(MAX(ns.sector)), ''),
            NULLIF(TRIM(MAX(a.sector)), ''),
            'Other'
        ) AS sector,
        0::numeric AS direct_value,
        SUM(h.current_value * (fh.weight_percentage / 100.0)) AS indirect_value,
        SUM(h.current_value * (fh.weight_percentage / 100.0)) AS stock_value
    FROM public.fund_holdings fh
    JOIN public.vw_holdings h ON fh.fund_asset_id = h.asset_id
    LEFT JOIN public.nse_stocks ns ON (
        LOWER(TRIM(ns.name)) = LOWER(TRIM(fh.holding_name))
        OR LOWER(TRIM(REGEXP_REPLACE(ns.name, '\s+(Limited|Ltd\.?)$', '', 'i'))) = LOWER(TRIM(REGEXP_REPLACE(fh.holding_name, '\s+(Limited|Ltd\.?)$', '', 'i')))
    )
    LEFT JOIN public.assets a ON (
        (LOWER(TRIM(a.name)) = LOWER(TRIM(fh.holding_name))
         OR LOWER(TRIM(REGEXP_REPLACE(a.name, '\s+(Limited|Ltd\.?)$', '', 'i'))) = LOWER(TRIM(REGEXP_REPLACE(fh.holding_name, '\s+(Limited|Ltd\.?)$', '', 'i'))))
        AND a.asset_type = 'STOCK'
    )
    WHERE fh.holding_type = 'STOCK'
    GROUP BY TRIM(REGEXP_REPLACE(fh.holding_name, '\s+(Limited|Ltd\.?)$', ' Ltd', 'i'))
),
combined_stocks AS (
    SELECT stock_name, sector, direct_value, indirect_value, stock_value FROM direct_stocks
    UNION ALL
    SELECT stock_name, sector, direct_value, indirect_value, stock_value FROM indirect_stocks
)
SELECT
    stock_name,
    COALESCE(NULLIF(MAX(sector), 'Other'), 'Other') AS sector,
    SUM(direct_value) AS direct_value,
    SUM(indirect_value) AS indirect_value,
    SUM(stock_value) AS total_exposure,
    SUM(stock_value) / NULLIF(SUM(SUM(stock_value)) OVER (), 0) * 100 AS allocation_pct
FROM combined_stocks
GROUP BY stock_name
ORDER BY total_exposure DESC;

GRANT SELECT ON public.vw_global_stock_allocation TO authenticated, anon, service_role;

-- 3. Upgrade vw_global_sector_allocation
CREATE OR REPLACE VIEW public.vw_global_sector_allocation WITH (security_invoker = true) AS
WITH direct_sectors AS (
    SELECT 
        COALESCE(NULLIF(TRIM(h.sector), ''), 'Other') AS sector_name,
        SUM(h.current_value) AS sector_value
    FROM public.vw_holdings h
    WHERE h.asset_type = 'STOCK'
    GROUP BY COALESCE(NULLIF(TRIM(h.sector), ''), 'Other')
),
indirect_sectors AS (
    SELECT 
        COALESCE(NULLIF(TRIM(fh.holding_name), ''), 'Other') AS sector_name,
        SUM(h.current_value * (fh.weight_percentage / 100.0)) AS sector_value
    FROM public.fund_holdings fh
    JOIN public.vw_holdings h ON fh.fund_asset_id = h.asset_id
    WHERE fh.holding_type = 'SECTOR'
    GROUP BY COALESCE(NULLIF(TRIM(fh.holding_name), ''), 'Other')
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

GRANT SELECT ON public.vw_global_sector_allocation TO authenticated, anon, service_role;

-- 4. Seed baseline constituent holdings for all portfolio funds and ETFs

-- 4.1 Parag Parikh Flexi Cap Fund (ISIN: INF879O01027)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF879O01027' OR name ILIKE '%Parag Parikh Flexi Cap%'
    LOOP
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'STOCK', 'HDFC Bank Ltd', 7.63),
        (rec.asset_id, 'STOCK', 'ICICI Bank Ltd', 5.67),
        (rec.asset_id, 'STOCK', 'Power Grid Corp Of India Ltd', 5.58),
        (rec.asset_id, 'STOCK', 'ITC Ltd', 5.26),
        (rec.asset_id, 'STOCK', 'Bajaj Holdings and Investment Ltd', 5.14),
        (rec.asset_id, 'STOCK', 'Coal India Ltd', 5.02),
        (rec.asset_id, 'STOCK', 'Kotak Mahindra Bank Ltd', 4.40),
        (rec.asset_id, 'STOCK', 'HCL Technologies Ltd', 4.15),
        (rec.asset_id, 'STOCK', 'Alphabet Inc Class A', 4.14),
        (rec.asset_id, 'STOCK', 'Mahindra & Mahindra Ltd', 3.97),
        (rec.asset_id, 'STOCK', 'Infosys Ltd', 3.29),
        (rec.asset_id, 'STOCK', 'Axis Bank Ltd', 2.97),
        (rec.asset_id, 'STOCK', 'Tata Consultancy Services Ltd', 2.88),
        (rec.asset_id, 'STOCK', 'Bharti Airtel Ltd', 2.80),
        (rec.asset_id, 'STOCK', 'Maruti Suzuki India Ltd', 2.68),
        (rec.asset_id, 'STOCK', 'Central Depository Services (India) Ltd', 2.25),
        (rec.asset_id, 'STOCK', 'Multi Commodity Exchange of India Ltd', 1.85),
        (rec.asset_id, 'STOCK', 'Sun Pharmaceutical Industries Ltd', 1.72),
        (rec.asset_id, 'STOCK', 'Balkrishna Industries Ltd', 1.54),
        (rec.asset_id, 'STOCK', 'Persistent Systems Ltd', 1.45)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;

        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Financial Services', 33.50),
        (rec.asset_id, 'SECTOR', 'Technology', 14.80),
        (rec.asset_id, 'SECTOR', 'Communication Services', 12.90),
        (rec.asset_id, 'SECTOR', 'Utilities', 8.50),
        (rec.asset_id, 'SECTOR', 'Consumer Defensive', 7.20),
        (rec.asset_id, 'SECTOR', 'Consumer Cyclical', 6.90),
        (rec.asset_id, 'SECTOR', 'Energy', 5.80),
        (rec.asset_id, 'SECTOR', 'Healthcare', 3.80)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;
END $$;

-- 4.2 Quant Small Cap Fund (ISIN: INF966L01689)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF966L01689' OR name ILIKE '%Quant Small Cap%'
    LOOP
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'STOCK', 'Reliance Industries Ltd', 8.55),
        (rec.asset_id, 'STOCK', 'Jio Financial Services Ltd', 5.42),
        (rec.asset_id, 'STOCK', 'HDFC Bank Ltd', 4.95),
        (rec.asset_id, 'STOCK', 'Adani Power Ltd', 4.18),
        (rec.asset_id, 'STOCK', 'Aegis Logistics Ltd', 3.85),
        (rec.asset_id, 'STOCK', 'Bikaji Foods International Ltd', 3.42),
        (rec.asset_id, 'STOCK', 'IRB Infrastructure Developers Ltd', 3.25),
        (rec.asset_id, 'STOCK', 'HFCL Ltd', 3.12),
        (rec.asset_id, 'STOCK', 'Steel Authority of India Ltd', 2.95),
        (rec.asset_id, 'STOCK', 'National Aluminium Co Ltd', 2.80),
        (rec.asset_id, 'STOCK', 'Arvind Ltd', 2.65),
        (rec.asset_id, 'STOCK', 'Orchid Pharma Ltd', 2.50),
        (rec.asset_id, 'STOCK', 'Hindustan Copper Ltd', 2.38),
        (rec.asset_id, 'STOCK', 'Tata Communications Ltd', 2.15),
        (rec.asset_id, 'STOCK', 'PTC India Financial Services Ltd', 1.95)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;

        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Energy', 22.40),
        (rec.asset_id, 'SECTOR', 'Financial Services', 18.50),
        (rec.asset_id, 'SECTOR', 'Basic Materials', 15.60),
        (rec.asset_id, 'SECTOR', 'Industrials', 12.80),
        (rec.asset_id, 'SECTOR', 'Communication Services', 9.20),
        (rec.asset_id, 'SECTOR', 'Healthcare', 8.50),
        (rec.asset_id, 'SECTOR', 'Consumer Defensive', 7.40)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;
END $$;

-- 4.3 Axis Midcap Fund (ISIN: INF846K01EH3)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF846K01EH3' OR name ILIKE '%Axis Midcap%'
    LOOP
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'STOCK', 'The Federal Bank Ltd', 4.12),
        (rec.asset_id, 'STOCK', 'Cholamandalam Investment and Finance Co Ltd', 3.95),
        (rec.asset_id, 'STOCK', 'Persistent Systems Ltd', 3.82),
        (rec.asset_id, 'STOCK', 'Trent Ltd', 3.65),
        (rec.asset_id, 'STOCK', 'Astral Ltd', 3.48),
        (rec.asset_id, 'STOCK', 'Supreme Industries Ltd', 3.25),
        (rec.asset_id, 'STOCK', 'Cummins India Ltd', 3.10),
        (rec.asset_id, 'STOCK', 'Coforge Ltd', 2.95),
        (rec.asset_id, 'STOCK', 'PI Industries Ltd', 2.80),
        (rec.asset_id, 'STOCK', 'Crompton Greaves Consumer Electricals Ltd', 2.65),
        (rec.asset_id, 'STOCK', 'Sundram Fasteners Ltd', 2.45),
        (rec.asset_id, 'STOCK', 'ICICI Bank Ltd', 2.30),
        (rec.asset_id, 'STOCK', 'Bharat Electronics Ltd', 2.15),
        (rec.asset_id, 'STOCK', 'Tata Elxsi Ltd', 2.05),
        (rec.asset_id, 'STOCK', 'The Indian Hotels Co Ltd', 1.85)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;

        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Financial Services', 21.45),
        (rec.asset_id, 'SECTOR', 'Industrials', 18.20),
        (rec.asset_id, 'SECTOR', 'Technology', 15.35),
        (rec.asset_id, 'SECTOR', 'Consumer Cyclical', 12.80),
        (rec.asset_id, 'SECTOR', 'Basic Materials', 9.60),
        (rec.asset_id, 'SECTOR', 'Healthcare', 7.50),
        (rec.asset_id, 'SECTOR', 'Consumer Defensive', 6.20)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;
END $$;

-- 4.4 HDFC Large and Mid Cap Fund (ISIN: INF179KA1RQ7)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF179KA1RQ7' OR name ILIKE '%HDFC Large and Mid Cap%'
    LOOP
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'STOCK', 'ICICI Bank Ltd', 5.82),
        (rec.asset_id, 'STOCK', 'HDFC Bank Ltd', 5.45),
        (rec.asset_id, 'STOCK', 'Reliance Industries Ltd', 4.92),
        (rec.asset_id, 'STOCK', 'Infosys Ltd', 4.35),
        (rec.asset_id, 'STOCK', 'Larsen & Toubro Ltd', 3.88),
        (rec.asset_id, 'STOCK', 'Axis Bank Ltd', 3.42),
        (rec.asset_id, 'STOCK', 'Bharti Airtel Ltd', 3.15),
        (rec.asset_id, 'STOCK', 'State Bank of India', 2.85),
        (rec.asset_id, 'STOCK', 'Tata Motors Ltd', 2.65),
        (rec.asset_id, 'STOCK', 'NTPC Ltd', 2.42),
        (rec.asset_id, 'STOCK', 'Sun Pharmaceutical Industries Ltd', 2.18),
        (rec.asset_id, 'STOCK', 'Bharat Electronics Ltd', 2.05),
        (rec.asset_id, 'STOCK', 'Mahindra & Mahindra Ltd', 1.95),
        (rec.asset_id, 'STOCK', 'ITC Ltd', 1.82),
        (rec.asset_id, 'STOCK', 'Titan Company Ltd', 1.75)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;

        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Financial Services', 28.50),
        (rec.asset_id, 'SECTOR', 'Technology', 14.20),
        (rec.asset_id, 'SECTOR', 'Energy', 11.35),
        (rec.asset_id, 'SECTOR', 'Industrials', 10.40),
        (rec.asset_id, 'SECTOR', 'Automobile and Auto Components', 8.60),
        (rec.asset_id, 'SECTOR', 'Healthcare', 7.20),
        (rec.asset_id, 'SECTOR', 'Consumer Defensive', 6.80)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;
END $$;

-- 4.5 Parag Parikh ELSS Tax Saver Fund (ISIN: INF879O01100)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF879O01100' OR name ILIKE '%Parag Parikh ELSS%' OR name ILIKE '%Parag Parikh Tax Saver%'
    LOOP
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'STOCK', 'HDFC Bank Ltd', 7.85),
        (rec.asset_id, 'STOCK', 'Bajaj Holdings and Investment Ltd', 7.12),
        (rec.asset_id, 'STOCK', 'Power Grid Corp Of India Ltd', 6.25),
        (rec.asset_id, 'STOCK', 'ITC Ltd', 5.92),
        (rec.asset_id, 'STOCK', 'Coal India Ltd', 5.45),
        (rec.asset_id, 'STOCK', 'ICICI Bank Ltd', 4.85),
        (rec.asset_id, 'STOCK', 'HCL Technologies Ltd', 4.62),
        (rec.asset_id, 'STOCK', 'Axis Bank Ltd', 4.15),
        (rec.asset_id, 'STOCK', 'Central Depository Services (India) Ltd', 3.85),
        (rec.asset_id, 'STOCK', 'Maruti Suzuki India Ltd', 3.42),
        (rec.asset_id, 'STOCK', 'Tata Consultancy Services Ltd', 3.18),
        (rec.asset_id, 'STOCK', 'Sun Pharmaceutical Industries Ltd', 2.95),
        (rec.asset_id, 'STOCK', 'Multi Commodity Exchange of India Ltd', 2.65),
        (rec.asset_id, 'STOCK', 'Persistent Systems Ltd', 2.35)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;

        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Financial Services', 32.40),
        (rec.asset_id, 'SECTOR', 'Utilities', 14.50),
        (rec.asset_id, 'SECTOR', 'Technology', 13.80),
        (rec.asset_id, 'SECTOR', 'Consumer Defensive', 12.20),
        (rec.asset_id, 'SECTOR', 'Energy', 9.50),
        (rec.asset_id, 'SECTOR', 'Healthcare', 5.40)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;
END $$;

-- 4.6 JioBlackRock Flexi Cap Fund (ISIN: INF22M001093)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF22M001093' OR name ILIKE '%JioBlackRock%'
    LOOP
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'STOCK', 'Reliance Industries Ltd', 9.20),
        (rec.asset_id, 'STOCK', 'HDFC Bank Ltd', 7.50),
        (rec.asset_id, 'STOCK', 'ICICI Bank Ltd', 6.10),
        (rec.asset_id, 'STOCK', 'Infosys Ltd', 5.40),
        (rec.asset_id, 'STOCK', 'Tata Consultancy Services Ltd', 4.80),
        (rec.asset_id, 'STOCK', 'Larsen & Toubro Ltd', 4.20),
        (rec.asset_id, 'STOCK', 'Bharti Airtel Ltd', 3.90),
        (rec.asset_id, 'STOCK', 'State Bank of India', 3.40),
        (rec.asset_id, 'STOCK', 'ITC Ltd', 3.10),
        (rec.asset_id, 'STOCK', 'Axis Bank Ltd', 2.80)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;

        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Financial Services', 30.20),
        (rec.asset_id, 'SECTOR', 'Technology', 15.60),
        (rec.asset_id, 'SECTOR', 'Energy', 12.40),
        (rec.asset_id, 'SECTOR', 'Industrials', 10.50),
        (rec.asset_id, 'SECTOR', 'Communication Services', 8.20)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;
END $$;

-- 4.7 NIFTYBEES (Nippon India ETF Nifty 50 BeES - ISIN: INF204KB14I2)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF204KB14I2' OR symbol = 'NIFTYBEES'
    LOOP
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'STOCK', 'HDFC Bank Ltd', 11.52),
        (rec.asset_id, 'STOCK', 'Reliance Industries Ltd', 9.14),
        (rec.asset_id, 'STOCK', 'ICICI Bank Ltd', 7.85),
        (rec.asset_id, 'STOCK', 'Infosys Ltd', 5.72),
        (rec.asset_id, 'STOCK', 'ITC Ltd', 4.28),
        (rec.asset_id, 'STOCK', 'Tata Consultancy Services Ltd', 4.15),
        (rec.asset_id, 'STOCK', 'Larsen & Toubro Ltd', 4.02),
        (rec.asset_id, 'STOCK', 'Bharti Airtel Ltd', 3.85),
        (rec.asset_id, 'STOCK', 'Axis Bank Ltd', 3.25),
        (rec.asset_id, 'STOCK', 'State Bank of India', 2.95),
        (rec.asset_id, 'STOCK', 'Mahindra & Mahindra Ltd', 2.65),
        (rec.asset_id, 'STOCK', 'Kotak Mahindra Bank Ltd', 2.45),
        (rec.asset_id, 'STOCK', 'Bajaj Finance Ltd', 2.15),
        (rec.asset_id, 'STOCK', 'Sun Pharmaceutical Industries Ltd', 1.95),
        (rec.asset_id, 'STOCK', 'Tata Motors Ltd', 1.85),
        (rec.asset_id, 'STOCK', 'Maruti Suzuki India Ltd', 1.75),
        (rec.asset_id, 'STOCK', 'NTPC Ltd', 1.65),
        (rec.asset_id, 'STOCK', 'Titan Company Ltd', 1.55),
        (rec.asset_id, 'STOCK', 'Power Grid Corp Of India Ltd', 1.45),
        (rec.asset_id, 'STOCK', 'Tata Steel Ltd', 1.35)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;

        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Financial Services', 33.40),
        (rec.asset_id, 'SECTOR', 'Technology', 12.80),
        (rec.asset_id, 'SECTOR', 'Energy', 11.20),
        (rec.asset_id, 'SECTOR', 'Consumer Defensive', 8.50),
        (rec.asset_id, 'SECTOR', 'Automobile and Auto Components', 7.40),
        (rec.asset_id, 'SECTOR', 'Industrials', 6.80),
        (rec.asset_id, 'SECTOR', 'Healthcare', 4.90)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;
END $$;

-- 4.8 ITBEES (Nippon India ETF Nifty IT - ISIN: INF204KB15V2)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF204KB15V2' OR symbol = 'ITBEES'
    LOOP
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'STOCK', 'Tata Consultancy Services Ltd', 26.50),
        (rec.asset_id, 'STOCK', 'Infosys Ltd', 25.80),
        (rec.asset_id, 'STOCK', 'HCL Technologies Ltd', 10.40),
        (rec.asset_id, 'STOCK', 'Wipro Ltd', 8.20),
        (rec.asset_id, 'STOCK', 'Tech Mahindra Ltd', 7.80),
        (rec.asset_id, 'STOCK', 'LTIMindtree Ltd', 6.50),
        (rec.asset_id, 'STOCK', 'Persistent Systems Ltd', 4.90),
        (rec.asset_id, 'STOCK', 'Coforge Ltd', 4.20),
        (rec.asset_id, 'STOCK', 'Mphasis Ltd', 3.10),
        (rec.asset_id, 'STOCK', 'L&T Technology Services Ltd', 2.60)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;

        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Technology', 100.00)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;
END $$;

-- 4.9 SETFNN50 (SBI-ETF Nifty Next 50 - ISIN: INF200KA1598)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF200KA1598' OR symbol = 'SETFNN50'
    LOOP
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'STOCK', 'Trent Ltd', 4.85),
        (rec.asset_id, 'STOCK', 'Bharat Electronics Ltd', 4.52),
        (rec.asset_id, 'STOCK', 'Hindustan Aeronautics Ltd', 4.20),
        (rec.asset_id, 'STOCK', 'Tata Power Co Ltd', 3.85),
        (rec.asset_id, 'STOCK', 'Siemens Ltd', 3.65),
        (rec.asset_id, 'STOCK', 'Indian Oil Corporation Ltd', 3.42),
        (rec.asset_id, 'STOCK', 'Power Finance Corporation Ltd', 3.25),
        (rec.asset_id, 'STOCK', 'REC Ltd', 3.10),
        (rec.asset_id, 'STOCK', 'GAIL (India) Ltd', 2.95),
        (rec.asset_id, 'STOCK', 'Bank of Baroda', 2.80)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;

        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Capital Goods', 24.50),
        (rec.asset_id, 'SECTOR', 'Financial Services', 22.10),
        (rec.asset_id, 'SECTOR', 'Energy', 18.40),
        (rec.asset_id, 'SECTOR', 'Consumer Cyclical', 12.80)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;
END $$;

-- 4.10 HDFCSML250 (HDFC NIFTY Smallcap 250 ETF - ISIN: INF179KC1FB2)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF179KC1FB2' OR symbol = 'HDFCSML250'
    LOOP
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'STOCK', 'Suzlon Energy Ltd', 2.85),
        (rec.asset_id, 'STOCK', 'BSE Ltd', 2.45),
        (rec.asset_id, 'STOCK', 'Multi Commodity Exchange of India Ltd', 2.15),
        (rec.asset_id, 'STOCK', 'Central Depository Services (India) Ltd', 1.95),
        (rec.asset_id, 'STOCK', 'Exide Industries Ltd', 1.82),
        (rec.asset_id, 'STOCK', 'Amara Raja Energy & Mobility Ltd', 1.65),
        (rec.asset_id, 'STOCK', 'KPIT Technologies Ltd', 1.55),
        (rec.asset_id, 'STOCK', 'Castrol India Ltd', 1.45),
        (rec.asset_id, 'STOCK', 'Glenmark Pharmaceuticals Ltd', 1.35),
        (rec.asset_id, 'STOCK', 'Cyient Ltd', 1.25)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;

        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Capital Goods', 21.50),
        (rec.asset_id, 'SECTOR', 'Financial Services', 18.20),
        (rec.asset_id, 'SECTOR', 'Healthcare', 14.60),
        (rec.asset_id, 'SECTOR', 'Technology', 12.40),
        (rec.asset_id, 'SECTOR', 'Consumer Cyclical', 11.80)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;
END $$;

-- 4.11 Commodity ETFs: GOLDBEES & SILVERBEES
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF204KB17I5' OR symbol = 'GOLDBEES'
    LOOP
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Commodity - Gold', 100.00)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;

    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF204KC1402' OR symbol = 'SILVERBEES'
    LOOP
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Commodity - Silver', 100.00)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
