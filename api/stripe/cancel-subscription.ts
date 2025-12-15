import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../lib/auth';
import { getSubscriptionByUserId } from '../lib/db';
import { checkCancellationEligibility } from '../lib/cancellation';
import { stripe } from '../lib/stripe';

/**
 * Cancel Subscription Endpoint
 *
 * GET /api/stripe/cancel-subscription - Check if user can cancel
 * POST /api/stripe/cancel-subscription - Actually cancel the subscription
 *
 * Cancels the user's subscription at the end of the current billing period,
 * but only if they've used less than 25% of their monthly minutes.
 *
 * This prevents abuse where users consume significant value and then cancel
 * before paying for the usage.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET - Check cancellation eligibility
  if (req.method === 'GET') {
    return handleCheckEligibility(req, res);
  }

  // POST - Actually cancel
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate request
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check cancellation eligibility
    const eligibility = await checkCancellationEligibility(payload.userId);

    if (!eligibility.canCancel) {
      return res.status(403).json({
        error: 'Cancellation not allowed',
        reason: eligibility.reason,
        usagePercent: eligibility.usagePercent,
        threshold: eligibility.threshold,
        minutesUsed: eligibility.minutesUsed,
        minutesLimit: eligibility.minutesLimit,
        periodEnd: eligibility.periodEnd,
      });
    }

    // Get subscription to find Stripe subscription ID
    const subscription = await getSubscriptionByUserId(payload.userId);

    if (!subscription?.stripe_subscription_id) {
      return res.status(404).json({
        error: 'No active subscription found',
        message: 'You do not have an active paid subscription to cancel.',
      });
    }

    // Cancel at period end (graceful cancellation)
    // User keeps access until their billing period ends
    const updatedSubscription = await stripe.subscriptions.update(
      subscription.stripe_subscription_id,
      {
        cancel_at_period_end: true,
      }
    );

    const periodEnd = new Date(updatedSubscription.current_period_end * 1000);

    return res.status(200).json({
      success: true,
      message: 'Your subscription has been scheduled for cancellation.',
      details: {
        cancelAt: periodEnd.toISOString(),
        cancelAtFormatted: periodEnd.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        accessUntil: `You'll have full access until ${periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`,
        reactivate: 'Changed your mind? You can reactivate anytime before the cancellation date.',
      },
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Handle GET request - Check cancellation eligibility
 */
async function handleCheckEligibility(req: VercelRequest, res: VercelResponse) {
  try {
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const eligibility = await checkCancellationEligibility(payload.userId);

    return res.status(200).json({
      canCancel: eligibility.canCancel,
      usagePercent: eligibility.usagePercent,
      threshold: eligibility.threshold,
      minutesUsed: eligibility.minutesUsed,
      minutesLimit: eligibility.minutesLimit,
      tier: eligibility.tier,
      periodEnd: eligibility.periodEnd,
      reason: eligibility.reason,
    });
  } catch (error) {
    console.error('Cancellation check error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
