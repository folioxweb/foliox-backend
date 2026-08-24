-- ============================================================================
-- 013_enable_rls_and_multiuser.sql
-- Enables Strict Row Level Security (RLS) & Multi-User Scoping for Supabase
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SCHEMA MIGRATION: ADD user_id TO USER-SCOPED TABLES
-- ----------------------------------------------------------------------------

-- 1.1 TRANSACTIONS
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
CREATE INDEX IF NOT EXISTS idx_transactions_user_asset ON transactions(user_id, asset_id);

-- 1.2 MF SIP CONFIGS
ALTER TABLE mf_sip_configs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
CREATE INDEX IF NOT EXISTS idx_mf_sip_configs_user ON mf_sip_configs(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_mf_sip ON mf_sip_configs(user_id, asset_id) WHERE user_id IS NOT NULL;

-- 1.3 WATCHLIST ITEMS
ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
ALTER TABLE watchlist_items DROP CONSTRAINT IF EXISTS unique_watchlist_symbol;
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist_items(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_watchlist_symbol ON watchlist_items(user_id, symbol) WHERE user_id IS NOT NULL;

-- 1.4 PAPER PORTFOLIO CONFIG
ALTER TABLE paper_portfolio_config DROP CONSTRAINT IF EXISTS single_paper_config;
ALTER TABLE paper_portfolio_config ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_paper_config ON paper_portfolio_config(user_id) WHERE user_id IS NOT NULL;

-- 1.5 PAPER ASSETS
ALTER TABLE paper_assets ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
ALTER TABLE paper_assets DROP CONSTRAINT IF EXISTS paper_assets_symbol_key;
CREATE INDEX IF NOT EXISTS idx_paper_assets_user ON paper_assets(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_paper_asset_symbol ON paper_assets(user_id, symbol) WHERE user_id IS NOT NULL;

-- 1.6 PAPER TRANSACTIONS
ALTER TABLE paper_transactions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
CREATE INDEX IF NOT EXISTS idx_paper_transactions_user ON paper_transactions(user_id);

-- 1.7 SEQUENCE FOR PAPER CONFIG
CREATE SEQUENCE IF NOT EXISTS paper_portfolio_config_id_seq START WITH 100;
ALTER TABLE public.paper_portfolio_config ALTER COLUMN id SET DEFAULT nextval('paper_portfolio_config_id_seq');

-- ----------------------------------------------------------------------------
-- 2. BACKFILL EXISTING ROWS (Assigns existing data to the primary registered user)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    admin_id UUID;
BEGIN
    SELECT id INTO admin_id FROM auth.users ORDER BY created_at ASC LIMIT 1;
    IF admin_id IS NOT NULL THEN
        UPDATE transactions SET user_id = admin_id WHERE user_id IS NULL;
        UPDATE mf_sip_configs SET user_id = admin_id WHERE user_id IS NULL;
        UPDATE watchlist_items SET user_id = admin_id WHERE user_id IS NULL;
        UPDATE paper_portfolio_config SET user_id = admin_id WHERE user_id IS NULL;
        UPDATE paper_assets SET user_id = admin_id WHERE user_id IS NULL;
        UPDATE paper_transactions SET user_id = admin_id WHERE user_id IS NULL;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. AUTOMATIC USER PROVISIONING TRIGGER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- If there is an unassigned paper config, tag it
    IF EXISTS (SELECT 1 FROM public.paper_portfolio_config WHERE user_id IS NULL) THEN
        UPDATE public.paper_portfolio_config SET user_id = NEW.id WHERE user_id IS NULL;
    -- Otherwise insert new paper portfolio config
    ELSIF NOT EXISTS (SELECT 1 FROM public.paper_portfolio_config WHERE user_id = NEW.id) THEN
        INSERT INTO public.paper_portfolio_config (user_id, initial_capital, current_cash, realized_pnl)
        VALUES (NEW.id, 5000000.00, 5000000.00, 0.00);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 4. ENABLE ROW LEVEL SECURITY (RLS) ON ALL 12 TABLES
-- ----------------------------------------------------------------------------
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mf_sip_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fund_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE news ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE nse_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_portfolio_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mainboard_ipos ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 5. STRICT RLS POLICIES FOR USER-SCOPED TABLES (Completely User Specific)
-- ----------------------------------------------------------------------------

-- 5.1 TRANSACTIONS POLICIES
DROP POLICY IF EXISTS "Users can view own transactions" ON transactions;
CREATE POLICY "Users can view own transactions" ON transactions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own transactions" ON transactions;
CREATE POLICY "Users can insert own transactions" ON transactions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own transactions" ON transactions;
CREATE POLICY "Users can update own transactions" ON transactions
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own transactions" ON transactions;
CREATE POLICY "Users can delete own transactions" ON transactions
    FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access on transactions" ON transactions;
CREATE POLICY "Service role full access on transactions" ON transactions
    FOR ALL USING (auth.role() = 'service_role');

-- 5.2 MF SIP CONFIGS POLICIES
DROP POLICY IF EXISTS "Users can view own mf_sip_configs" ON mf_sip_configs;
CREATE POLICY "Users can view own mf_sip_configs" ON mf_sip_configs
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own mf_sip_configs" ON mf_sip_configs;
CREATE POLICY "Users can insert own mf_sip_configs" ON mf_sip_configs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own mf_sip_configs" ON mf_sip_configs;
CREATE POLICY "Users can update own mf_sip_configs" ON mf_sip_configs
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own mf_sip_configs" ON mf_sip_configs;
CREATE POLICY "Users can delete own mf_sip_configs" ON mf_sip_configs
    FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access on mf_sip_configs" ON mf_sip_configs;
CREATE POLICY "Service role full access on mf_sip_configs" ON mf_sip_configs
    FOR ALL USING (auth.role() = 'service_role');

-- 5.3 WATCHLIST ITEMS POLICIES
DROP POLICY IF EXISTS "Users can view own watchlist_items" ON watchlist_items;
CREATE POLICY "Users can view own watchlist_items" ON watchlist_items
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own watchlist_items" ON watchlist_items;
CREATE POLICY "Users can insert own watchlist_items" ON watchlist_items
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own watchlist_items" ON watchlist_items;
CREATE POLICY "Users can update own watchlist_items" ON watchlist_items
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own watchlist_items" ON watchlist_items;
CREATE POLICY "Users can delete own watchlist_items" ON watchlist_items
    FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access on watchlist_items" ON watchlist_items;
CREATE POLICY "Service role full access on watchlist_items" ON watchlist_items
    FOR ALL USING (auth.role() = 'service_role');

-- 5.4 PAPER PORTFOLIO CONFIG POLICIES
DROP POLICY IF EXISTS "Users can view own paper_portfolio_config" ON paper_portfolio_config;
CREATE POLICY "Users can view own paper_portfolio_config" ON paper_portfolio_config
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own paper_portfolio_config" ON paper_portfolio_config;
CREATE POLICY "Users can insert own paper_portfolio_config" ON paper_portfolio_config
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own paper_portfolio_config" ON paper_portfolio_config;
CREATE POLICY "Users can update own paper_portfolio_config" ON paper_portfolio_config
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own paper_portfolio_config" ON paper_portfolio_config;
CREATE POLICY "Users can delete own paper_portfolio_config" ON paper_portfolio_config
    FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access on paper_portfolio_config" ON paper_portfolio_config;
CREATE POLICY "Service role full access on paper_portfolio_config" ON paper_portfolio_config
    FOR ALL USING (auth.role() = 'service_role');

-- 5.5 PAPER ASSETS POLICIES
DROP POLICY IF EXISTS "Users can view own paper_assets" ON paper_assets;
CREATE POLICY "Users can view own paper_assets" ON paper_assets
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own paper_assets" ON paper_assets;
CREATE POLICY "Users can insert own paper_assets" ON paper_assets
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own paper_assets" ON paper_assets;
CREATE POLICY "Users can update own paper_assets" ON paper_assets
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own paper_assets" ON paper_assets;
CREATE POLICY "Users can delete own paper_assets" ON paper_assets
    FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access on paper_assets" ON paper_assets;
CREATE POLICY "Service role full access on paper_assets" ON paper_assets
    FOR ALL USING (auth.role() = 'service_role');

-- 5.6 PAPER TRANSACTIONS POLICIES
DROP POLICY IF EXISTS "Users can view own paper_transactions" ON paper_transactions;
CREATE POLICY "Users can view own paper_transactions" ON paper_transactions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own paper_transactions" ON paper_transactions;
CREATE POLICY "Users can insert own paper_transactions" ON paper_transactions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own paper_transactions" ON paper_transactions;
CREATE POLICY "Users can update own paper_transactions" ON paper_transactions
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own paper_transactions" ON paper_transactions;
CREATE POLICY "Users can delete own paper_transactions" ON paper_transactions
    FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access on paper_transactions" ON paper_transactions;
CREATE POLICY "Service role full access on paper_transactions" ON paper_transactions
    FOR ALL USING (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- 6. RLS POLICIES FOR SHARED MARKET DATA TABLES
-- ----------------------------------------------------------------------------

-- 6.1 ASSETS
DROP POLICY IF EXISTS "Public read on assets" ON assets;
CREATE POLICY "Public read on assets" ON assets
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert new assets" ON assets;
CREATE POLICY "Authenticated users can insert new assets" ON assets
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Service role full access on assets" ON assets;
CREATE POLICY "Service role full access on assets" ON assets
    FOR ALL USING (auth.role() = 'service_role');

-- 6.2 NSE STOCKS
DROP POLICY IF EXISTS "Public read on nse_stocks" ON nse_stocks;
CREATE POLICY "Public read on nse_stocks" ON nse_stocks
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role full access on nse_stocks" ON nse_stocks;
CREATE POLICY "Service role full access on nse_stocks" ON nse_stocks
    FOR ALL USING (auth.role() = 'service_role');

-- 6.3 FUND HOLDINGS
DROP POLICY IF EXISTS "Public read on fund_holdings" ON fund_holdings;
CREATE POLICY "Public read on fund_holdings" ON fund_holdings
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role full access on fund_holdings" ON fund_holdings;
CREATE POLICY "Service role full access on fund_holdings" ON fund_holdings
    FOR ALL USING (auth.role() = 'service_role');

-- 6.4 NEWS
DROP POLICY IF EXISTS "Public read on news" ON news;
CREATE POLICY "Public read on news" ON news
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role full access on news" ON news;
CREATE POLICY "Service role full access on news" ON news
    FOR ALL USING (auth.role() = 'service_role');

-- 6.5 COMPANY DOCUMENTS
DROP POLICY IF EXISTS "Public read on company_documents" ON company_documents;
CREATE POLICY "Public read on company_documents" ON company_documents
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role full access on company_documents" ON company_documents;
CREATE POLICY "Service role full access on company_documents" ON company_documents
    FOR ALL USING (auth.role() = 'service_role');

-- 6.6 MAINBOARD IPOS
DROP POLICY IF EXISTS "Public read on mainboard_ipos" ON mainboard_ipos;
CREATE POLICY "Public read on mainboard_ipos" ON mainboard_ipos
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role full access on mainboard_ipos" ON mainboard_ipos;
CREATE POLICY "Service role full access on mainboard_ipos" ON mainboard_ipos
    FOR ALL USING (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- 7. RECREATE VIEWS WITH security_invoker = true
-- ----------------------------------------------------------------------------

-- 7.1 vw_holdings
CREATE OR REPLACE VIEW vw_holdings WITH (security_invoker = true) AS
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
LEFT JOIN mf_sip_configs sip ON (a.asset_id = sip.asset_id AND t.user_id = sip.user_id)
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
    MAX(t.fd_maturity_date) AS maturity_date
FROM assets a
JOIN transactions t ON a.asset_id = t.asset_id
WHERE a.asset_type = 'FD'
GROUP BY a.asset_id, a.symbol, a.name, a.asset_type
HAVING SUM(t.fd_principal) > 0;

-- 7.2 vw_portfolio_summary
CREATE OR REPLACE VIEW vw_portfolio_summary WITH (security_invoker = true) AS
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

-- 7.3 vw_indirect_exposure
CREATE OR REPLACE VIEW vw_indirect_exposure WITH (security_invoker = true) AS
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

-- 7.4 vw_global_sector_allocation
CREATE OR REPLACE VIEW vw_global_sector_allocation WITH (security_invoker = true) AS
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

-- 7.5 vw_global_stock_allocation
CREATE OR REPLACE VIEW vw_global_stock_allocation WITH (security_invoker = true) AS
WITH direct_stocks AS (
    SELECT
        h.name AS stock_name,
        SUM(h.current_value) AS stock_value
    FROM vw_holdings h
    WHERE h.asset_type = 'STOCK'
    GROUP BY h.name
),
indirect_stocks AS (
    SELECT
        fh.holding_name AS stock_name,
        SUM(h.current_value * (fh.weight_percentage / 100.0)) AS stock_value
    FROM fund_holdings fh
    JOIN vw_holdings h ON fh.fund_asset_id = h.asset_id
    WHERE fh.holding_type = 'STOCK'
    GROUP BY fh.holding_name
),
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

-- 7.6 vw_dashboard
CREATE OR REPLACE VIEW vw_dashboard WITH (security_invoker = true) AS
SELECT jsonb_build_object(
    'overallInvestments', (SELECT COALESCE(jsonb_agg(row_to_json(p)), '[]'::jsonb) FROM vw_portfolio_summary p),
    'sectorAllocation', (SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) FROM vw_global_sector_allocation s),
    'topHoldings', (SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::jsonb) FROM (SELECT * FROM vw_holdings WHERE asset_type = 'STOCK' ORDER BY current_value DESC LIMIT 7) sub)
) as dashboard_payload;

-- 7.7 vw_watchlist
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
    COALESCE(pa.current_price, a.current_price, w.added_price) AS current_price,
    COALESCE(pa.prev_close, a.prev_close, w.added_price) AS prev_close,
    CASE 
        WHEN w.added_price > 0 THEN ((COALESCE(pa.current_price, a.current_price, w.added_price) - w.added_price) / w.added_price) * 100 
        ELSE 0 
    END AS return_since_added_pct,
    (COALESCE(pa.current_price, a.current_price, w.added_price) - w.added_price) AS return_since_added_abs,
    CASE 
        WHEN COALESCE(pa.prev_close, a.prev_close, 0) > 0 THEN ((COALESCE(pa.current_price, a.current_price, 0) - COALESCE(pa.prev_close, a.prev_close, 0)) / COALESCE(pa.prev_close, a.prev_close, 1)) * 100 
        ELSE 0 
    END AS day_change_pct,
    (COALESCE(pa.current_price, a.current_price, 0) - COALESCE(pa.prev_close, a.prev_close, 0)) AS day_change_abs,
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

-- 7.8 vw_paper_holdings
CREATE OR REPLACE VIEW vw_paper_holdings WITH (security_invoker = true) AS
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
    SUM(t.quantity * t.price) / NULLIF(SUM(t.quantity), 0) AS avg_price,
    SUM(t.quantity * t.price) AS invested_value,
    SUM(t.quantity) * a.current_price AS current_value,
    (SUM(t.quantity) * a.current_price) - SUM(t.quantity * t.price) AS return_abs,
    CASE WHEN SUM(t.quantity * t.price) > 0 THEN ((SUM(t.quantity) * a.current_price) - SUM(t.quantity * t.price)) / SUM(t.quantity * t.price) * 100 ELSE 0 END AS return_pct,
    SUM(t.quantity) * (a.current_price - a.prev_close) AS day_change_abs,
    CASE WHEN a.prev_close > 0 THEN (a.current_price - a.prev_close) / a.prev_close * 100 ELSE 0 END AS day_change_pct
FROM paper_assets a
JOIN paper_transactions t ON a.asset_id = t.asset_id
GROUP BY a.asset_id, a.symbol, a.name, a.sector, a.confidence, a.trade_type, a.current_price, a.prev_close
HAVING SUM(t.quantity) > 0;

-- 7.9 vw_paper_summary
CREATE OR REPLACE VIEW vw_paper_summary WITH (security_invoker = true) AS
WITH holdings_agg AS (
    SELECT 
        COALESCE(SUM(invested_value), 0) AS total_invested,
        COALESCE(SUM(current_value), 0) AS total_current,
        COALESCE(SUM(return_abs), 0) AS unrealized_pnl,
        COALESCE(SUM(day_change_abs), 0) AS total_day_change
    FROM vw_paper_holdings
)
SELECT 
    cfg.initial_capital,
    cfg.current_cash,
    cfg.realized_pnl,
    h.total_invested,
    h.total_current,
    h.unrealized_pnl,
    h.total_day_change,
    (h.total_current + cfg.current_cash) AS portfolio_value,
    (h.unrealized_pnl + cfg.realized_pnl) AS total_pnl,
    CASE WHEN cfg.initial_capital > 0 THEN ((h.unrealized_pnl + cfg.realized_pnl) / cfg.initial_capital) * 100 ELSE 0 END AS total_pnl_pct
FROM paper_portfolio_config cfg
CROSS JOIN holdings_agg h;

-- 7.10 vw_user_news (Strictly filters news to only the authenticated user's active holdings)
CREATE OR REPLACE VIEW vw_user_news WITH (security_invoker = true) AS
SELECT DISTINCT
    n.guid,
    n.asset_id,
    n.title,
    n.source,
    n.category,
    n.published_at,
    n.url,
    n.is_read,
    n.retrieved_at,
    n.content,
    a.symbol,
    a.name AS company_name
FROM news n
JOIN vw_holdings h ON n.asset_id = h.asset_id
JOIN assets a ON n.asset_id = a.asset_id;
