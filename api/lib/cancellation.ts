/**
 * Cancellation Eligibility System
 *
 * Users cannot cancel their subscription if they've used 25% or more
 * of their monthly minutes in the current billing period.
 *
 * This ensures fair usage - if you've consumed significant value,
 * you should pay for it.
 */

import { getSubscriptionByUserId } from './db';
import { TIERS } from './stripe';

// Minimum usage percentage that blocks cancellation
const CANCELLATION_THRESHOLD = 0.25; // 25%

export interface CancellationCheckResult {
  canCancel: boolean;
  usagePercent: number;
  threshold: number;
  minutesUsed: number;
  minutesLimit: number;
  tier: string;
  reason?: string;
  periodEnd?: Date;
}

/**
 * Check if a user is eligible to cancel their subscription
 *
 * Rules:
 * - Free tier users can always "cancel" (nothing to cancel)
 * - Paid users can cancel if usage is below 25% of their monthly limit
 * - Paid users are blocked if usage is 25% or higher
 */
export async function checkCancellationEligibility(
  userId: string
): Promise<CancellationCheckResult> {
  const subscription = await getSubscriptionByUserId(userId);

  // No subscription found
  if (!subscription) {
    return {
      canCancel: false,
      usagePercent: 0,
      threshold: CANCELLATION_THRESHOLD * 100,
      minutesUsed: 0,
      minutesLimit: 0,
      tier: 'none',
      reason: 'No subscription found',
    };
  }

  const tier = TIERS[subscription.tier];

  // Free tier - always allow (nothing to cancel)
  if (!tier || subscription.tier === 'free') {
    return {
      canCancel: true,
      usagePercent: 0,
      threshold: CANCELLATION_THRESHOLD * 100,
      minutesUsed: 0,
      minutesLimit: 0,
      tier: 'free',
    };
  }

  // No Stripe subscription - nothing to cancel
  if (!subscription.stripe_subscription_id) {
    return {
      canCancel: true,
      usagePercent: 0,
      threshold: CANCELLATION_THRESHOLD * 100,
      minutesUsed: subscription.minutes_used || 0,
      minutesLimit: tier.monthlyMinutes,
      tier: subscription.tier,
      reason: 'No active billing subscription',
    };
  }

  const minutesUsed = subscription.minutes_used || 0;
  const minutesLimit = tier.monthlyMinutes;
  const usagePercent = minutesLimit > 0 ? (minutesUsed / minutesLimit) * 100 : 0;

  // Check if usage exceeds threshold
  if (usagePercent >= CANCELLATION_THRESHOLD * 100) {
    return {
      canCancel: false,
      usagePercent: Math.round(usagePercent * 10) / 10,
      threshold: CANCELLATION_THRESHOLD * 100,
      minutesUsed,
      minutesLimit,
      tier: subscription.tier,
      periodEnd: subscription.period_end ? new Date(subscription.period_end) : undefined,
      reason: formatBlockedMessage(
        usagePercent,
        minutesUsed,
        minutesLimit,
        subscription.period_end
      ),
    };
  }

  // Usage is below threshold - allow cancellation
  return {
    canCancel: true,
    usagePercent: Math.round(usagePercent * 10) / 10,
    threshold: CANCELLATION_THRESHOLD * 100,
    minutesUsed,
    minutesLimit,
    tier: subscription.tier,
    periodEnd: subscription.period_end ? new Date(subscription.period_end) : undefined,
  };
}

/**
 * Format a user-friendly message explaining why cancellation is blocked
 */
function formatBlockedMessage(
  usagePercent: number,
  minutesUsed: number,
  minutesLimit: number,
  periodEnd?: Date | string | null
): string {
  const roundedPercent = Math.round(usagePercent);
  const usedStr = minutesUsed.toFixed(1);
  const limitStr = minutesLimit.toString();

  let message = `You've used ${roundedPercent}% of your monthly minutes (${usedStr}/${limitStr} min). `;
  message += `Cancellation is available when usage is below 25%. `;

  if (periodEnd) {
    const endDate = new Date(periodEnd);
    const formattedDate = endDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    message += `Your usage resets on ${formattedDate}. `;
  }

  message += `Need help? Contact support@splice.ai`;

  return message;
}

/**
 * Get the cancellation threshold as a percentage
 */
export function getCancellationThreshold(): number {
  return CANCELLATION_THRESHOLD * 100;
}
