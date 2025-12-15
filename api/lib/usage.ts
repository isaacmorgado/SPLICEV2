import { getSubscriptionByUserId, getSql, transaction } from '../db';
import { TIERS } from './stripe';

export type Feature = 'voice_isolation' | 'transcription' | 'take_analysis';

export interface UsageCheckResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  used: number;
  tier: string;
}

interface SubscriptionRow {
  tier: string;
  minutes_used: number;
}

export async function checkUsage(userId: string): Promise<UsageCheckResult> {
  const subscription = (await getSubscriptionByUserId(userId)) as SubscriptionRow | null;

  if (!subscription) {
    return {
      allowed: false,
      remaining: 0,
      limit: 0,
      used: 0,
      tier: 'none',
    };
  }

  const tier = TIERS[subscription.tier as keyof typeof TIERS] || TIERS.free;
  const used = subscription.minutes_used || 0;
  const remaining = Math.max(0, tier.monthlyMinutes - used);

  return {
    allowed: remaining > 0,
    remaining,
    limit: tier.monthlyMinutes,
    used,
    tier: subscription.tier,
  };
}

export async function hasEnoughMinutes(userId: string, requiredMinutes: number): Promise<boolean> {
  const usage = await checkUsage(userId);
  return usage.remaining >= requiredMinutes;
}

/**
 * Track usage atomically - creates usage record and updates subscription in a single transaction
 * This prevents data inconsistency if one operation fails
 */
export async function trackUsage(
  userId: string,
  feature: Feature,
  minutes: number
): Promise<UsageCheckResult> {
  // Execute both operations in a transaction
  await transaction(async (txSql) => {
    // Create usage record
    await txSql`INSERT INTO usage_records (user_id, feature, minutes) VALUES (${userId}, ${feature}, ${minutes})`;

    // Update subscription minutes in the same transaction
    await txSql`UPDATE subscriptions SET minutes_used = minutes_used + ${minutes} WHERE user_id = ${userId}`;
  });

  // Return updated usage stats
  return checkUsage(userId);
}

/**
 * Legacy non-transactional version - kept for reference
 * @deprecated Use trackUsage instead
 */
export async function trackUsageLegacy(
  userId: string,
  feature: Feature,
  minutes: number
): Promise<UsageCheckResult> {
  const sql = await getSql();

  // Record the usage
  await sql`
    INSERT INTO usage_records (user_id, feature, minutes)
    VALUES (${userId}, ${feature}, ${minutes})
  `;

  // Update the subscription minutes
  await sql`
    UPDATE subscriptions
    SET minutes_used = minutes_used + ${minutes}
    WHERE user_id = ${userId}
  `;

  // Return updated usage stats
  return checkUsage(userId);
}

export async function estimateMinutes(feature: Feature, durationSeconds: number): Promise<number> {
  // Convert seconds to minutes and add overhead based on feature
  const baseMinutes = durationSeconds / 60;

  switch (feature) {
    case 'voice_isolation':
      // Voice isolation takes roughly 1:1 processing time
      return Math.ceil(baseMinutes);
    case 'transcription':
      // Whisper is fast, roughly 0.5:1
      return Math.ceil(baseMinutes * 0.5);
    case 'take_analysis':
      // LLM analysis is quick, minimal usage
      return Math.ceil(baseMinutes * 0.1);
    default:
      return Math.ceil(baseMinutes);
  }
}

/**
 * Refund usage if an operation fails after tracking
 * Also transactional to ensure consistency
 */
export async function refundUsage(
  userId: string,
  feature: Feature,
  minutes: number
): Promise<UsageCheckResult> {
  const negativeMinutes = -minutes;
  await transaction(async (txSql) => {
    // Create negative usage record for audit trail
    await txSql`INSERT INTO usage_records (user_id, feature, minutes) VALUES (${userId}, ${feature}, ${negativeMinutes})`;

    // Decrement subscription minutes
    await txSql`UPDATE subscriptions SET minutes_used = GREATEST(0, minutes_used - ${minutes}) WHERE user_id = ${userId}`;
  });

  return checkUsage(userId);
}
