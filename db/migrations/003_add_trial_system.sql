-- Migration: Add trial system columns
-- Run this after your base schema is set up

-- Add trial tracking columns to subscriptions table
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS is_trial BOOLEAN DEFAULT false;

-- Add index for efficient trial expiration queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_expiry
ON subscriptions (trial_ends_at)
WHERE is_trial = true;

-- Update existing free tier users to NOT be on trial
-- (they were created before the trial system existed)
UPDATE subscriptions
SET is_trial = false
WHERE is_trial IS NULL AND tier = 'free';
