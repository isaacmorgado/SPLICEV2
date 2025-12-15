-- Splice Plugin - Development Seed Data
-- Run this AFTER schema.sql for local testing

-- Test user (password: "testpass123")
-- bcrypt hash generated with cost factor 10
INSERT INTO users (id, email, password_hash)
VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'test@example.com',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZRGdjGj/n3.MJxH8rUYS3qX3qK5Ky'
) ON CONFLICT (email) DO NOTHING;

-- Free tier subscription for test user
INSERT INTO subscriptions (user_id, tier, status, minutes_used, period_end)
VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'free',
  'active',
  0,
  NOW() + INTERVAL '30 days'
) ON CONFLICT (user_id) DO NOTHING;

-- Sample usage records
INSERT INTO usage_records (user_id, feature, minutes)
VALUES
  ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'voice_isolation', 2.5),
  ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'transcription', 1.0),
  ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'take_analysis', 0.5);

-- Pro tier test user (password: "testpass123")
INSERT INTO users (id, email, password_hash)
VALUES (
  'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  'pro@example.com',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZRGdjGj/n3.MJxH8rUYS3qX3qK5Ky'
) ON CONFLICT (email) DO NOTHING;

-- Pro subscription
INSERT INTO subscriptions (user_id, tier, status, minutes_used, period_end, stripe_customer_id, stripe_subscription_id)
VALUES (
  'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  'pro',
  'active',
  45,
  NOW() + INTERVAL '25 days',
  'cus_test_pro_123',
  'sub_test_pro_456'
) ON CONFLICT (user_id) DO NOTHING;
