import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia',
});

// Tier configuration - values TBD
export interface Tier {
  id: 'free' | 'pro' | 'studio';
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
    monthlyMinutes: 120,
    priceMonthly: 1499, // $14.99
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID || '',
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    monthlyMinutes: 500,
    priceMonthly: 3999, // $39.99
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
