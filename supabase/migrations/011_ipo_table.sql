-- 011_ipo_table.sql

-- 1. Create mainboard_ipos table
CREATE TABLE IF NOT EXISTS mainboard_ipos (
    id BIGINT PRIMARY KEY,
    ipo_name TEXT NOT NULL,
    category TEXT DEFAULT 'IPO',
    status TEXT, -- 'Upcoming', 'Open', 'Closed', 'Listed'
    status_badge TEXT,
    gmp_amount NUMERIC DEFAULT 0,
    gmp_percent NUMERIC DEFAULT 0,
    gmp_trend TEXT,
    rating_flames INT DEFAULT 0,
    price_str TEXT,
    price_num NUMERIC DEFAULT 0,
    ipo_size TEXT,
    lot_size INT DEFAULT 1,
    pe_ratio TEXT,
    subscription TEXT,
    open_date TEXT,
    close_date TEXT,
    boa_date TEXT,
    listing_date TEXT,
    sort_open DATE,
    sort_close DATE,
    sort_boa DATE,
    sort_listing DATE,
    updated_on_text TEXT,
    anchor_available BOOLEAN DEFAULT false,
    investorgain_url TEXT,
    allotment_url TEXT,
    highlight_row TEXT,
    raw_json JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure column exists if table was already created
ALTER TABLE mainboard_ipos ADD COLUMN IF NOT EXISTS allotment_url TEXT;

-- Indexes for efficient query performance
CREATE INDEX IF NOT EXISTS idx_mainboard_ipos_status ON mainboard_ipos(status);
CREATE INDEX IF NOT EXISTS idx_mainboard_ipos_sort_open ON mainboard_ipos(sort_open DESC);
CREATE INDEX IF NOT EXISTS idx_mainboard_ipos_gmp_percent ON mainboard_ipos(gmp_percent DESC);

-- Enable RLS
ALTER TABLE mainboard_ipos ENABLE ROW LEVEL SECURITY;

-- Allow public read access to anon and authenticated roles
DROP POLICY IF EXISTS "Allow public read access on mainboard_ipos" ON mainboard_ipos;
CREATE POLICY "Allow public read access on mainboard_ipos" 
    ON mainboard_ipos FOR SELECT 
    USING (true);

-- Allow service_role full access for syncing
DROP POLICY IF EXISTS "Allow service_role full access on mainboard_ipos" ON mainboard_ipos;
CREATE POLICY "Allow service_role full access on mainboard_ipos" 
    ON mainboard_ipos FOR ALL 
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- 2. Schedule sync-ipos edge function to run hourly via pg_cron
SELECT cron.schedule(
  'invoke-sync-ipos',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url:='https://spksxeupdfmyniqfmhld.supabase.co/functions/v1/sync-ipos',
      headers:='{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y", "Content-Type": "application/json"}'::jsonb
    );
  $$
);
