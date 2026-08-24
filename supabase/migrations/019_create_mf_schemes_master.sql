-- 019_create_mf_schemes_master.sql
-- Master Table for Indian Mutual Fund Schemes (Filtered Growth & Open-Ended Schemes)

CREATE TABLE IF NOT EXISTS public.mf_schemes (
    scheme_code BIGINT PRIMARY KEY,
    isin VARCHAR(50),
    name VARCHAR(255) NOT NULL,
    amc_name VARCHAR(150),
    category VARCHAR(150),
    plan VARCHAR(50),
    nav NUMERIC(12, 4),
    nav_date VARCHAR(30),
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Search Index for ultra-fast autocomplete
CREATE INDEX IF NOT EXISTS idx_mf_schemes_search ON public.mf_schemes (scheme_code, name, isin);
CREATE INDEX IF NOT EXISTS idx_mf_schemes_amc ON public.mf_schemes (amc_name);

-- Row Level Security
ALTER TABLE public.mf_schemes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read on mf_schemes" ON public.mf_schemes;
CREATE POLICY "Public read on mf_schemes" ON public.mf_schemes
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role full access on mf_schemes" ON public.mf_schemes;
CREATE POLICY "Service role full access on mf_schemes" ON public.mf_schemes
    FOR ALL USING (auth.role() = 'service_role');
