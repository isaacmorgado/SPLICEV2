import { neon, NeonQueryFunction } from '@neondatabase/serverless';

// Initialize sql lazily to handle env vars not being available at import time
let _sqlInstance: NeonQueryFunction<false, false> | null = null;

function getDbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
}

// Create a lazy-initialized sql function that works as a tagged template
function createLazySql() {
  const sqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (!_sqlInstance) {
      _sqlInstance = neon(getDbUrl());
    }
    return _sqlInstance(strings, ...values);
  };
  return sqlFn as NeonQueryFunction<false, false>;
}

export const sql = createLazySql();

// Type for the SQL query function
type SqlQueryFunction = NeonQueryFunction<false, false>;

/**
 * Execute multiple SQL statements in a transaction
 * @param callback - Function that receives the sql tagged template and returns queries
 */
export async function transaction<T>(
  callback: (txSql: SqlQueryFunction) => Promise<T>
): Promise<T> {
  // Neon supports transactions via BEGIN/COMMIT
  // For simple cases, we can use a single connection
  const txSql = neon(getDbUrl());

  try {
    await txSql`BEGIN`;
    const result = await callback(txSql);
    await txSql`COMMIT`;
    return result;
  } catch (error) {
    await txSql`ROLLBACK`;
    throw error;
  }
}

// User queries
export async function getUserByEmail(email: string) {
  const rows = await sql`
    SELECT id, email, password_hash, created_at
    FROM users
    WHERE email = ${email}
  `;
  return rows[0] || null;
}

export async function getUserById(id: string) {
  const rows = await sql`
    SELECT id, email, created_at
    FROM users
    WHERE id = ${id}
  `;
  return rows[0] || null;
}

export async function createUser(email: string, passwordHash: string) {
  const rows = await sql`
    INSERT INTO users (email, password_hash)
    VALUES (${email}, ${passwordHash})
    RETURNING id, email, created_at
  `;
  return rows[0];
}

// Subscription queries
export async function getSubscriptionByUserId(userId: string) {
  const rows = await sql`
    SELECT id, user_id, stripe_customer_id, stripe_subscription_id,
           tier, status, minutes_used, period_end, created_at
    FROM subscriptions
    WHERE user_id = ${userId}
  `;
  return rows[0] || null;
}

export async function createSubscription(userId: string) {
  const rows = await sql`
    INSERT INTO subscriptions (user_id, tier, status, minutes_used)
    VALUES (${userId}, 'free', 'active', 0)
    RETURNING *
  `;
  return rows[0];
}

export async function updateSubscription(
  userId: string,
  data: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    tier?: string;
    status?: string;
    periodEnd?: Date;
  }
) {
  const rows = await sql`
    UPDATE subscriptions
    SET
      stripe_customer_id = COALESCE(${data.stripeCustomerId ?? null}, stripe_customer_id),
      stripe_subscription_id = COALESCE(${data.stripeSubscriptionId ?? null}, stripe_subscription_id),
      tier = COALESCE(${data.tier ?? null}, tier),
      status = COALESCE(${data.status ?? null}, status),
      period_end = COALESCE(${data.periodEnd ?? null}, period_end)
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return rows[0];
}

export async function updateMinutesUsed(userId: string, minutes: number) {
  const rows = await sql`
    UPDATE subscriptions
    SET minutes_used = minutes_used + ${minutes}
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return rows[0];
}

export async function resetMinutesUsed(userId: string) {
  const rows = await sql`
    UPDATE subscriptions
    SET minutes_used = 0
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return rows[0];
}

// Usage records
export async function createUsageRecord(userId: string, feature: string, minutes: number) {
  const rows = await sql`
    INSERT INTO usage_records (user_id, feature, minutes)
    VALUES (${userId}, ${feature}, ${minutes})
    RETURNING *
  `;
  return rows[0];
}

export async function getUsageRecords(userId: string, limit = 50) {
  const rows = await sql`
    SELECT id, feature, minutes, created_at
    FROM usage_records
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows;
}

// Trial system functions

/**
 * Create a trial subscription for a new user
 * Trial: 30 days with Pro-tier features (300 minutes)
 */
export async function createTrialSubscription(userId: string) {
  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + 30); // 30-day trial

  const rows = await sql`
    INSERT INTO subscriptions (user_id, tier, status, minutes_used, is_trial, trial_started_at, trial_ends_at)
    VALUES (${userId}, 'pro', 'active', 0, true, NOW(), ${trialEndDate})
    RETURNING *
  `;
  return rows[0];
}

/**
 * Check if user's trial is still active
 */
export async function checkTrialStatus(userId: string) {
  const rows = await sql`
    SELECT id, is_trial, trial_ends_at,
           CASE WHEN trial_ends_at > NOW() THEN true ELSE false END as trial_active
    FROM subscriptions
    WHERE user_id = ${userId}
  `;

  if (!rows[0]) {
    return { exists: false, isTrial: false, trialActive: false, trialEndsAt: null };
  }

  return {
    exists: true,
    isTrial: rows[0].is_trial,
    trialActive: rows[0].trial_active,
    trialEndsAt: rows[0].trial_ends_at,
  };
}

/**
 * Convert an expired trial to the free tier
 */
export async function convertTrialToFree(userId: string) {
  const rows = await sql`
    UPDATE subscriptions
    SET tier = 'free', is_trial = false, minutes_used = 0
    WHERE user_id = ${userId} AND is_trial = true
    RETURNING *
  `;
  return rows[0];
}

/**
 * Get all expired trials that need to be converted
 */
export async function getExpiredTrials() {
  const rows = await sql`
    SELECT user_id, trial_ends_at
    FROM subscriptions
    WHERE is_trial = true AND trial_ends_at < NOW()
  `;
  return rows;
}
