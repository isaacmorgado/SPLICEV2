import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getExpiredTrials, convertTrialToFree } from '../shared/db';

/**
 * Cron job to expire trials and convert them to free tier
 * Runs daily at midnight UTC via Vercel Cron
 *
 * Configure in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/expire-trials",
 *     "schedule": "0 0 * * *"
 *   }]
 * }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow cron requests (Vercel sets this header)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  // In production, verify the cron secret
  if (process.env.NODE_ENV === 'production' && cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    // Get all expired trials
    const expiredTrials = await getExpiredTrials();

    if (expiredTrials.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No expired trials to process',
        processed: 0,
      });
    }

    console.log(`Processing ${expiredTrials.length} expired trials...`);

    // Convert each expired trial to free tier
    const trials = expiredTrials as { user_id: string }[];
    const results = await Promise.allSettled(
      trials.map((trial) => convertTrialToFree(trial.user_id))
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    // Log failures for debugging
    results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .forEach((r, i) => {
        console.error(`Failed to convert trial for user ${trials[i].user_id}:`, r.reason);
      });

    return res.status(200).json({
      success: true,
      message: `Processed ${expiredTrials.length} expired trials`,
      processed: succeeded,
      failed,
    });
  } catch (error) {
    console.error('Cron job error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
