/**
 * Stripe Product Setup Script
 * Creates the pricing products and prices for Splice
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_xxx npx tsx scripts/setup-stripe.ts
 */

import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY environment variable is required');
  console.error('Usage: STRIPE_SECRET_KEY=sk_test_xxx npx tsx scripts/setup-stripe.ts');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2025-02-24.acacia',
});

interface PricingTier {
  name: string;
  description: string;
  monthlyPrice: number; // in cents
  minutes: number;
}

const PRICING_TIERS: Record<string, PricingTier> = {
  pro: {
    name: 'Splice Pro',
    description: 'Professional tier with 300 minutes/month of AI-powered video editing',
    monthlyPrice: 6500, // $65.00
    minutes: 300,
  },
  pro_referral: {
    name: 'Splice Pro (Referral)',
    description: 'Discounted Pro tier for referred users - 2 months at $45/month',
    monthlyPrice: 4500, // $45.00
    minutes: 300,
  },
  studio: {
    name: 'Splice Studio',
    description: 'Studio tier with 1000 minutes/month for professional studios',
    monthlyPrice: 14900, // $149.00
    minutes: 1000,
  },
};

async function setupStripeProducts() {
  console.log('=== Splice Stripe Setup ===\n');

  const createdPrices: Record<string, string> = {};

  for (const [tierId, tier] of Object.entries(PRICING_TIERS)) {
    console.log(`Creating ${tier.name}...`);

    // Create product
    const product = await stripe.products.create({
      name: tier.name,
      description: tier.description,
      metadata: {
        tier_id: tierId,
        monthly_minutes: tier.minutes.toString(),
      },
    });

    console.log(`  Product created: ${product.id}`);

    // Create price
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: tier.monthlyPrice,
      currency: 'usd',
      recurring: {
        interval: 'month',
      },
      metadata: {
        tier_id: tierId,
      },
    });

    console.log(`  Price created: ${price.id}`);
    createdPrices[tierId] = price.id;
  }

  console.log('\n=== Setup Complete! ===\n');
  console.log('Add these to your Vercel environment variables:\n');
  console.log(`STRIPE_PRO_PRICE_ID=${createdPrices.pro}`);
  console.log(`STRIPE_PRO_REFERRAL_PRICE_ID=${createdPrices.pro_referral}`);
  console.log(`STRIPE_STUDIO_PRICE_ID=${createdPrices.studio}`);
  console.log('\n');

  return createdPrices;
}

setupStripeProducts().catch((error) => {
  console.error('Error setting up Stripe:', error);
  process.exit(1);
});
