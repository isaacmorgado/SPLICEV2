import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../_lib/auth';
import { getUserById, getSubscriptionByUserId } from '../_lib/db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate request
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Get user details
    const user = await getUserById(payload.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get subscription status
    const subscription = await getSubscriptionByUserId(payload.userId);

    return res.status(200).json({
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
      },
      subscription: subscription
        ? {
            tier: subscription.tier,
            status: subscription.status,
            minutesUsed: subscription.minutes_used,
            periodEnd: subscription.period_end,
          }
        : null,
    });
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
