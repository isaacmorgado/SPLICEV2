# Stripe Yearly Pricing Setup Guide

This guide covers setting up yearly subscription prices in Stripe for Splice.

## Pricing Summary

| Tier | Monthly | Yearly | Effective Monthly | Savings |
|------|---------|--------|-------------------|---------|
| Pro | $65/mo | $588/yr | $49/mo | $192/yr (25% off) |
| Pro Referral | $45/mo | $540/yr | $45/mo | $240/yr vs regular |
| Studio | $149/mo | $1,428/yr | $119/mo | $360/yr (20% off) |

---

## Option 1: Automated Setup (Recommended)

### Step 1: Get Your Stripe Secret Key

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
2. Copy your **Secret key** (starts with `sk_test_` or `sk_live_`)

### Step 2: Run the Setup Script

```bash
# Navigate to project directory
cd /Users/imorgado/Documents/agent-girl/splice/splice

# Set your Stripe secret key
export STRIPE_SECRET_KEY=sk_test_your_key_here

# Run the setup script
npx ts-node scripts/setup-stripe-yearly-prices.ts
```

### Step 3: Copy the Output

The script will output environment variables like:
```
STRIPE_PRO_PRICE_ID=price_xxxxx
STRIPE_PRO_YEARLY_PRICE_ID=price_xxxxx
STRIPE_STUDIO_PRICE_ID=price_xxxxx
STRIPE_STUDIO_YEARLY_PRICE_ID=price_xxxxx
STRIPE_PRO_REFERRAL_PRICE_ID=price_xxxxx
STRIPE_PRO_REFERRAL_YEARLY_PRICE_ID=price_xxxxx
```

### Step 4: Add to Vercel

```bash
# Login to Vercel
vercel login

# Add each environment variable
vercel env add STRIPE_PRO_YEARLY_PRICE_ID
vercel env add STRIPE_STUDIO_YEARLY_PRICE_ID
vercel env add STRIPE_PRO_REFERRAL_YEARLY_PRICE_ID

# Redeploy to apply changes
vercel --prod
```

---

## Option 2: Manual Setup via Stripe Dashboard

### Step 1: Create Products (if not existing)

Go to [Stripe Products](https://dashboard.stripe.com/products)

**Create "Splice Pro":**
- Name: `Splice Pro`
- Description: `Professional video editing automation - 300 minutes/month`

**Create "Splice Studio":**
- Name: `Splice Studio`
- Description: `Studio-grade video editing automation - 1000 minutes/month`

**Create "Splice Pro (Referral)":**
- Name: `Splice Pro (Referral)`
- Description: `Professional video editing automation - Referral discount`

### Step 2: Add Yearly Prices

For each product, click "Add another price":

**Splice Pro - Yearly:**
- Price: `$588.00`
- Billing period: `Yearly`
- Copy the price ID (starts with `price_`)

**Splice Pro (Referral) - Yearly:**
- Price: `$540.00`
- Billing period: `Yearly`
- Copy the price ID

**Splice Studio - Yearly:**
- Price: `$1,428.00`
- Billing period: `Yearly`
- Copy the price ID

### Step 3: Add to Vercel Environment Variables

1. Go to [Vercel Dashboard](https://vercel.com) → Your Project → Settings → Environment Variables

2. Add these variables:

| Key | Value |
|-----|-------|
| `STRIPE_PRO_YEARLY_PRICE_ID` | `price_xxxxx` (from Splice Pro yearly) |
| `STRIPE_STUDIO_YEARLY_PRICE_ID` | `price_xxxxx` (from Splice Studio yearly) |
| `STRIPE_PRO_REFERRAL_YEARLY_PRICE_ID` | `price_xxxxx` (from Splice Pro Referral yearly) |

3. Click "Save" and redeploy your application.

---

## Verification

After setup, test the tiers endpoint:

```bash
curl -s https://splice-dusky.vercel.app/api/subscription/tiers | jq '.tiers[] | {id, priceYearlyFormatted, yearlyEffectiveMonthlyFormatted}'
```

Expected output:
```json
{
  "id": "pro",
  "priceYearlyFormatted": "$588.00/yr",
  "yearlyEffectiveMonthlyFormatted": "$49.00/mo"
}
{
  "id": "studio",
  "priceYearlyFormatted": "$1428.00/yr",
  "yearlyEffectiveMonthlyFormatted": "$119.00/mo"
}
```

---

## Testing Checkout Flow

Test yearly checkout (requires authentication):

```bash
# First login to get a token
TOKEN=$(curl -s -X POST https://splice-dusky.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' | jq -r '.token')

# Create yearly checkout session
curl -s -X POST https://splice-dusky.vercel.app/api/stripe/create-checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "tierId": "pro",
    "billingPeriod": "yearly",
    "successUrl": "https://splice-dusky.vercel.app/success",
    "cancelUrl": "https://splice-dusky.vercel.app/cancel"
  }'
```

---

## Troubleshooting

### "yearly pricing not available for this tier"
- The yearly price ID environment variable is not set
- Check Vercel environment variables

### "Invalid tier selected"
- The tier ID doesn't match (use: `pro`, `studio`, `pro_referral`)

### Prices not showing in Stripe Dashboard
- Make sure you're in the correct mode (Test vs Live)
- Check that products are active

---

## Environment Variables Reference

```env
# Monthly prices (likely already set)
STRIPE_PRO_PRICE_ID=price_xxxxx
STRIPE_STUDIO_PRICE_ID=price_xxxxx
STRIPE_PRO_REFERRAL_PRICE_ID=price_xxxxx

# Yearly prices (new)
STRIPE_PRO_YEARLY_PRICE_ID=price_xxxxx
STRIPE_STUDIO_YEARLY_PRICE_ID=price_xxxxx
STRIPE_PRO_REFERRAL_YEARLY_PRICE_ID=price_xxxxx
```
