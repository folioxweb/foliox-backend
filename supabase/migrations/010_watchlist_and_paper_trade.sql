-- 010_watchlist_and_paper_trade.sql

-- 1. MASTER NSE STOCKS TABLE
CREATE TABLE IF NOT EXISTS nse_stocks (
    symbol VARCHAR(50) PRIMARY KEY,
    isin VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    series VARCHAR(10) DEFAULT 'EQ',
    sector VARCHAR(100),
    industry VARCHAR(100),
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nse_stocks_search ON nse_stocks (symbol, name, isin);

-- 2. WATCHLIST ITEMS TABLE
CREATE TABLE IF NOT EXISTS watchlist_items (
    watchlist_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(50) NOT NULL,
    isin VARCHAR(50),
    name VARCHAR(255) NOT NULL,
    sector VARCHAR(100),
    confidence VARCHAR(20) DEFAULT 'Medium',
    badge VARCHAR(20) DEFAULT 'Trade',
    added_price NUMERIC(15, 4) NOT NULL DEFAULT 0,
    target_price NUMERIC(15, 4),
    notes TEXT,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_watchlist_symbol UNIQUE (symbol)
);

-- 3. PAPER PORTFOLIO CONFIG TABLE
CREATE TABLE IF NOT EXISTS paper_portfolio_config (
    id INT PRIMARY KEY DEFAULT 1,
    initial_capital NUMERIC(15, 2) NOT NULL DEFAULT 5000000.00,
    current_cash NUMERIC(15, 2) NOT NULL DEFAULT 5000000.00,
    realized_pnl NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT single_paper_config CHECK (id = 1)
);

INSERT INTO paper_portfolio_config (id, initial_capital, current_cash, realized_pnl)
VALUES (1, 5000000.00, 5000000.00, 0.00)
ON CONFLICT (id) DO NOTHING;

-- 4. PAPER ASSETS TABLE
CREATE TABLE IF NOT EXISTS paper_assets (
    asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    sector VARCHAR(100),
    confidence VARCHAR(20) DEFAULT 'Medium',
    trade_type VARCHAR(20) DEFAULT 'Trade',
    current_price NUMERIC(15, 4) DEFAULT 0,
    prev_close NUMERIC(15, 4) DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    isin VARCHAR(50)
);

-- 5. PAPER TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS paper_transactions (
    tx_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES paper_assets(asset_id) ON DELETE CASCADE,
    tx_type VARCHAR(10) NOT NULL CHECK (tx_type IN ('BUY', 'SELL')),
    quantity NUMERIC(15, 6) NOT NULL,
    price NUMERIC(15, 4) NOT NULL,
    realized_gain NUMERIC(15, 4) DEFAULT 0,
    tx_date TIMESTAMPTZ DEFAULT NOW()
);

-- 6. VIEWS

-- View: vw_watchlist
CREATE OR REPLACE VIEW vw_watchlist AS
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
LEFT JOIN paper_assets pa ON w.symbol = pa.symbol;

-- View: vw_paper_holdings
CREATE OR REPLACE VIEW vw_paper_holdings AS
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
GROUP BY a.asset_id
HAVING SUM(t.quantity) > 0;

-- View: vw_paper_summary
CREATE OR REPLACE VIEW vw_paper_summary AS
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
CROSS JOIN holdings_agg h
WHERE cfg.id = 1;
