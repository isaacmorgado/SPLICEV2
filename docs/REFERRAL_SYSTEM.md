# Splice Referral System

## Overview

The Splice referral system allows existing users to share a unique code with friends. Both parties benefit:

- **New User**: Gets 2 months at $45/month (instead of $65/month) - saves $40 total
- **Referrer**: Gets 1 free bonus month added to their subscription

## How It Works

### For Referrers (Existing Users)

1. **Generate Your Code**
   - Go to Settings > Referral in the Splice plugin
   - Click "Generate Referral Code"
   - You'll receive a unique 8-character code (e.g., `ABC12DEF`)

2. **Share Your Code**
   - Share the code with friends, on social media, or in communities
   - Each code can be used up to 10 times

3. **Track Your Rewards**
   - View your referral stats showing:
     - Total redemptions
     - Remaining uses
     - Bonus months earned

### For New Users

1. **Get a Referral Code**
   - Ask a friend for their code, or find one online

2. **Apply During Signup**
   - During registration or before subscribing, enter the referral code
   - The system validates the code is valid and has uses remaining

3. **Enjoy the Discount**
   - First 2 months: $45/month (Pro tier features)
   - After 2 months: Automatically upgrades to $65/month
   - No action needed - the price change is automatic via Stripe

## API Endpoints

### Generate Referral Code
```
POST /api/referrals/generate
Authorization: Bearer <token>

Response:
{
  "code": "ABC12DEF",
  "usesRemaining": 10
}
```

### Validate a Code (Before Signup)
```
GET /api/referrals/redeem?code=ABC12DEF

Response:
{
  "valid": true
}
```

### Redeem a Code (After Signup)
```
POST /api/referrals/redeem
Authorization: Bearer <token>
Body: { "code": "ABC12DEF" }

Response:
{
  "success": true,
  "message": "Referral code applied! You get 2 months at $45/month.",
  "benefits": {
    "discountedPrice": 4500,
    "discountedMonths": 2,
    "regularPrice": 6500
  }
}
```

### Get Referral Stats
```
GET /api/referrals/stats
Authorization: Bearer <token>

Response:
{
  "code": "ABC12DEF",
  "totalRedemptions": 3,
  "usesRemaining": 7,
  "bonusMonthsEarned": 3
}
```

## Pricing Structure

| Tier | Regular Price | Referral Price | Duration |
|------|--------------|----------------|----------|
| Pro | $65/month | $45/month | 2 months |
| Pro (after referral) | $65/month | - | Ongoing |
| Studio | $149/month | N/A | - |

## Technical Implementation

### Database Tables

**referral_codes**
- `id` - UUID primary key
- `code` - Unique 8-character code
- `owner_user_id` - FK to users
- `uses_remaining` - Starts at 10
- `created_at` - Timestamp

**referral_redemptions**
- `id` - UUID primary key
- `code_id` - FK to referral_codes
- `redeemed_by_user_id` - New user who used the code
- `rewarded_to_user_id` - Referrer who gets the bonus
- `created_at` - Timestamp

**subscriptions (additional columns)**
- `referred_by_code` - The code used (if any)
- `referral_months_remaining` - Countdown from 2 to 0
- `bonus_months` - Total bonus months earned by referring

### Automatic Price Upgrade Flow

1. User signs up with referral code
2. System creates subscription at `pro_referral` tier ($45/month)
3. Sets `referral_months_remaining = 2`
4. Each `invoice.paid` webhook:
   - Decrements `referral_months_remaining`
   - When it hits 0, triggers Stripe subscription update to regular Pro price
   - Updates tier from `pro_referral` to `pro`

---

## Paying Referrers (Future Enhancement)

Currently, referrers receive bonus months. To implement cash payouts:

### Option 1: Stripe Connect (Recommended)
1. Referrers connect their Stripe account
2. On each successful referral, create a Transfer to their connected account
3. Suggested payout: $10-20 per referral

### Option 2: PayPal Payouts
1. Collect referrer's PayPal email
2. Use PayPal Payouts API for batch payments
3. Process monthly or upon reaching threshold

### Option 3: Store Credit
1. Track earnings in database
2. Apply as credit to future invoices
3. Or allow withdrawal above threshold

### Implementation for Cash Payouts

```typescript
// api/_lib/referral-payouts.ts

import { stripe } from './stripe';

export async function payReferrer(
  referrerUserId: string,
  amount: number, // in cents
  referredUserEmail: string
) {
  // Get referrer's connected Stripe account
  const referrer = await getConnectedAccount(referrerUserId);

  if (!referrer?.stripeConnectId) {
    // Fall back to bonus months if no connected account
    await addBonusMonth(referrerUserId);
    return { type: 'bonus_month' };
  }

  // Create transfer to connected account
  const transfer = await stripe.transfers.create({
    amount,
    currency: 'usd',
    destination: referrer.stripeConnectId,
    transfer_group: `referral_${referredUserEmail}`,
    metadata: {
      referrer_user_id: referrerUserId,
      referred_email: referredUserEmail,
    },
  });

  return { type: 'cash', transferId: transfer.id };
}
```

---

## Business Rules

1. **Self-Referral Prevention**: Users cannot use their own referral code
2. **One Code Per User**: Each new user can only redeem one referral code ever
3. **10 Uses Per Code**: Each referral code has a maximum of 10 redemptions
4. **Active Subscription Required**: Referrer must have an active subscription to generate a code
5. **Discount Duration**: Exactly 2 billing cycles at discounted price

## Analytics to Track

- Total referral codes generated
- Total redemptions
- Conversion rate (codes generated vs redeemed)
- Revenue impact (discount given vs new customers acquired)
- Referrer retention (do referrers churn less?)
