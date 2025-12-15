import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Redeem a referral code
 * POST /api/referrals/redeem
 * Body: { code: string }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Dynamic imports for Vercel bundling
  const auth = await import('../../lib/auth.js');
  const referrals = await import('../../lib/referrals.js');

  const { authenticateRequest } = auth;
  const { redeemReferralCode, validateReferralCode } = referrals;

  // GET - Validate a referral code (for checking before registration)
  if (req.method === 'GET') {
    try {
      const code = req.query.code as string;

      if (!code) {
        return res.status(400).json({ error: 'Referral code is required' });
      }

      const result = await validateReferralCode(code);

      return res.status(200).json({
        valid: result.valid,
        error: result.error,
      });
    } catch (error) {
      console.error('Validate referral code error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // POST - Redeem a referral code
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate request
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Referral code is required' });
    }

    // Redeem the code
    const result = await redeemReferralCode(code, payload.userId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Referral code applied! You get 2 months at $45/month.',
      benefits: {
        discountedPrice: 4500, // cents
        discountedMonths: 2,
        regularPrice: 6500, // cents
      },
    });
  } catch (error) {
    console.error('Redeem referral code error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
