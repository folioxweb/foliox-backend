-- 001_initial_schema.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ASSETS TABLE (Combines Stocks, ETFs, MFs, FDs metadata and live prices)
CREATE TABLE assets (
    asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    asset_type VARCHAR(20) NOT NULL CHECK(asset_type IN ('STOCK', 'ETF', 'MF', 'FD')),
    sector VARCHAR(100),
    category VARCHAR(100),
    confidence VARCHAR(20),
    trade_type VARCHAR(20),
    current_price NUMERIC(15, 4),
    prev_close NUMERIC(15, 4),
    last_updated TIMESTAMPTZ,
    api_code VARCHAR(50),
    isin VARCHAR(50)
);

-- 2. TRANSACTIONS TABLE (Append-only ledger replacing manual quantity/avg price cells)
CREATE TABLE transactions (
    tx_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    tx_type VARCHAR(10) NOT NULL CHECK(tx_type IN ('BUY', 'SELL')),
    quantity NUMERIC(15, 6) NOT NULL,
    price NUMERIC(15, 4) NOT NULL,
    tx_date TIMESTAMPTZ DEFAULT NOW(),
    -- For FDs, we might need maturity details if we treat them as assets
    fd_principal NUMERIC(15, 4),
    fd_rate NUMERIC(5, 2),
    fd_maturity_date DATE
);

-- 3. MF SIP CONFIGS TABLE
CREATE TABLE mf_sip_configs (
    asset_id UUID PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
    is_enabled BOOLEAN DEFAULT false,
    sip_day INT CHECK(sip_day BETWEEN 1 AND 28),
    sip_amount NUMERIC(15, 2),
    last_sip_date DATE
);

-- 4. FUND HOLDINGS (For FinAPI pass-through data: Underlying stocks/sectors for MFs/ETFs)
CREATE TABLE fund_holdings (
    fund_asset_id UUID NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    holding_type VARCHAR(20) NOT NULL CHECK(holding_type IN ('SECTOR', 'STOCK')),
    holding_name VARCHAR(100) NOT NULL,
    weight_percentage NUMERIC(5, 2) NOT NULL,
    PRIMARY KEY (fund_asset_id, holding_type, holding_name)
);

-- 5. NEWS
CREATE TABLE news (
    guid VARCHAR(255) PRIMARY KEY,
    asset_id UUID REFERENCES assets(asset_id) ON DELETE CASCADE, -- NULL means global news
    title TEXT NOT NULL,
    source VARCHAR(100),
    category VARCHAR(50),
    published_at TIMESTAMPTZ,
    url TEXT,
    is_read BOOLEAN DEFAULT false,
    retrieved_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. COMPANY DOCUMENTS
CREATE TABLE company_documents (
    attachment_id VARCHAR(255) PRIMARY KEY,
    asset_id UUID NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    title TEXT,
    doc_type VARCHAR(50),
    reporting_period VARCHAR(50),
    pdf_url TEXT,
    ai_summary JSONB,
    ai_status VARCHAR(20) DEFAULT 'PENDING',
    ai_model VARCHAR(50),
    generated_at TIMESTAMPTZ,
    announcement_date TIMESTAMPTZ
);
