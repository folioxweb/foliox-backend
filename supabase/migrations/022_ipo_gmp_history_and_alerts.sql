-- 022_ipo_gmp_history_and_alerts.sql
-- Create tables for IPO historical GMP tracking, transition alert state, and dispatch audit logs.

-- 1. Historical GMP Snapshots
CREATE TABLE IF NOT EXISTS ipo_gmp_history (
    id BIGSERIAL PRIMARY KEY,
    ipo_id BIGINT NOT NULL,
    ipo_name TEXT NOT NULL,
    category TEXT DEFAULT 'IPO', -- 'IPO' or 'SME'
    price_num NUMERIC DEFAULT 0,
    gmp_amount NUMERIC DEFAULT 0,
    gmp_percent NUMERIC DEFAULT 0,
    gmp_trend TEXT,
    status TEXT,
    subscription TEXT,
    recorded_date DATE DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ipo_gmp_history_lookup ON ipo_gmp_history(ipo_id, recorded_at ASC);
CREATE INDEX IF NOT EXISTS idx_ipo_gmp_history_date ON ipo_gmp_history(recorded_date);
CREATE INDEX IF NOT EXISTS idx_ipo_gmp_history_category ON ipo_gmp_history(category);

-- 2. State Band Tracker for 20% Transitions
CREATE TABLE IF NOT EXISTS ipo_alert_state (
    ipo_id BIGINT PRIMARY KEY,
    ipo_name TEXT NOT NULL,
    category TEXT DEFAULT 'IPO',
    last_gmp_percent NUMERIC DEFAULT 0,
    current_band TEXT CHECK (current_band IN ('ABOVE_20', 'BELOW_20')),
    last_alert_type TEXT,
    last_alerted_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Audit Log of Dispatched Email Alerts
CREATE TABLE IF NOT EXISTS ipo_email_alerts (
    id BIGSERIAL PRIMARY KEY,
    ipo_id BIGINT NOT NULL,
    ipo_name TEXT NOT NULL,
    category TEXT DEFAULT 'IPO',
    alert_type TEXT NOT NULL, -- 'OPENING_DAY_HIGH_GMP', 'GMP_DROPPED_BELOW_20', 'GMP_RISEN_ABOVE_20'
    gmp_percent NUMERIC NOT NULL,
    previous_gmp_percent NUMERIC,
    recipients TEXT[] NOT NULL,
    recipient_count INT DEFAULT 1,
    subject TEXT NOT NULL,
    sent_status TEXT DEFAULT 'SENT', -- 'SENT', 'FAILED'
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ipo_email_alerts_ipo ON ipo_email_alerts(ipo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ipo_email_alerts_type ON ipo_email_alerts(alert_type, created_at DESC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE ipo_gmp_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipo_alert_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipo_email_alerts ENABLE ROW LEVEL SECURITY;

-- Allow public read access to ipo_gmp_history so authenticated and anon users can view the historical chart
DROP POLICY IF EXISTS "Allow public read on ipo_gmp_history" ON ipo_gmp_history;
CREATE POLICY "Allow public read on ipo_gmp_history" 
    ON ipo_gmp_history FOR SELECT 
    USING (true);

-- Allow service_role full access for syncing, history logging and alert handling
DROP POLICY IF EXISTS "Allow service_role full access on ipo_gmp_history" ON ipo_gmp_history;
CREATE POLICY "Allow service_role full access on ipo_gmp_history" 
    ON ipo_gmp_history FOR ALL 
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Allow service_role full access on ipo_alert_state" ON ipo_alert_state;
CREATE POLICY "Allow service_role full access on ipo_alert_state" 
    ON ipo_alert_state FOR ALL 
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Allow service_role full access on ipo_email_alerts" ON ipo_email_alerts;
CREATE POLICY "Allow service_role full access on ipo_email_alerts" 
    ON ipo_email_alerts FOR ALL 
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
