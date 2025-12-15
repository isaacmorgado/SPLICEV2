import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyRefreshToken, createToken, createRefreshToken, getTokenExpiry } from '../lib/auth';
import { getUserByEmail } from '../db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { refreshToken } = req.body;

    // Validate input
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    // Verify refresh token
    const payload = await verifyRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Verify user still exists
    const user = await getUserByEmail(payload.email);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Generate new tokens
    const tokenPayload = {
      userId: user.id,
      email: user.email,
    };
    const newToken = await createToken(tokenPayload);
    const newRefreshToken = await createRefreshToken(tokenPayload);
    const expiresAt = getTokenExpiry();

    return res.status(200).json({
      success: true,
      token: newToken,
      refreshToken: newRefreshToken,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
