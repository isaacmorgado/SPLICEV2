import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Dynamic imports for Vercel bundling
  const auth = await import('../../lib/auth.js');
  const db = await import('../../lib/db.js');
  const stripe = await import('../../lib/stripe.js');
  const usage = await import('../../lib/usage.js');

  const { authenticateRequest } = auth;
  const { getSubscriptionByUserId } = db;
  const { TIERS } = stripe;
  const { checkUsage } = usage;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate request
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get subscription
    const subscription = await getSubscriptionByUserId(payload.userId);
    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    // Get usage stats
    const usage = await checkUsage(payload.userId);

    // Get tier details
    const tier = TIERS[subscription.tier] || TIERS.free;

    return res.status(200).json({
      subscription: {
        id: subscription.id,
        tier: subscription.tier,
        tierName: tier.name,
        status: subscription.status,
        periodEnd: subscription.period_end,
        stripeCustomerId: subscription.stripe_customer_id,
        stripeSubscriptionId: subscription.stripe_subscription_id,
      },
      usage: {
        minutesUsed: usage.used,
        minutesLimit: usage.limit,
        minutesRemaining: usage.remaining,
        percentUsed: usage.limit > 0 ? (usage.used / usage.limit) * 100 : 0,
      },
      features: {
        voiceIsolation: true,
        transcription: true,
        takeAnalysis: true,
        priorityProcessing: subscription.tier !== 'free',
      },
    });
  } catch (error) {
    console.error('Subscription status error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
