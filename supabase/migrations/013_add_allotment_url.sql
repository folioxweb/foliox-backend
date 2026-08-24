-- 013_add_allotment_url.sql
-- Add allotment_url column to mainboard_ipos table

ALTER TABLE mainboard_ipos ADD COLUMN IF NOT EXISTS allotment_url TEXT;
