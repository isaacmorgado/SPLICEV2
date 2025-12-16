import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Dynamic imports for Vercel bundling
  const stripeLib = await import('../../lib/stripe.js');
  const { TIERS } = stripeLib;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Return public tier information with both monthly and yearly pricing
    const tiers = Object.values(TIERS).map((tier) => ({
      id: tier.id,
      name: tier.name,
      monthlyMinutes: tier.monthlyMinutes,
      // Monthly pricing
      priceMonthly: tier.priceMonthly,
      priceMonthlyFormatted:
        tier.priceMonthly === 0 ? 'Free' : `$${(tier.priceMonthly / 100).toFixed(2)}/mo`,
      // Yearly pricing
      priceYearly: tier.priceYearly,
      priceYearlyFormatted:
        tier.priceYearly === 0 ? 'Free' : `$${(tier.priceYearly / 100).toFixed(2)}/yr`,
      yearlyEffectiveMonthly: tier.yearlyEffectiveMonthly,
      yearlyEffectiveMonthlyFormatted:
        tier.yearlyEffectiveMonthly === 0
          ? 'Free'
          : `$${(tier.yearlyEffectiveMonthly / 100).toFixed(2)}/mo`,
      yearlySavings: tier.yearlySavings,
      yearlySavingsFormatted:
        tier.yearlySavings === 0 ? null : `$${(tier.yearlySavings / 100).toFixed(2)}`,
      yearlyDiscountPercent:
        tier.priceMonthly > 0
          ? Math.round((1 - tier.priceYearly / (tier.priceMonthly * 12)) * 100)
          : 0,
      // Features
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
      return [...baseFeatures, '300 minutes/month', 'Priority processing', 'Email support'];
    case 'studio':
      return [
        ...baseFeatures,
        '1000 minutes/month',
        'Priority processing',
        'Priority support',
        'Early access to new features',
      ];
    default:
      return baseFeatures;
  }
}
