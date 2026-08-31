-- 021_add_subscription_details.sql
-- Add subscription_details column to mainboard_ipos table to store granular subscription breakdown

ALTER TABLE mainboard_ipos ADD COLUMN IF NOT EXISTS subscription_details JSONB;
