-- ============================================================================
-- 037_seed_and_link_fund_holdings_by_isin.sql
-- 1. Creates helper view vw_fund_holdings to easily query holdings by asset_id or ISIN
-- 2. Propagates existing fund_holdings to all duplicate/sibling asset rows sharing the same ISIN
-- 3. Seeds high-conviction holdings & sector allocations for Axis Midcap, HDFC Large & Midcap, and PPFAS ELSS
-- ============================================================================

-- 1. Helper view: vw_fund_holdings
CREATE OR REPLACE VIEW public.vw_fund_holdings WITH (security_invoker = false) AS
SELECT 
    fh.fund_asset_id,
    a.isin,
    a.name AS fund_name,
    a.symbol AS fund_symbol,
    fh.holding_type,
    fh.holding_name,
    fh.weight_percentage
FROM public.fund_holdings fh
JOIN public.assets a ON a.asset_id = fh.fund_asset_id;

GRANT SELECT ON public.vw_fund_holdings TO authenticated, anon, service_role;

-- 2. Propagate existing holdings to any sibling asset sharing the same ISIN
-- (e.g. Parag Parikh Flexi Cap, Quant Small Cap, JioBlackRock Flexi Cap)
INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage)
SELECT 
    target_asset.asset_id AS fund_asset_id,
    source_fh.holding_type,
    source_fh.holding_name,
    source_fh.weight_percentage
FROM public.assets target_asset
JOIN public.assets source_asset ON source_asset.isin = target_asset.isin AND source_asset.asset_id <> target_asset.asset_id
JOIN public.fund_holdings source_fh ON source_fh.fund_asset_id = source_asset.asset_id
WHERE target_asset.isin IS NOT NULL
ON CONFLICT (fund_asset_id, holding_type, holding_name) 
DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;

-- 3. Seed holdings for Axis Midcap Fund (ISIN: INF846K01EH3) across all matching assets
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF846K01EH3' OR name ILIKE '%Axis Midcap%'
    LOOP
        -- Stocks
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'STOCK', 'Cholamandalam Investment and Finance Co Ltd', 4.82),
        (rec.asset_id, 'STOCK', 'Persistent Systems Ltd', 4.18),
        (rec.asset_id, 'STOCK', 'Trent Ltd', 3.85),
        (rec.asset_id, 'STOCK', 'Astral Ltd', 3.52),
        (rec.asset_id, 'STOCK', 'The Federal Bank Ltd', 3.31),
        (rec.asset_id, 'STOCK', 'Supreme Industries Ltd', 3.14),
        (rec.asset_id, 'STOCK', 'Cummins India Ltd', 3.02),
        (rec.asset_id, 'STOCK', 'Coforge Ltd', 2.89),
        (rec.asset_id, 'STOCK', 'PI Industries Ltd', 2.74),
        (rec.asset_id, 'STOCK', 'Crompton Greaves Consumer Electricals Ltd', 2.58),
        (rec.asset_id, 'STOCK', 'Sundram Fasteners Ltd', 2.41),
        (rec.asset_id, 'STOCK', 'Abbott India Ltd', 2.28),
        (rec.asset_id, 'STOCK', 'ICICI Bank Ltd', 2.15),
        (rec.asset_id, 'STOCK', 'Bharat Electronics Ltd', 2.06),
        (rec.asset_id, 'STOCK', 'Tata Elxsi Ltd', 1.95),
        (rec.asset_id, 'STOCK', 'Balkrishna Industries Ltd', 1.82),
        (rec.asset_id, 'STOCK', 'The Phoenix Mills Ltd', 1.75),
        (rec.asset_id, 'STOCK', 'Info Edge (India) Ltd', 1.68),
        (rec.asset_id, 'STOCK', 'Voltas Ltd', 1.55),
        (rec.asset_id, 'STOCK', 'The Indian Hotels Co Ltd', 1.48)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;

        -- Sectors
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Financial Services', 21.45),
        (rec.asset_id, 'SECTOR', 'Industrials', 18.20),
        (rec.asset_id, 'SECTOR', 'Technology', 15.35),
        (rec.asset_id, 'SECTOR', 'Consumer Cyclical', 12.80),
        (rec.asset_id, 'SECTOR', 'Basic Materials', 9.60),
        (rec.asset_id, 'SECTOR', 'Healthcare', 7.50),
        (rec.asset_id, 'SECTOR', 'Consumer Defensive', 6.20),
        (rec.asset_id, 'SECTOR', 'Automobile and Auto Components', 5.80)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;
END $$;

-- 4. Seed holdings for HDFC Large and Mid Cap Fund (ISIN: INF179KA1RQ7)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF179KA1RQ7' OR name ILIKE '%HDFC Large and Mid Cap%'
    LOOP
        -- Stocks
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

        -- Sectors
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Financial Services', 28.50),
        (rec.asset_id, 'SECTOR', 'Technology', 14.20),
        (rec.asset_id, 'SECTOR', 'Energy', 11.35),
        (rec.asset_id, 'SECTOR', 'Industrials', 10.40),
        (rec.asset_id, 'SECTOR', 'Automobile and Auto Components', 8.60),
        (rec.asset_id, 'SECTOR', 'Healthcare', 7.20),
        (rec.asset_id, 'SECTOR', 'Consumer Defensive', 6.80),
        (rec.asset_id, 'SECTOR', 'Utilities', 5.10),
        (rec.asset_id, 'SECTOR', 'Communication Services', 4.50)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;
END $$;

-- 5. Seed holdings for Parag Parikh ELSS Tax Saver Fund (ISIN: INF879O01100)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT asset_id FROM public.assets WHERE isin = 'INF879O01100' OR name ILIKE '%Parag Parikh ELSS%'
    LOOP
        -- Stocks
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'STOCK', 'HDFC Bank Ltd', 7.85),
        (rec.asset_id, 'STOCK', 'Bajaj Holdings & Investment Ltd', 7.12),
        (rec.asset_id, 'STOCK', 'Power Grid Corporation of India Ltd', 6.25),
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

        -- Sectors
        INSERT INTO public.fund_holdings (fund_asset_id, holding_type, holding_name, weight_percentage) VALUES
        (rec.asset_id, 'SECTOR', 'Financial Services', 32.40),
        (rec.asset_id, 'SECTOR', 'Utilities', 14.50),
        (rec.asset_id, 'SECTOR', 'Technology', 13.80),
        (rec.asset_id, 'SECTOR', 'Consumer Defensive', 12.20),
        (rec.asset_id, 'SECTOR', 'Energy', 9.50),
        (rec.asset_id, 'SECTOR', 'Automobile and Auto Components', 6.80),
        (rec.asset_id, 'SECTOR', 'Healthcare', 5.40)
        ON CONFLICT (fund_asset_id, holding_type, holding_name) DO UPDATE SET weight_percentage = EXCLUDED.weight_percentage;
    END LOOP;
END $$;
