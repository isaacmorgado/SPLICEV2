import type { VercelRequest, VercelResponse } from '@vercel/node';
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

  // Dynamic imports for Vercel bundling
  const stripeLib = await import('../../lib/stripe.js');
  const db = await import('../../lib/db.js');
  const referrals = await import('../../lib/referrals.js');

  const { constructWebhookEvent, getTierByPriceId, getSubscription, stripe, TIERS } = stripeLib;
  const { updateSubscription, getSql, transaction } = db;
  const { decrementReferralMonths } = referrals;

  // Helper functions defined inside handler to use imported modules
  async function isEventProcessed(eventId: string): Promise<boolean> {
    const sql = await getSql();
    const result = await sql`
      SELECT event_id FROM processed_webhook_events
      WHERE event_id = ${eventId}
    `;
    return result.length > 0;
  }

  async function markEventProcessed(eventId: string, eventType: string): Promise<void> {
    const sql = await getSql();
    await sql`
      INSERT INTO processed_webhook_events (event_id, event_type)
      VALUES (${eventId}, ${eventType})
      ON CONFLICT (event_id) DO NOTHING
    `;
  }

  async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const customerId = session.customer as string;
    const subscriptionId = session.subscription as string;

    if (!subscriptionId) {
      console.log('No subscription ID in checkout session, skipping');
      return;
    }

    const subscription = await getSubscription(subscriptionId);
    const priceId = subscription.items.data[0]?.price.id;
    const tier = getTierByPriceId(priceId);

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

    if (!subscriptionId) {
      console.log('Invoice not associated with subscription, skipping usage reset');
      return;
    }

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

    if (currentPeriodEnd && invoicePeriodEnd && invoicePeriodEnd > currentPeriodEnd) {
      await transaction(async (txSql) => {
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

      const shouldUpgrade = await decrementReferralMonths(userId);

      if (shouldUpgrade && stripeSubId) {
        console.log(`Upgrading user ${userId} from referral price to regular price`);

        try {
          const subscription = await stripe.subscriptions.retrieve(stripeSubId);
          const itemId = subscription.items.data[0]?.id;

          if (itemId && TIERS.pro.stripePriceId) {
            await stripe.subscriptions.update(stripeSubId, {
              items: [
                {
                  id: itemId,
                  price: TIERS.pro.stripePriceId,
                },
              ],
              proration_behavior: 'none',
            });

            await updateSubscription(userId, {
              tier: 'pro',
            });

            console.log(`Successfully upgraded user ${userId} to regular Pro price`);
          }
        } catch (upgradeError) {
          console.error(`Failed to upgrade user ${userId} to regular price:`, upgradeError);
        }
      }
    } else {
      console.log(`Invoice paid for user ${userId}, but not a new billing period`);
    }
  }

  async function handlePaymentFailed(invoice: Stripe.Invoice) {
    const customerId = invoice.customer as string;

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

    await updateSubscription(userId, {
      status: 'past_due',
    });

    console.log(`Payment failed for user ${userId}, marked as past_due`);
  }

  // Main webhook handler logic
  try {
    const buf = await buffer(req);
    const signature = req.headers['stripe-signature'];

    if (!signature || typeof signature !== 'string') {
      return res.status(400).json({ error: 'Missing signature' });
    }

    const event = constructWebhookEvent(buf, signature);

    if (await isEventProcessed(event.id)) {
      console.log(`Skipping already processed event: ${event.id} (${event.type})`);
      return res.status(200).json({ received: true, skipped: true });
    }

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
          handled = true;
      }

      if (handled) {
        await markEventProcessed(event.id, event.type);
      }
    } catch (handlerError) {
      console.error(`Error handling ${event.type}:`, handlerError);
      throw handlerError;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(400).json({ error: 'Webhook error' });
  }
}
