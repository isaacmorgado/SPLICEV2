import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  constructWebhookEvent,
  getTierByPriceId,
  getSubscription,
  stripe,
  TIERS,
} from '../lib/stripe';
import { updateSubscription, getSql, transaction } from '../_shared/db';
import { decrementReferralMonths } from '../lib/referrals';
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

/**
 * Check if a webhook event has already been processed (idempotency)
 * @returns true if event was already processed, false otherwise
 */
async function isEventProcessed(eventId: string): Promise<boolean> {
  const sql = await getSql();
  const result = await sql`
    SELECT event_id FROM processed_webhook_events
    WHERE event_id = ${eventId}
  `;
  return result.length > 0;
}

/**
 * Mark a webhook event as processed
 */
async function markEventProcessed(eventId: string, eventType: string): Promise<void> {
  const sql = await getSql();
  await sql`
    INSERT INTO processed_webhook_events (event_id, event_type)
    VALUES (${eventId}, ${eventType})
    ON CONFLICT (event_id) DO NOTHING
  `;
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

    // Idempotency check - skip if already processed
    if (await isEventProcessed(event.id)) {
      console.log(`Skipping already processed event: ${event.id} (${event.type})`);
      return res.status(200).json({ received: true, skipped: true });
    }

    // Handle the event
    let handled = false;
    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          handled = true;
          break;

        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          handled = true;
          break;

        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          handled = true;
          break;

        case 'invoice.paid':
          await handleInvoicePaid(event.data.object as Stripe.Invoice);
          handled = true;
          break;

        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object as Stripe.Invoice);
          handled = true;
          break;

        default:
          console.log(`Unhandled event type: ${event.type}`);
          // Still mark as processed to prevent retries
          handled = true;
      }

      // Mark event as processed after successful handling
      if (handled) {
        await markEventProcessed(event.id, event.type);
      }
    } catch (handlerError) {
      // Log the error but don't mark as processed so Stripe will retry
      console.error(`Error handling ${event.type}:`, handlerError);
      throw handlerError;
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

  if (!subscriptionId) {
    console.log('No subscription ID in checkout session, skipping');
    return;
  }

  // Get subscription details
  const subscription = await getSubscription(subscriptionId);
  const priceId = subscription.items.data[0]?.price.id;
  const tier = getTierByPriceId(priceId);

  // Find user by Stripe customer ID
  const sql = await getSql();
  const users = await sql`
    SELECT user_id FROM subscriptions
    WHERE stripe_customer_id = ${customerId}
  `;

  if (users.length === 0) {
    console.warn(`No user found for Stripe customer: ${customerId}`);
    return;
  }

  const userId = (users[0] as { user_id: string }).user_id;

  // Update subscription
  await updateSubscription(userId, {
    stripeSubscriptionId: subscriptionId,
    tier: tier?.id || 'pro',
    status: 'active',
    periodEnd: new Date(subscription.current_period_end * 1000),
  });

  console.log(`Checkout completed for user ${userId}, tier: ${tier?.id || 'pro'}`);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const priceId = subscription.items.data[0]?.price.id;
  const tier = getTierByPriceId(priceId);

  // Find user by Stripe customer ID
  const sql = await getSql();
  const users = await sql`
    SELECT user_id FROM subscriptions
    WHERE stripe_customer_id = ${customerId}
  `;

  if (users.length === 0) {
    console.warn(`No user found for Stripe customer: ${customerId}`);
    return;
  }

  const userId = (users[0] as { user_id: string }).user_id;

  // Map Stripe status to our status
  let status: string;
  switch (subscription.status) {
    case 'active':
    case 'trialing':
      status = 'active';
      break;
    case 'past_due':
      status = 'past_due';
      break;
    case 'canceled':
    case 'unpaid':
      status = 'canceled';
      break;
    default:
      status = 'active';
  }

  await updateSubscription(userId, {
    tier: tier?.id || 'pro',
    status,
    periodEnd: new Date(subscription.current_period_end * 1000),
  });

  console.log(`Subscription updated for user ${userId}, status: ${status}, tier: ${tier?.id}`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  // Find user by Stripe customer ID
  const sql = await getSql();
  const users = await sql`
    SELECT user_id FROM subscriptions
    WHERE stripe_customer_id = ${customerId}
  `;

  if (users.length === 0) {
    console.warn(`No user found for Stripe customer: ${customerId}`);
    return;
  }

  const userId = (users[0] as { user_id: string }).user_id;

  // Downgrade to free tier
  await updateSubscription(userId, {
    stripeSubscriptionId: undefined,
    tier: 'free',
    status: 'active',
    periodEnd: undefined,
  });

  console.log(`Subscription deleted for user ${userId}, downgraded to free`);
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;
  const subscriptionId = invoice.subscription as string;

  // Only reset usage for subscription invoices (not one-time payments)
  if (!subscriptionId) {
    console.log('Invoice not associated with subscription, skipping usage reset');
    return;
  }

  // Find user by Stripe customer ID
  const sql = await getSql();
  const users = await sql`
    SELECT user_id, period_end, referral_months_remaining, stripe_subscription_id
    FROM subscriptions
    WHERE stripe_customer_id = ${customerId}
  `;

  if (users.length === 0) {
    console.warn(`No user found for Stripe customer: ${customerId}`);
    return;
  }

  const user = users[0] as {
    user_id: string;
    stripe_subscription_id: string | null;
    period_end: string | null;
  };
  const userId = user.user_id;
  const stripeSubId = user.stripe_subscription_id;
  const currentPeriodEnd = user.period_end ? new Date(user.period_end) : null;
  const invoicePeriodEnd = invoice.lines.data[0]?.period?.end
    ? new Date(invoice.lines.data[0].period.end * 1000)
    : null;

  // Only reset if this is actually a new billing period
  // (prevents resetting on subscription changes within same period)
  if (currentPeriodEnd && invoicePeriodEnd && invoicePeriodEnd > currentPeriodEnd) {
    await transaction(async (txSql) => {
      // Reset usage and update period end atomically
      await txSql`
        UPDATE subscriptions
        SET minutes_used = 0,
            period_end = ${invoicePeriodEnd}
        WHERE user_id = ${userId}
      `;
    });
    console.log(
      `Usage reset for user ${userId}, new period ends: ${invoicePeriodEnd.toISOString()}`
    );

    // Handle referral price upgrade
    // Decrement referral months and check if we need to upgrade to regular price
    const shouldUpgrade = await decrementReferralMonths(userId);

    if (shouldUpgrade && stripeSubId) {
      // User's referral discount period has ended, upgrade to regular price
      console.log(`Upgrading user ${userId} from referral price to regular price`);

      try {
        // Get current subscription to find the item ID
        const subscription = await stripe.subscriptions.retrieve(stripeSubId);
        const itemId = subscription.items.data[0]?.id;

        if (itemId && TIERS.pro.stripePriceId) {
          // Update subscription to regular Pro price ($65/month)
          await stripe.subscriptions.update(stripeSubId, {
            items: [
              {
                id: itemId,
                price: TIERS.pro.stripePriceId,
              },
            ],
            proration_behavior: 'none', // Don't prorate, just change price for next billing
          });

          // Update our database
          await updateSubscription(userId, {
            tier: 'pro', // Change from pro_referral to pro
          });

          console.log(`Successfully upgraded user ${userId} to regular Pro price`);
        }
      } catch (upgradeError) {
        console.error(`Failed to upgrade user ${userId} to regular price:`, upgradeError);
        // Don't throw - the subscription is still valid, just at the wrong price
        // Manual intervention may be needed
      }
    }
  } else {
    console.log(`Invoice paid for user ${userId}, but not a new billing period`);
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  // Find user by Stripe customer ID
  const sql = await getSql();
  const users = await sql`
    SELECT user_id FROM subscriptions
    WHERE stripe_customer_id = ${customerId}
  `;

  if (users.length === 0) {
    console.warn(`No user found for Stripe customer: ${customerId}`);
    return;
  }

  const userId = (users[0] as { user_id: string }).user_id;

  // Mark subscription as past_due
  await updateSubscription(userId, {
    status: 'past_due',
  });

  console.log(`Payment failed for user ${userId}, marked as past_due`);
}
