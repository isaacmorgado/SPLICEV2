-- Migration: Add pro_referral to tier check constraint
-- Run this after 004_add_referral_system.sql

-- Drop the existing constraint and recreate with pro_referral
ALTER TABLE subscriptions
DROP CONSTRAINT IF EXISTS subscriptions_tier_check;

ALTER TABLE subscriptions
ADD CONSTRAINT subscriptions_tier_check
CHECK (tier IN ('free', 'pro', 'pro_referral', 'studio'));
