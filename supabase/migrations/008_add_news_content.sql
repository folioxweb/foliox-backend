-- 007_add_news_content.sql
ALTER TABLE news ADD COLUMN IF NOT EXISTS content TEXT;
