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

-- Migration 006: Add encrypted API key storage for BYOK users
CREATE TABLE IF NOT EXISTS user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service VARCHAR(50) NOT NULL CHECK (service IN ('openai', 'elevenlabs', 'gemini', 'groq')),
  encrypted_key TEXT NOT NULL,
  key_name VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT unique_user_service_key UNIQUE (user_id, service)
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_id ON user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_api_keys_service ON user_api_keys(user_id, service);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_api_keys_updated_at ON user_api_keys;
CREATE TRIGGER update_user_api_keys_updated_at
  BEFORE UPDATE ON user_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Migration 007: Add password reset functionality
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expiry ON password_reset_tokens(expires_at);

CREATE OR REPLACE FUNCTION cleanup_expired_reset_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM password_reset_tokens
  WHERE expires_at < NOW() OR used = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Migration 008: Add webhook retry mechanism
CREATE TABLE IF NOT EXISTS failed_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMP WITH TIME ZONE,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  max_retries INTEGER DEFAULT 3,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failed_webhooks_next_retry ON failed_webhook_events(next_retry_at)
  WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_failed_webhooks_event_id ON failed_webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_failed_webhooks_resolved ON failed_webhook_events(resolved);

-- Audit log table for important events
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_date ON audit_logs(user_id, created_at DESC);

-- ===========================================
-- VERIFICATION QUERIES (optional)
-- ===========================================

-- Check subscriptions columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'subscriptions'
ORDER BY ordinal_position;

-- Check all tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('referral_codes', 'referral_redemptions', 'user_api_keys',
                   'password_reset_tokens', 'failed_webhook_events', 'audit_logs');
