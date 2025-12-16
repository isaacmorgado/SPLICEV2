import Stripe from 'stripe';

// Lazy initialization to avoid module-level errors in Vercel
let _stripe: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!_stripe) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
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

// Tier configuration
export interface Tier {
  id: 'free' | 'pro' | 'pro_referral' | 'studio';
  name: string;
  monthlyMinutes: number;
  priceMonthly: number; // cents
  stripePriceId: string;
}

export const TIERS: Record<string, Tier> = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyMinutes: 10,
    priceMonthly: 0,
    stripePriceId: '',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyMinutes: 300,
    priceMonthly: 6500, // $65.00
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID || '',
  },
  pro_referral: {
    id: 'pro_referral',
    name: 'Pro (Referral)',
    monthlyMinutes: 300, // Same features as Pro
    priceMonthly: 4500, // $45.00 (discounted for 2 months)
    stripePriceId: process.env.STRIPE_PRO_REFERRAL_PRICE_ID || '',
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    monthlyMinutes: 1000,
    priceMonthly: 14900, // $149.00
    stripePriceId: process.env.STRIPE_STUDIO_PRICE_ID || '',
  },
};

export function getTierByPriceId(priceId: string): Tier | null {
  return Object.values(TIERS).find((tier) => tier.stripePriceId === priceId) || null;
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
