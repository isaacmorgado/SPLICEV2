/**
 * Stripe Webhook Setup Script
 *
 * Creates or updates the webhook endpoint in Stripe for receiving
 * subscription and payment events.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_xxx WEBHOOK_URL=https://your-domain.vercel.app/api/stripe/webhook npx tsx scripts/setup-stripe-webhook.ts
 */

import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!STRIPE_SECRET_KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY environment variable is required');
  process.exit(1);
}

if (!WEBHOOK_URL) {
  console.error('ERROR: WEBHOOK_URL environment variable is required');
  console.error('Example: WEBHOOK_URL=https://splice.vercel.app/api/stripe/webhook');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2025-02-24.acacia',
});

// Events we need to handle
const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
];

async function setupWebhook() {
  console.log('=== Stripe Webhook Setup ===\n');
  console.log(`Webhook URL: ${WEBHOOK_URL}`);
  console.log(`Events: ${WEBHOOK_EVENTS.join(', ')}\n`);

  try {
    // Check for existing webhooks with same URL
    const existingWebhooks = await stripe.webhookEndpoints.list({ limit: 100 });
    const existing = existingWebhooks.data.find((w) => w.url === WEBHOOK_URL);

    if (existing) {
      console.log(`Found existing webhook: ${existing.id}`);
      console.log('Updating events...');

      const updated = await stripe.webhookEndpoints.update(existing.id, {
        enabled_events: WEBHOOK_EVENTS,
        description: 'Splice subscription and payment events',
      });

      console.log('\nWebhook updated successfully!');
      console.log(`ID: ${updated.id}`);
      console.log(`Status: ${updated.status}`);

      // Note: We can't retrieve the secret for existing webhooks
      console.log('\n[!] IMPORTANT: To get the webhook secret, you need to:');
      console.log('    1. Go to https://dashboard.stripe.com/webhooks');
      console.log(`    2. Click on the webhook endpoint: ${WEBHOOK_URL}`);
      console.log('    3. Click "Reveal" under "Signing secret"');
      console.log('    4. Copy the secret (starts with whsec_)');
      console.log('    5. Add it to Vercel as STRIPE_WEBHOOK_SECRET');
    } else {
      console.log('Creating new webhook endpoint...');

      const webhook = await stripe.webhookEndpoints.create({
        url: WEBHOOK_URL,
        enabled_events: WEBHOOK_EVENTS,
        description: 'Splice subscription and payment events',
      });

      console.log('\nWebhook created successfully!');
      console.log(`ID: ${webhook.id}`);
      console.log(`Status: ${webhook.status}`);
      console.log(`\nWebhook Secret: ${webhook.secret}`);

      console.log('\n=== Add to Vercel ===');
      console.log(`STRIPE_WEBHOOK_SECRET=${webhook.secret}`);
    }

    console.log('\n=== Subscribed Events ===');
    WEBHOOK_EVENTS.forEach((event) => console.log(`  - ${event}`));

    console.log('\nSetup complete!');
  } catch (error) {
    console.error('Error setting up webhook:', error);
    process.exit(1);
  }
}

setupWebhook();
