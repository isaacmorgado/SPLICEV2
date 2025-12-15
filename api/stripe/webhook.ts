import type { VercelRequest, VercelResponse } from '@vercel/node';
import { constructWebhookEvent, getTierByPriceId, getSubscription } from '../_lib/stripe';
import { updateSubscription, resetMinutesUsed, sql } from '../_lib/db';
import type Stripe from 'stripe';

// Disable body parsing for webhook signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(readable: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const buf = await buffer(req);
    const signature = req.headers['stripe-signature'];

    if (!signature || typeof signature !== 'string') {
      return res.status(400).json({ error: 'Missing signature' });
    }

    // Verify webhook signature
    const event = constructWebhookEvent(buf, signature);

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(400).json({ error: 'Webhook error' });
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;

  if (!subscriptionId) return;

  // Get subscription details
  const subscription = await getSubscription(subscriptionId);
  const priceId = subscription.items.data[0]?.price.id;
  const tier = getTierByPriceId(priceId);

  // Find user by Stripe customer ID
  const users = await sql`
    SELECT user_id FROM subscriptions
    WHERE stripe_customer_id = ${customerId}
  `;

  if (users.length === 0) return;

  const userId = users[0].user_id;

  // Update subscription
  await updateSubscription(userId, {
    stripeSubscriptionId: subscriptionId,
    tier: tier?.id || 'pro',
    status: 'active',
    periodEnd: new Date(subscription.current_period_end * 1000),
  });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const priceId = subscription.items.data[0]?.price.id;
  const tier = getTierByPriceId(priceId);

  // Find user by Stripe customer ID
  const users = await sql`
    SELECT user_id FROM subscriptions
    WHERE stripe_customer_id = ${customerId}
  `;

  if (users.length === 0) return;

  const userId = users[0].user_id;

  await updateSubscription(userId, {
    tier: tier?.id || 'pro',
    status: subscription.status === 'active' ? 'active' : 'inactive',
    periodEnd: new Date(subscription.current_period_end * 1000),
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  // Find user by Stripe customer ID
  const users = await sql`
    SELECT user_id FROM subscriptions
    WHERE stripe_customer_id = ${customerId}
  `;

  if (users.length === 0) return;

  const userId = users[0].user_id;

  // Downgrade to free tier
  await updateSubscription(userId, {
    stripeSubscriptionId: undefined,
    tier: 'free',
    status: 'active',
    periodEnd: undefined,
  });
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  // Find user by Stripe customer ID
  const users = await sql`
    SELECT user_id FROM subscriptions
    WHERE stripe_customer_id = ${customerId}
  `;

  if (users.length === 0) return;

  const userId = users[0].user_id;

  // Reset usage on new billing period
  await resetMinutesUsed(userId);
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  // Find user by Stripe customer ID
  const users = await sql`
    SELECT user_id FROM subscriptions
    WHERE stripe_customer_id = ${customerId}
  `;

  if (users.length === 0) return;

  const userId = users[0].user_id;

  // Mark subscription as past_due
  await updateSubscription(userId, {
    status: 'past_due',
  });
}
