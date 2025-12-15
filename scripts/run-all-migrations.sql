-- ===========================================
-- SPLICE DATABASE MIGRATIONS
-- Copy this entire script into Neon SQL Editor
-- ===========================================

-- Migration 003: Add trial system columns
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS is_trial BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_expiry
ON subscriptions (trial_ends_at)
WHERE is_trial = true;

UPDATE subscriptions
SET is_trial = false
WHERE is_trial IS NULL AND tier = 'free';

-- Migration 004: Add referral code system
CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) UNIQUE NOT NULL,
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  uses_remaining INT DEFAULT 10,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id UUID REFERENCES referral_codes(id) ON DELETE CASCADE,
  redeemed_by_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  rewarded_to_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS referred_by_code VARCHAR(20),
ADD COLUMN IF NOT EXISTS referral_months_remaining INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS bonus_months INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_owner ON referral_codes(owner_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_redemptions_unique
ON referral_redemptions(code_id, redeemed_by_user_id);

-- Migration 005: Add pro_referral to tier constraint
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_tier_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_tier_check
CHECK (tier IN ('free', 'pro', 'pro_referral', 'studio'));

-- ===========================================
-- VERIFICATION QUERIES (optional)
-- ===========================================

-- Check subscriptions columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'subscriptions'
ORDER BY ordinal_position;

-- Check referral tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('referral_codes', 'referral_redemptions');
