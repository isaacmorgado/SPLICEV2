import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Webhook Retry Cron Job
 *
 * Retries failed webhook events with exponential backoff
 * Runs every 15 minutes to process pending retries
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify this is a cron request
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = await import('../../lib/db.js');
    const { getSql } = db;
    const sql = await getSql();

    // Get failed webhooks ready for retry
    const failedWebhooks = await sql`
      SELECT id, event_id, event_type, payload, retry_count, max_retries
      FROM failed_webhook_events
      WHERE resolved = FALSE
        AND retry_count < max_retries
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY created_at ASC
      LIMIT 10
    `;

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      maxRetriesReached: 0,
    };

    for (const webhook of failedWebhooks) {
      const typedWebhook = webhook as {
        id: string;
        event_id: string;
        event_type: string;
        payload: unknown;
        retry_count: number;
        max_retries: number;
      };

      results.processed++;

      try {
        // Attempt to reprocess the webhook
        await processWebhookEvent(typedWebhook.event_type, typedWebhook.payload);

        // Mark as resolved
        await sql`
          UPDATE failed_webhook_events
          SET resolved = TRUE, last_retry_at = NOW()
          WHERE id = ${typedWebhook.id}
        `;

        results.succeeded++;
        console.log(`Successfully retried webhook: ${typedWebhook.event_id}`);
      } catch (error) {
        const newRetryCount = typedWebhook.retry_count + 1;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (newRetryCount >= typedWebhook.max_retries) {
          // Max retries reached
          await sql`
            UPDATE failed_webhook_events
            SET retry_count = ${newRetryCount},
                error_message = ${errorMessage},
                last_retry_at = NOW()
            WHERE id = ${typedWebhook.id}
          `;
          results.maxRetriesReached++;
          console.error(`Max retries reached for webhook: ${typedWebhook.event_id}`);
        } else {
          // Calculate next retry time with exponential backoff
          const backoffMinutes = Math.pow(2, newRetryCount) * 15; // 15, 30, 60 minutes
          const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

          await sql`
            UPDATE failed_webhook_events
            SET retry_count = ${newRetryCount},
                error_message = ${errorMessage},
                last_retry_at = NOW(),
                next_retry_at = ${nextRetryAt}
            WHERE id = ${typedWebhook.id}
          `;
          results.failed++;
          console.error(
            `Retry failed for webhook: ${typedWebhook.event_id}, next retry at: ${nextRetryAt.toISOString()}`
          );
        }
      }
    }

    console.log('Webhook retry completed:', results);

    return res.status(200).json({
      success: true,
      message: 'Webhook retry completed',
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Webhook retry error:', error);
    return res.status(500).json({
      success: false,
      error: 'Webhook retry failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Process a webhook event (placeholder - implement actual webhook handlers)
 */
async function processWebhookEvent(eventType: string, payload: unknown): Promise<void> {
  // Import and call the appropriate webhook handler based on event type
  // This is a simplified version - in production, you'd import the actual webhook handler
  // TODO: Import and use stripe.constructWebhookEvent when implementing full retry logic

  // For now, just log that we would process it
  console.log(`Would reprocess webhook event: ${eventType}`, payload);

  // In a real implementation, you would:
  // 1. Reconstruct the Stripe event
  // 2. Call the appropriate handler (handleCheckoutCompleted, etc.)
  // 3. Handle any errors

  // Simulating processing
  await new Promise((resolve) => setTimeout(resolve, 100));
}
