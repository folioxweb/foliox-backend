-- 004_fix_news_guid.sql
-- Change guid column in news table to TEXT to accommodate long Google News RSS identifiers
ALTER TABLE news ALTER COLUMN guid TYPE TEXT;
