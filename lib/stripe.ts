import Stripe from 'stripe';

// Lazy initialization to avoid module-level errors in Vercel
let _stripe: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!_stripe) {
    let secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }

    // Sanitize the key: remove quotes, whitespace, newlines, and other invalid chars
    secretKey = secretKey
      .replace(/^["']|["']$/g, '') // Remove surrounding quotes
      .replace(/[\r\n\t]/g, '') // Remove newlines and tabs
      .trim(); // Remove leading/trailing whitespace

    // Validate the key format
    if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_')) {
      console.error(
        'Warning: STRIPE_SECRET_KEY does not appear to be a valid Stripe key (should start with sk_test_ or sk_live_)'
      );
    }

    _stripe = new Stripe(secretKey, {
      apiVersion: '2024-12-18.acacia',
    });
  }
  return _stripe;
}

// For backwards compatibility with existing code
export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    return (getStripeClient() as Record<string | symbol, unknown>)[prop];
  },
});

// Billing period type
export type BillingPeriod = 'monthly' | 'yearly';

// Tier configuration
export interface Tier {
  id: 'free' | 'pro' | 'pro_referral' | 'studio';
  name: string;
  monthlyMinutes: number;
  priceMonthly: number; // cents
  priceYearly: number; // cents (total yearly price)
  stripePriceIdMonthly: string;
  stripePriceIdYearly: string;
  yearlySavings: number; // cents saved per year
  yearlyEffectiveMonthly: number; // cents - effective monthly rate when billed yearly
}

export const TIERS: Record<string, Tier> = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyMinutes: 10,
    priceMonthly: 0,
    priceYearly: 0,
    stripePriceIdMonthly: '',
    stripePriceIdYearly: '',
    yearlySavings: 0,
    yearlyEffectiveMonthly: 0,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyMinutes: 300,
    priceMonthly: 6500, // $65.00/month
    priceYearly: 58800, // $588.00/year ($49.00/month effective)
    stripePriceIdMonthly: process.env.STRIPE_PRO_PRICE_ID || '',
    stripePriceIdYearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID || '',
    yearlySavings: 19200, // $192.00 saved per year (24.6% off)
    yearlyEffectiveMonthly: 4900, // $49.00/month
  },
  pro_referral: {
    id: 'pro_referral',
    name: 'Pro (Referral)',
    monthlyMinutes: 300, // Same features as Pro
    priceMonthly: 4500, // $45.00 (discounted for 2 months)
    priceYearly: 54000, // $540.00/year (same rate as monthly discount)
    stripePriceIdMonthly: process.env.STRIPE_PRO_REFERRAL_PRICE_ID || '',
    stripePriceIdYearly: process.env.STRIPE_PRO_REFERRAL_YEARLY_PRICE_ID || '',
    yearlySavings: 24000, // $240.00 saved vs regular Pro yearly
    yearlyEffectiveMonthly: 4500, // $45.00/month
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    monthlyMinutes: 1000,
    priceMonthly: 14900, // $149.00/month
    priceYearly: 142800, // $1,428.00/year ($119.00/month effective)
    stripePriceIdMonthly: process.env.STRIPE_STUDIO_PRICE_ID || '',
    stripePriceIdYearly: process.env.STRIPE_STUDIO_YEARLY_PRICE_ID || '',
    yearlySavings: 36000, // $360.00 saved per year (20% off)
    yearlyEffectiveMonthly: 11900, // $119.00/month
  },
};

// Backwards compatibility - get price ID for a tier
export function getTierPriceId(tier: Tier, billingPeriod: BillingPeriod = 'monthly'): string {
  return billingPeriod === 'yearly' ? tier.stripePriceIdYearly : tier.stripePriceIdMonthly;
}

export function getTierByPriceId(
  priceId: string
): { tier: Tier; billingPeriod: BillingPeriod } | null {
  for (const tier of Object.values(TIERS)) {
    if (tier.stripePriceIdMonthly === priceId) {
      return { tier, billingPeriod: 'monthly' };
    }
    if (tier.stripePriceIdYearly === priceId) {
      return { tier, billingPeriod: 'yearly' };
    }
  }
  return null;
}

export async function createCheckoutSession(
  customerId: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string
) {
  return stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

export async function createCustomerPortalSession(customerId: string, returnUrl: string) {
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

export async function createCustomer(email: string, userId: string) {
  return stripe.customers.create({
    email,
    metadata: { userId },
  });
}

export async function getSubscription(subscriptionId: string) {
  return stripe.subscriptions.retrieve(subscriptionId);
}

export function constructWebhookEvent(payload: string | Buffer, signature: string) {
  return stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET!);
}
