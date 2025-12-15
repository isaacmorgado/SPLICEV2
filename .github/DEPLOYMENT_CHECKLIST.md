# Deployment Checklist

Quick reference for deploying the Splice UXP Plugin to production.

## Pre-Deployment Setup

### 1. Environment Variables
- [ ] Create `.env.production` from `.env.production.example`
- [ ] Generate secure JWT secret: `openssl rand -base64 32`
- [ ] Get Neon database connection string
- [ ] Get Stripe LIVE keys (sk_live_*, price_*, whsec_*)
- [ ] Get OpenAI, ElevenLabs, Gemini API keys
- [ ] Set `VITE_BACKEND_URL` to production Vercel URL

### 2. Vercel Setup
- [ ] Install Vercel CLI: `npm i -g vercel`
- [ ] Link project: `vercel link`
- [ ] Add all environment variables to Vercel dashboard
- [ ] Verify `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` in `.vercel/project.json`

### 3. Database Setup
- [ ] Create Neon production database
- [ ] Run migration: `npm run db:migrate:prod`
- [ ] Verify tables created: users, subscriptions, usage_records
- [ ] Test connection: `psql $DATABASE_URL -c "SELECT 1"`

### 4. Stripe Configuration
- [ ] Create Pro and Studio products in Stripe Dashboard
- [ ] Copy Price IDs to environment variables
- [ ] Create webhook endpoint: `https://your-app.vercel.app/api/stripe/webhook`
- [ ] Configure webhook events:
  - customer.subscription.created
  - customer.subscription.updated
  - customer.subscription.deleted
  - invoice.payment_succeeded
  - invoice.payment_failed
- [ ] Copy webhook secret to `STRIPE_WEBHOOK_SECRET`

## Deployment Process

### Option 1: Automated Script (Recommended)
```bash
npm run deploy
```

### Option 2: Manual Steps
```bash
npm ci
npm run typecheck
npm run lint
npm run test:run
npm run build
npm run uxp:package
vercel --prod
```

## GitHub Actions Setup

### Required Secrets
Add these to GitHub repository Settings → Secrets:

- [ ] `VERCEL_TOKEN` - From Vercel Account Settings
- [ ] `VERCEL_ORG_ID` - From `.vercel/project.json`
- [ ] `VERCEL_PROJECT_ID` - From `.vercel/project.json`

### Workflows
- `.github/workflows/test.yml` - Runs tests on all PRs
- `.github/workflows/deploy.yml` - Deploys to Vercel on main branch

## Post-Deployment Verification

### 1. API Health Check
```bash
curl https://your-app.vercel.app/api/health
```
Expected: `{"status":"healthy",...}`

### 2. Test Authentication
```bash
# Register
curl -X POST https://your-app.vercel.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}'

# Login
curl -X POST https://your-app.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}'
```

### 3. Verify Stripe Webhooks
- [ ] Go to Stripe Dashboard → Webhooks
- [ ] Check webhook status is "Active"
- [ ] Send test event
- [ ] Verify received in Vercel logs: `vercel logs --prod`

### 4. Test UXP Plugin
- [ ] Install packaged .ccx in Adobe Premiere Pro
- [ ] Test user registration
- [ ] Test login
- [ ] Verify subscription status displays
- [ ] Test AI features (voice isolation, transcription, take analysis)

## Monitoring

### View Logs
```bash
# Production logs
vercel logs --prod

# Follow in real-time
vercel logs --prod --follow

# Filter by function
vercel logs --prod --output api/auth/login.ts
```

### Check Metrics
- [ ] Vercel Dashboard → Analytics
- [ ] Stripe Dashboard → Metrics
- [ ] Neon Dashboard → Monitoring

## Rollback Procedure

If issues occur:

1. **Rollback Deployment**
   ```bash
   vercel rollback
   ```

2. **Revert Database Changes**
   - Restore from Neon backup
   - Go to Neon Console → Backups → Restore

3. **Notify Users**
   - Post status update
   - Disable plugin if critical

## Common Issues

### Database Connection Fails
- Verify `DATABASE_URL` includes `?sslmode=require`
- Check Neon database is not paused
- Test with: `psql $DATABASE_URL`

### Stripe Webhooks Not Working
- Verify webhook URL is HTTPS
- Check webhook secret matches
- Review Stripe Dashboard → Webhooks for errors

### Plugin Can't Connect to API
- Verify `VITE_BACKEND_URL` is correct
- Rebuild and repackage plugin
- Check CORS headers in `vercel.json`

## Quick Commands

```bash
# Deploy to production
npm run deploy

# Run database migration
npm run db:migrate:prod

# Package plugin
npm run uxp:package

# View production logs
vercel logs --prod

# Check environment variables
vercel env ls production

# Rollback deployment
vercel rollback
```

## Support Links

- [Vercel Dashboard](https://vercel.com/dashboard)
- [Neon Console](https://console.neon.tech)
- [Stripe Dashboard](https://dashboard.stripe.com)
- [GitHub Actions](https://github.com/[your-org]/[your-repo]/actions)
- [Full Deployment Guide](../DEPLOYMENT.md)
