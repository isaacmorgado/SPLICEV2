import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Dynamic imports for Vercel bundling
  const auth = await import('../../lib/auth.js');
  const db = await import('../../lib/db.js');
  const stripeLib = await import('../../lib/stripe.js');

  const { authenticateRequest } = auth;
  const { getSubscriptionByUserId } = db;
  const { createCheckoutSession, TIERS, createCustomer } = stripeLib;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate request
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { tierId, successUrl, cancelUrl } = req.body;

    // Validate tier
    const tier = TIERS[tierId];
    if (!tier || !tier.stripePriceId) {
      return res.status(400).json({ error: 'Invalid tier selected' });
    }

    if (tier.id === 'free') {
      return res.status(400).json({ error: 'Cannot checkout for free tier' });
    }

    // Validate URLs
    if (!successUrl || !cancelUrl) {
      return res.status(400).json({ error: 'Success and cancel URLs are required' });
    }

    // Get subscription to find Stripe customer ID
    const subscription = await getSubscriptionByUserId(payload.userId);
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    let customerId = subscription.stripe_customer_id;

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await createCustomer(payload.email, payload.userId);
      customerId = customer.id;
    }

    // Create checkout session
    const session = await createCheckoutSession(
      customerId,
      tier.stripePriceId,
      successUrl,
      cancelUrl
    );

    return res.status(200).json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('Checkout session error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
