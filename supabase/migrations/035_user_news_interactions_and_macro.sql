-- 035_user_news_interactions_and_macro.sql
-- 1. Upgrade news table with symbols array, publisher metadata, and ensure asset_id is nullable
ALTER TABLE news ADD COLUMN IF NOT EXISTS symbols TEXT[] DEFAULT '{}';
ALTER TABLE news ADD COLUMN IF NOT EXISTS publisher_domain TEXT;
ALTER TABLE news ADD COLUMN IF NOT EXISTS publisher_name TEXT;

-- Create GIN index on symbols array for ultra-fast symbol containment queries
CREATE INDEX IF NOT EXISTS idx_news_symbols ON news USING GIN (symbols);
CREATE INDEX IF NOT EXISTS idx_news_published_at ON news (published_at DESC);

-- Backfill symbols from assets for existing news records
UPDATE news n
SET symbols = ARRAY[a.symbol]
FROM assets a
WHERE n.asset_id = a.asset_id
  AND (n.symbols IS NULL OR cardinality(n.symbols) = 0);

-- 2. Create user_news_interactions table for per-user read and bookmark tracking
CREATE TABLE IF NOT EXISTS user_news_interactions (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    guid TEXT NOT NULL REFERENCES news(guid) ON DELETE CASCADE,
    is_read BOOLEAN NOT NULL DEFAULT false,
    is_bookmarked BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    bookmarked_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_user_news_interactions_user ON user_news_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_news_interactions_guid ON user_news_interactions(guid);

-- Enable RLS on user_news_interactions
ALTER TABLE user_news_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own news interactions" ON user_news_interactions;
CREATE POLICY "Users can view own news interactions" ON user_news_interactions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own news interactions" ON user_news_interactions;
CREATE POLICY "Users can insert own news interactions" ON user_news_interactions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own news interactions" ON user_news_interactions;
CREATE POLICY "Users can update own news interactions" ON user_news_interactions
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own news interactions" ON user_news_interactions;
CREATE POLICY "Users can delete own news interactions" ON user_news_interactions
    FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access on user_news_interactions" ON user_news_interactions;
CREATE POLICY "Service role full access on user_news_interactions" ON user_news_interactions
    FOR ALL USING (auth.role() = 'service_role');

-- 3. Recreate vw_user_news view with security_invoker = true
-- Links user holdings + macro news (asset_id IS NULL) + user-specific read/bookmark states
DROP VIEW IF EXISTS vw_user_news;

CREATE OR REPLACE VIEW vw_user_news WITH (security_invoker = true) AS
SELECT DISTINCT
    n.guid,
    n.asset_id,
    n.title,
    n.source,
    n.category,
    n.published_at,
    n.url,
    COALESCE(uni.is_read, false) AS is_read,
    COALESCE(uni.is_bookmarked, false) AS is_bookmarked,
    n.retrieved_at,
    n.content,
    n.symbols,
    n.publisher_domain,
    COALESCE(n.publisher_name, n.source) AS publisher_name,
    COALESCE(a.symbol, CASE WHEN cardinality(n.symbols) > 0 THEN n.symbols[1] ELSE 'MARKET' END) AS symbol,
    COALESCE(a.name, CASE WHEN n.asset_id IS NULL THEN 'Market Overview' ELSE a.symbol END) AS company_name
FROM news n
LEFT JOIN assets a ON n.asset_id = a.asset_id
LEFT JOIN user_news_interactions uni ON (n.guid = uni.guid AND uni.user_id = auth.uid())
WHERE (
    -- Direct asset_id match to user's current holdings
    n.asset_id IN (SELECT asset_id FROM vw_holdings)
    -- Or any matching symbol in multi-symbol array against user's holdings
    OR (
        cardinality(n.symbols) > 0 
        AND n.symbols && ARRAY(SELECT symbol FROM vw_holdings)
    )
    -- Or Macro / General market news
    OR n.asset_id IS NULL
);
