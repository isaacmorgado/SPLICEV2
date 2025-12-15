-- Migration: Add referral code system
-- Run this after the trial system migration

-- Referral codes table
CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) UNIQUE NOT NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  uses_remaining INT DEFAULT 10,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Track referral redemptions
CREATE TABLE IF NOT EXISTS referral_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id UUID REFERENCES referral_codes(id) ON DELETE CASCADE,
  redeemed_by_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  rewarded_to_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add referral tracking columns to subscriptions
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS referred_by_code VARCHAR(20),
ADD COLUMN IF NOT EXISTS referral_months_remaining INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS bonus_months INT DEFAULT 0;

-- Index for efficient referral code lookups
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_owner ON referral_codes(owner_user_id);

-- Prevent duplicate redemptions by same user
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_redemptions_unique
ON referral_redemptions(code_id, redeemed_by_user_id);
