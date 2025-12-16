import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Database Cleanup Cron Job
 *
 * Runs periodically to clean up:
 * - Expired password reset tokens
 * - Old rate limit entries
 * - Old processed webhook events
 * - Old audit logs
 *
 * Should be configured in vercel.json to run daily
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify this is a cron request (Vercel adds this header)
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const results: Record<string, number> = {};

    // Clean up expired password reset tokens
    const passwordReset = await import('../../lib/password-reset.js');
    const { cleanupExpiredTokens } = passwordReset;
    results.passwordResetTokens = await cleanupExpiredTokens();

    // Clean up old rate limits and processed events
    const db = await import('../../lib/db.js');
    const { getSql } = db;
    const sql = await getSql();

    const rateLimitRows = await sql`
      DELETE FROM rate_limits
      WHERE created_at < NOW() - INTERVAL '1 hour'
      RETURNING id
    `;
    results.rateLimits = rateLimitRows.length;

    const webhookRows = await sql`
      DELETE FROM processed_webhook_events
      WHERE processed_at < NOW() - INTERVAL '7 days'
      RETURNING id
    `;
    results.processedWebhooks = webhookRows.length;

    // Clean up old audit logs (keep 90 days)
    const auditLog = await import('../../lib/audit-log.js');
    const { cleanupOldAuditLogs } = auditLog;
    results.auditLogs = await cleanupOldAuditLogs(90);

    // Clean up resolved failed webhooks older than 30 days
    const failedWebhookRows = await sql`
      DELETE FROM failed_webhook_events
      WHERE resolved = TRUE AND created_at < NOW() - INTERVAL '30 days'
      RETURNING id
    `;
    results.resolvedFailedWebhooks = failedWebhookRows.length;

    console.log('Database cleanup completed:', results);

    return res.status(200).json({
      success: true,
      message: 'Database cleanup completed',
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Database cleanup error:', error);
    return res.status(500).json({
      success: false,
      error: 'Database cleanup failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
