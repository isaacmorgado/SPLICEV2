/**
 * Database module using @neondatabase/serverless
 *
 * Uses a factory pattern to avoid module-level initialization issues with Vercel serverless.
 * All database access must go through getSql() which lazily initializes the connection.
 */

type SqlFunction = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

let _sql: SqlFunction | null = null;

/**
 * Get the SQL tagged template function. Lazily initializes the connection.
 * Must be called inside request handlers, not at module level.
 */
export async function getSql(): Promise<SqlFunction> {
  if (!_sql) {
    const { neon } = await import('@neondatabase/serverless');
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    _sql = neon(url) as unknown as SqlFunction;
  }
  return _sql;
}

/**
 * Execute multiple SQL statements in a transaction
 */
export async function transaction<T>(callback: (sql: SqlFunction) => Promise<T>): Promise<T> {
  const { neon } = await import('@neondatabase/serverless');
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  const txSql = neon(url) as unknown as SqlFunction;

  await txSql`BEGIN`;
  try {
    const result = await callback(txSql);
    await txSql`COMMIT`;
    return result;
  } catch (error) {
    await txSql`ROLLBACK`;
    throw error;
  }
}

// ============================================================================
// User queries
// ============================================================================

export async function getUserByEmail(email: string) {
  const sql = await getSql();
  const rows = await sql`
    SELECT id, email, password_hash, created_at
    FROM users
    WHERE email = ${email}
  `;
  return rows[0] || null;
}

export async function getUserById(id: string) {
  const sql = await getSql();
  const rows = await sql`
    SELECT id, email, created_at
    FROM users
    WHERE id = ${id}
  `;
  return rows[0] || null;
}

export async function createUser(email: string, passwordHash: string) {
  const sql = await getSql();
  const rows = await sql`
    INSERT INTO users (email, password_hash)
    VALUES (${email}, ${passwordHash})
    RETURNING id, email, created_at
  `;
  return rows[0];
}

// ============================================================================
// Subscription queries
// ============================================================================

export async function getSubscriptionByUserId(userId: string) {
  const sql = await getSql();
  const rows = await sql`
    SELECT id, user_id, stripe_customer_id, stripe_subscription_id,
           tier, status, minutes_used, period_end, created_at
    FROM subscriptions
    WHERE user_id = ${userId}
  `;
  return rows[0] || null;
}

export async function createSubscription(userId: string) {
  const sql = await getSql();
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
  const sql = await getSql();
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
  const sql = await getSql();
  const rows = await sql`
    UPDATE subscriptions
    SET minutes_used = minutes_used + ${minutes}
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return rows[0];
}

export async function resetMinutesUsed(userId: string) {
  const sql = await getSql();
  const rows = await sql`
    UPDATE subscriptions
    SET minutes_used = 0
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return rows[0];
}

// ============================================================================
// Usage records
// ============================================================================

export async function createUsageRecord(userId: string, feature: string, minutes: number) {
  const sql = await getSql();
  const rows = await sql`
    INSERT INTO usage_records (user_id, feature, minutes)
    VALUES (${userId}, ${feature}, ${minutes})
    RETURNING *
  `;
  return rows[0];
}

export async function getUsageRecords(userId: string, limit = 50) {
  const sql = await getSql();
  const rows = await sql`
    SELECT id, feature, minutes, created_at
    FROM usage_records
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows;
}

// ============================================================================
// Trial system
// ============================================================================

export async function createTrialSubscription(userId: string) {
  const sql = await getSql();
  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + 30);

  const rows = await sql`
    INSERT INTO subscriptions (user_id, tier, status, minutes_used, is_trial, trial_started_at, trial_ends_at)
    VALUES (${userId}, 'pro', 'active', 0, true, NOW(), ${trialEndDate})
    RETURNING *
  `;
  return rows[0];
}

export async function checkTrialStatus(userId: string) {
  const sql = await getSql();
  const rows = await sql`
    SELECT id, is_trial, trial_ends_at,
           CASE WHEN trial_ends_at > NOW() THEN true ELSE false END as trial_active
    FROM subscriptions
    WHERE user_id = ${userId}
  `;

  if (!rows[0]) {
    return { exists: false, isTrial: false, trialActive: false, trialEndsAt: null };
  }

  const row = rows[0] as { is_trial: boolean; trial_active: boolean; trial_ends_at: Date | null };
  return {
    exists: true,
    isTrial: row.is_trial,
    trialActive: row.trial_active,
    trialEndsAt: row.trial_ends_at,
  };
}

export async function convertTrialToFree(userId: string) {
  const sql = await getSql();
  const rows = await sql`
    UPDATE subscriptions
    SET tier = 'free', is_trial = false, minutes_used = 0
    WHERE user_id = ${userId} AND is_trial = true
    RETURNING *
  `;
  return rows[0];
}

export async function getExpiredTrials() {
  const sql = await getSql();
  const rows = await sql`
    SELECT user_id, trial_ends_at
    FROM subscriptions
    WHERE is_trial = true AND trial_ends_at < NOW()
  `;
  return rows;
}
