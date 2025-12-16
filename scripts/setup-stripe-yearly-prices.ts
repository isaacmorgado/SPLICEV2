/**
 * Setup Stripe Yearly Prices
 *
 * This script creates the yearly price tiers in Stripe for the subscription plans.
 * Run with: npx ts-node scripts/setup-stripe-yearly-prices.ts
 *
 * Prerequisites:
 * - STRIPE_SECRET_KEY environment variable must be set
 * - Monthly prices should already exist (optional, will create products if needed)
 */

import Stripe from 'stripe';

// Hardcoded fallback for local development (same as in db.ts)
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY environment variable is required');
  console.error('Set it with: export STRIPE_SECRET_KEY=sk_test_...');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

interface PriceConfig {
  tierId: string;
  name: string;
  description: string;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  features: string[];
}

const PRICE_CONFIGS: PriceConfig[] = [
  {
    tierId: 'pro',
    name: 'Splice Pro',
    description: 'Professional video editing automation - 300 minutes/month',
    monthlyPriceCents: 6500, // $65.00
    yearlyPriceCents: 58800, // $588.00 ($49/mo effective)
    features: [
      '300 minutes/month',
      'AI-powered transcription',
      'Smart silence detection',
      'Take detection & labeling',
      'Priority processing',
      'Email support',
    ],
  },
  {
    tierId: 'pro_referral',
    name: 'Splice Pro (Referral)',
    description: 'Professional video editing automation - Referral discount',
    monthlyPriceCents: 4500, // $45.00
    yearlyPriceCents: 54000, // $540.00 ($45/mo)
    features: [
      '300 minutes/month',
      'AI-powered transcription',
      'Smart silence detection',
      'Take detection & labeling',
      'Referral discount rate',
    ],
  },
  {
    tierId: 'studio',
    name: 'Splice Studio',
    description: 'Studio-grade video editing automation - 1000 minutes/month',
    monthlyPriceCents: 14900, // $149.00
    yearlyPriceCents: 142800, // $1,428.00 ($119/mo effective)
    features: [
      '1000 minutes/month',
      'AI-powered transcription',
      'Smart silence detection',
      'Take detection & labeling',
      'Priority processing',
      'Priority support',
      'Early access to new features',
    ],
  },
];

async function findOrCreateProduct(config: PriceConfig): Promise<string> {
  console.log(`\nLooking for existing product: ${config.name}...`);

  // Search for existing product by name
  const products = await stripe.products.list({
    limit: 100,
    active: true,
  });

  const existingProduct = products.data.find(
    (p) => p.name === config.name || p.metadata?.tierId === config.tierId
  );

  if (existingProduct) {
    console.log(`  Found existing product: ${existingProduct.id}`);
    return existingProduct.id;
  }

  // Create new product
  console.log(`  Creating new product: ${config.name}...`);
  const product = await stripe.products.create({
    name: config.name,
    description: config.description,
    metadata: {
      tierId: config.tierId,
    },
    features: config.features.map((f) => ({ name: f })),
  });

  console.log(`  Created product: ${product.id}`);
  return product.id;
}

async function findExistingPrice(
  productId: string,
  interval: 'month' | 'year',
  amount: number
): Promise<Stripe.Price | null> {
  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 100,
  });

  return (
    prices.data.find(
      (p) => p.recurring?.interval === interval && p.unit_amount === amount && p.currency === 'usd'
    ) || null
  );
}

async function createPrice(
  productId: string,
  amount: number,
  interval: 'month' | 'year',
  tierId: string
): Promise<Stripe.Price> {
  // Check if price already exists
  const existingPrice = await findExistingPrice(productId, interval, amount);
  if (existingPrice) {
    console.log(`  Price already exists: ${existingPrice.id} ($${amount / 100}/${interval})`);
    return existingPrice;
  }

  // Create new price
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: amount,
    currency: 'usd',
    recurring: {
      interval: interval,
    },
    metadata: {
      tierId: tierId,
      billingPeriod: interval === 'month' ? 'monthly' : 'yearly',
    },
  });

  console.log(`  Created price: ${price.id} ($${amount / 100}/${interval})`);
  return price;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Stripe Yearly Prices Setup');
  console.log('='.repeat(60));

  const results: {
    tierId: string;
    productId: string;
    monthlyPriceId: string;
    yearlyPriceId: string;
  }[] = [];

  for (const config of PRICE_CONFIGS) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Setting up: ${config.name}`);
    console.log(`${'─'.repeat(60)}`);

    try {
      // Find or create product
      const productId = await findOrCreateProduct(config);

      // Create monthly price
      console.log(`\n  Creating monthly price ($${config.monthlyPriceCents / 100}/mo)...`);
      const monthlyPrice = await createPrice(
        productId,
        config.monthlyPriceCents,
        'month',
        config.tierId
      );

      // Create yearly price
      console.log(`\n  Creating yearly price ($${config.yearlyPriceCents / 100}/yr)...`);
      const yearlyPrice = await createPrice(
        productId,
        config.yearlyPriceCents,
        'year',
        config.tierId
      );

      results.push({
        tierId: config.tierId,
        productId,
        monthlyPriceId: monthlyPrice.id,
        yearlyPriceId: yearlyPrice.id,
      });
    } catch (error) {
      console.error(`  ERROR setting up ${config.name}:`, error);
    }
  }

  // Output environment variables
  console.log(`\n${'='.repeat(60)}`);
  console.log('ENVIRONMENT VARIABLES');
  console.log('Add these to your Vercel project:');
  console.log('='.repeat(60));

  for (const result of results) {
    const tierUpper = result.tierId.toUpperCase();
    console.log(`\n# ${result.tierId}`);
    console.log(`STRIPE_${tierUpper}_PRICE_ID=${result.monthlyPriceId}`);
    console.log(`STRIPE_${tierUpper}_YEARLY_PRICE_ID=${result.yearlyPriceId}`);
  }

  // Output as JSON for easy copying
  console.log(`\n${'='.repeat(60)}`);
  console.log('JSON OUTPUT (for programmatic use):');
  console.log('='.repeat(60));
  console.log(JSON.stringify(results, null, 2));

  // Output Vercel CLI commands
  console.log(`\n${'='.repeat(60)}`);
  console.log('VERCEL CLI COMMANDS:');
  console.log('='.repeat(60));
  console.log('\n# Run these commands to set environment variables:');
  for (const result of results) {
    const tierUpper = result.tierId.toUpperCase();
    console.log(`vercel env add STRIPE_${tierUpper}_PRICE_ID`);
    console.log(`vercel env add STRIPE_${tierUpper}_YEARLY_PRICE_ID`);
  }

  console.log('\n✅ Setup complete!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
