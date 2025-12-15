import { getSubscriptionByUserId, updateMinutesUsed, createUsageRecord } from './db';
import { TIERS } from './stripe';

export type Feature = 'voice_isolation' | 'transcription' | 'take_analysis';

export interface UsageCheckResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  used: number;
  tier: string;
}

export async function checkUsage(userId: string): Promise<UsageCheckResult> {
  const subscription = await getSubscriptionByUserId(userId);

  if (!subscription) {
    return {
      allowed: false,
      remaining: 0,
      limit: 0,
      used: 0,
      tier: 'none',
    };
  }

  const tier = TIERS[subscription.tier] || TIERS.free;
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

export async function trackUsage(
  userId: string,
  feature: Feature,
  minutes: number
): Promise<UsageCheckResult> {
  // Record the usage
  await createUsageRecord(userId, feature, minutes);

  // Update the subscription minutes
  await updateMinutesUsed(userId, minutes);

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
