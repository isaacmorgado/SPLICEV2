-- Splice Plugin Database Schema
-- Neon Postgres (Serverless)
-- Run this in your Neon console or via psql

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for email lookups (login/register)
CREATE INDEX idx_users_email ON users(email);

-- ============================================
-- SUBSCRIPTIONS TABLE
-- ============================================
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  tier VARCHAR(20) DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'studio')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'paused')),
  minutes_used INTEGER DEFAULT 0,
  period_end TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure one subscription per user
  CONSTRAINT unique_user_subscription UNIQUE (user_id)
);

-- Index for user lookups
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);

-- Index for Stripe customer lookups (webhook processing)
CREATE INDEX idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);

-- Index for Stripe subscription lookups
CREATE INDEX idx_subscriptions_stripe_subscription ON subscriptions(stripe_subscription_id);

-- ============================================
-- USAGE RECORDS TABLE
-- ============================================
CREATE TABLE usage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature VARCHAR(50) NOT NULL CHECK (feature IN ('voice_isolation', 'transcription', 'take_analysis')),
  minutes DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for user usage history queries
CREATE INDEX idx_usage_records_user_id ON usage_records(user_id);

-- Index for usage reports by date
CREATE INDEX idx_usage_records_created_at ON usage_records(created_at);

-- Composite index for user + date range queries
CREATE INDEX idx_usage_records_user_date ON usage_records(user_id, created_at DESC);

-- ============================================
-- HELPER FUNCTIONS (Optional)
-- ============================================

-- Function to get total minutes used in current billing period
CREATE OR REPLACE FUNCTION get_current_period_usage(p_user_id UUID)
RETURNS DECIMAL AS $$
DECLARE
  v_period_start TIMESTAMP WITH TIME ZONE;
  v_total DECIMAL;
BEGIN
  -- Get the subscription period start (period_end - 1 month)
  SELECT COALESCE(period_end - INTERVAL '1 month', created_at)
  INTO v_period_start
  FROM subscriptions
  WHERE user_id = p_user_id;

  -- Sum usage records since period start
  SELECT COALESCE(SUM(minutes), 0)
  INTO v_total
  FROM usage_records
  WHERE user_id = p_user_id
    AND created_at >= v_period_start;

  RETURN v_total;
END;
$$ LANGUAGE plpgsql;
