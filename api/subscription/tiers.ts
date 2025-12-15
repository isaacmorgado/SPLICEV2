import type { VercelRequest, VercelResponse } from '@vercel/node';
import { TIERS } from '../lib/stripe';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Return public tier information
    const tiers = Object.values(TIERS).map((tier) => ({
      id: tier.id,
      name: tier.name,
      monthlyMinutes: tier.monthlyMinutes,
      priceMonthly: tier.priceMonthly,
      priceFormatted:
        tier.priceMonthly === 0 ? 'Free' : `$${(tier.priceMonthly / 100).toFixed(2)}/mo`,
      features: getTierFeatures(tier.id),
    }));

    return res.status(200).json({ tiers });
  } catch (error) {
    console.error('Tiers fetch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function getTierFeatures(tierId: string): string[] {
  const baseFeatures = [
    'Voice isolation for cleaner analysis',
    'AI-powered transcription',
    'Smart silence detection',
    'Take detection & labeling',
  ];

  switch (tierId) {
    case 'free':
      return [...baseFeatures, '10 minutes/month'];
    case 'pro':
      return [...baseFeatures, '120 minutes/month', 'Priority processing', 'Email support'];
    case 'studio':
      return [
        ...baseFeatures,
        '500 minutes/month',
        'Priority processing',
        'Priority support',
        'Early access to new features',
      ];
    default:
      return baseFeatures;
  }
}
