import { neon } from '@neondatabase/serverless';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_2y5bZTneKuPj@ep-curly-queen-afdqp63o-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require';

const sql = neon(DATABASE_URL);

async function runMigrations() {
  console.log('Starting database setup...\n');

  // Step 1: Create pgcrypto extension
  console.log('1. Creating pgcrypto extension...');
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`;
    console.log('   OK');
  } catch (e: any) {
    console.log('   SKIP:', e.message);
  }

  // Step 2: Create users table
  console.log('2. Creating users table...');
  try {
    await sql`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    console.log('   OK');
  } catch (e: any) {
    if (e.message?.includes('already exists')) {
      console.log('   SKIP: already exists');
    } else {
      console.log('   ERR:', e.message);
    }
  }

  // Step 3: Create users index
  console.log('3. Creating users email index...');
  try {
    await sql`CREATE INDEX idx_users_email ON users(email)`;
    console.log('   OK');
  } catch (e: any) {
    if (e.message?.includes('already exists')) {
      console.log('   SKIP: already exists');
    } else {
      console.log('   ERR:', e.message);
    }
  }

  // Step 4: Create subscriptions table
  console.log('4. Creating subscriptions table...');
  try {
    await sql`
      CREATE TABLE subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        tier VARCHAR(20) DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'pro_referral', 'studio')),
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'paused')),
        minutes_used INTEGER DEFAULT 0,
        period_end TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        is_trial BOOLEAN DEFAULT false,
        trial_started_at TIMESTAMP,
        trial_ends_at TIMESTAMP,
        referred_by_code VARCHAR(20),
        referral_months_remaining INT DEFAULT 0,
        bonus_months INT DEFAULT 0,
        CONSTRAINT unique_user_subscription UNIQUE (user_id)
      )
    `;
    console.log('   OK');
  } catch (e: any) {
    if (e.message?.includes('already exists')) {
      console.log('   SKIP: already exists');
    } else {
      console.log('   ERR:', e.message);
    }
  }

  // Step 5: Create subscriptions indexes
  console.log('5. Creating subscriptions indexes...');
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id)',
    'CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription ON subscriptions(stripe_subscription_id)',
    'CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_expiry ON subscriptions (trial_ends_at) WHERE is_trial = true',
  ];
  for (const idx of indexes) {
    try {
      await sql(idx);
      console.log('   OK');
    } catch {
      console.log('   SKIP');
    }
  }

  // Step 6: Create usage_records table
  console.log('6. Creating usage_records table...');
  try {
    await sql`
      CREATE TABLE usage_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        feature VARCHAR(50) NOT NULL CHECK (feature IN ('voice_isolation', 'transcription', 'take_analysis')),
        minutes DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    console.log('   OK');
  } catch (e: any) {
    if (e.message?.includes('already exists')) {
      console.log('   SKIP: already exists');
    } else {
      console.log('   ERR:', e.message);
    }
  }

  // Step 7: Usage records indexes
  console.log('7. Creating usage_records indexes...');
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_records_user_id ON usage_records(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_records_created_at ON usage_records(created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_records_user_date ON usage_records(user_id, created_at DESC)`;
    console.log('   OK');
  } catch {
    console.log('   SKIP');
  }

  // Step 8: Create rate_limits table
  console.log('8. Creating rate_limits table...');
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS rate_limits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rate_limits_key_created ON rate_limits(key, created_at)`;
    console.log('   OK');
  } catch (e: any) {
    console.log('   ERR:', e.message);
  }

  // Step 9: Create account_lockouts table
  console.log('9. Creating account_lockouts table...');
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS account_lockouts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        failed_attempts INTEGER DEFAULT 0,
        last_attempt TIMESTAMP WITH TIME ZONE,
        locked_until TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_account_lockouts_email ON account_lockouts(email)`;
    console.log('   OK');
  } catch (e: any) {
    console.log('   ERR:', e.message);
  }

  // Step 10: Create processed_webhook_events table
  console.log('10. Creating processed_webhook_events table...');
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS processed_webhook_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id VARCHAR(255) UNIQUE NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_processed_events_event_id ON processed_webhook_events(event_id)`;
    console.log('   OK');
  } catch (e: any) {
    console.log('   ERR:', e.message);
  }

  // Step 11: Create referral_codes table
  console.log('11. Creating referral_codes table...');
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS referral_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(20) UNIQUE NOT NULL,
        owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        uses_remaining INT DEFAULT 10,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_referral_codes_owner ON referral_codes(owner_user_id)`;
    console.log('   OK');
  } catch (e: any) {
    console.log('   ERR:', e.message);
  }

  // Step 12: Create referral_redemptions table
  console.log('12. Creating referral_redemptions table...');
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS referral_redemptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code_id UUID REFERENCES referral_codes(id) ON DELETE CASCADE,
        redeemed_by_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        rewarded_to_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_redemptions_unique ON referral_redemptions(code_id, redeemed_by_user_id)`;
    console.log('   OK');
  } catch (e: any) {
    console.log('   ERR:', e.message);
  }

  // Step 13: Verify
  console.log('\n--- VERIFICATION ---\n');

  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;

  console.log('Tables in database:');
  tables.forEach((t: any) => console.log(`  - ${t.table_name}`));

  const columns = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'subscriptions'
    ORDER BY ordinal_position
  `;

  console.log('\nSubscriptions columns:');
  columns.forEach((c: any) => console.log(`  - ${c.column_name} (${c.data_type})`));

  console.log('\nDone!');
}

runMigrations().catch(console.error);
