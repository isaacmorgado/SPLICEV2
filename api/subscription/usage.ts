import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../_lib/auth';
import { getUsageRecords } from '../_lib/db';
import { checkUsage } from '../_lib/usage';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate request
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get usage summary
    const usage = await checkUsage(payload.userId);

    // Get recent usage records
    const limit = Number(req.query.limit) || 50;
    const records = await getUsageRecords(payload.userId, limit);

    // Group usage by feature
    const byFeature = records.reduce(
      (acc, record) => {
        const feature = record.feature;
        if (!acc[feature]) {
          acc[feature] = { count: 0, minutes: 0 };
        }
        acc[feature].count += 1;
        acc[feature].minutes += Number(record.minutes);
        return acc;
      },
      {} as Record<string, { count: number; minutes: number }>
    );

    return res.status(200).json({
      summary: {
        tier: usage.tier,
        minutesUsed: usage.used,
        minutesLimit: usage.limit,
        minutesRemaining: usage.remaining,
        allowed: usage.allowed,
      },
      byFeature,
      recentRecords: records.map((r) => ({
        id: r.id,
        feature: r.feature,
        minutes: Number(r.minutes),
        createdAt: r.created_at,
      })),
    });
  } catch (error) {
    console.error('Usage fetch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
