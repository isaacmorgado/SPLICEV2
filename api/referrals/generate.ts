import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Generate or retrieve a user's referral code
 * GET /api/referrals/generate
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Dynamic imports for Vercel bundling
  const auth = await import('../../lib/auth.js');
  const referrals = await import('../../lib/referrals.js');

  const { authenticateRequest } = auth;
  const { generateReferralCode, getReferralStats } = referrals;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate request
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Generate or get existing code
    const referralCode = await generateReferralCode(payload.userId);

    // Get stats
    const stats = await getReferralStats(payload.userId);

    return res.status(200).json({
      success: true,
      code: referralCode.code,
      usesRemaining: referralCode.usesRemaining,
      totalRedemptions: stats.totalRedemptions,
      bonusMonthsEarned: stats.bonusMonthsEarned,
      shareUrl: `https://splice.app/signup?ref=${referralCode.code}`,
    });
  } catch (error) {
    console.error('Generate referral code error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
