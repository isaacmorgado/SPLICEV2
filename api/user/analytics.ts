import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * User Usage Analytics Endpoint
 *
 * GET /api/user/analytics - Get usage statistics and trends
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Dynamic imports for Vercel bundling
  const auth = await import('../../lib/auth.js');
  const db = await import('../../lib/db.js');
  const middleware = await import('../../lib/middleware.js');

  const { authenticateRequest } = auth;
  const { getSql } = db;
  const { createErrorResponse } = middleware;

  if (req.method !== 'GET') {
    return res
      .status(405)
      .json(createErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed'));
  }

  try {
    // Authenticate request
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res
        .status(401)
        .json(createErrorResponse(401, 'UNAUTHORIZED', 'Authentication required'));
    }

    const userId = payload.userId;
    const sql = await getSql();

    // Get current subscription info
    const subRows = await sql`
      SELECT tier, minutes_used, period_end
      FROM subscriptions
      WHERE user_id = ${userId}
    `;

    const subscription = subRows[0] as
      | {
          tier: string;
          minutes_used: number;
          period_end: Date | null;
        }
      | undefined;

    if (!subscription) {
      return res.status(404).json(createErrorResponse(404, 'NOT_FOUND', 'Subscription not found'));
    }

    // Get usage breakdown by feature
    const featureUsageRows = await sql`
      SELECT
        feature,
        SUM(minutes) as total_minutes,
        COUNT(*) as request_count,
        AVG(minutes) as avg_minutes_per_request
      FROM usage_records
      WHERE user_id = ${userId}
      GROUP BY feature
      ORDER BY total_minutes DESC
    `;

    const featureUsage = featureUsageRows.map((row) => {
      const typedRow = row as {
        feature: string;
        total_minutes: string;
        request_count: string;
        avg_minutes_per_request: string;
      };
      return {
        feature: typedRow.feature,
        totalMinutes: parseFloat(typedRow.total_minutes),
        requestCount: parseInt(typedRow.request_count, 10),
        avgMinutesPerRequest: parseFloat(typedRow.avg_minutes_per_request),
      };
    });

    // Get usage over time (last 30 days, grouped by day)
    const usageTimelineRows = await sql`
      SELECT
        DATE(created_at) as date,
        SUM(minutes) as minutes,
        COUNT(*) as requests
      FROM usage_records
      WHERE user_id = ${userId}
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;

    const usageTimeline = usageTimelineRows.map((row) => {
      const typedRow = row as {
        date: string;
        minutes: string;
        requests: string;
      };
      return {
        date: typedRow.date,
        minutes: parseFloat(typedRow.minutes),
        requests: parseInt(typedRow.requests, 10),
      };
    });

    // Get total all-time usage
    const totalUsageRows = await sql`
      SELECT
        SUM(minutes) as total_minutes,
        COUNT(*) as total_requests
      FROM usage_records
      WHERE user_id = ${userId}
    `;

    const totalUsage = totalUsageRows[0] as {
      total_minutes: string | null;
      total_requests: string;
    };

    // Get current period usage (since period start)
    const periodStart = subscription.period_end
      ? new Date(new Date(subscription.period_end).getTime() - 30 * 24 * 60 * 60 * 1000)
      : null;

    // Get tier limits
    const stripeLib = await import('../../lib/stripe.js');
    const { TIERS } = stripeLib;
    const tier = TIERS[subscription.tier] || TIERS.free;

    return res.status(200).json({
      success: true,
      analytics: {
        currentPeriod: {
          tier: subscription.tier,
          minutesUsed: subscription.minutes_used,
          minutesLimit: tier.monthlyMinutes,
          minutesRemaining: Math.max(0, tier.monthlyMinutes - subscription.minutes_used),
          percentUsed: (subscription.minutes_used / tier.monthlyMinutes) * 100,
          periodEnd: subscription.period_end?.toISOString(),
          periodStart: periodStart?.toISOString(),
        },
        featureBreakdown: featureUsage,
        timeline: usageTimeline,
        allTime: {
          totalMinutes: parseFloat(totalUsage.total_minutes || '0'),
          totalRequests: parseInt(totalUsage.total_requests, 10),
        },
      },
    });
  } catch (error) {
    console.error('Analytics endpoint error:', error);
    return res
      .status(500)
      .json(createErrorResponse(500, 'INTERNAL_ERROR', 'Internal server error'));
  }
}
