import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export { sql };

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
