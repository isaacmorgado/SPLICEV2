import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    success: true,
    message: 'Debug endpoint working',
    env: {
      hasDbUrl: !!process.env.DATABASE_URL,
      hasJwtSecret: !!process.env.JWT_SECRET,
      hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
      nodeVersion: process.version,
    },
  });
}
