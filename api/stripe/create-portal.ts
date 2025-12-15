import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../lib/auth';
import { getSubscriptionByUserId } from '../db';
import { createCustomerPortalSession } from '../lib/stripe';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate request
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { returnUrl } = req.body;

    if (!returnUrl) {
      return res.status(400).json({ error: 'Return URL is required' });
    }

    // Get subscription to find Stripe customer ID
    const subscription = await getSubscriptionByUserId(payload.userId);
    if (!subscription?.stripe_customer_id) {
      return res.status(404).json({ error: 'No Stripe customer found' });
    }

    // Create portal session
    const session = await createCustomerPortalSession(subscription.stripe_customer_id, returnUrl);

    return res.status(200).json({
      url: session.url,
    });
  } catch (error) {
    console.error('Portal session error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
