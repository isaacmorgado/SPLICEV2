# Deployment Guide - Splice UXP Plugin

This guide covers deploying the Splice UXP Plugin backend to Vercel and packaging the plugin for distribution.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Environment Configuration](#environment-configuration)
4. [Database Setup](#database-setup)
5. [Vercel Deployment](#vercel-deployment)
6. [Stripe Configuration](#stripe-configuration)
7. [UXP Plugin Packaging](#uxp-plugin-packaging)
8. [CI/CD with GitHub Actions](#cicd-with-github-actions)
9. [Post-Deployment Verification](#post-deployment-verification)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before deploying, ensure you have:

- **Node.js 20+** installed
- **npm** or **yarn** package manager
- **Vercel account** ([sign up](https://vercel.com/signup))
- **Neon Database** account ([sign up](https://neon.tech))
- **Stripe account** (Live mode keys)
- **OpenAI API key** (for AI features)
- **GitHub repository** (for CI/CD)
- **Adobe UXP Developer Tools** (for plugin packaging)

### Install Required CLIs

```bash
# Vercel CLI
npm install -g vercel

# Adobe UXP CLI
npm install -g @adobe/uxp-devtool-cli

# PostgreSQL Client (for database migrations)
# macOS:
brew install postgresql

# Ubuntu:
sudo apt-get install postgresql-client
```

---

## Initial Setup

### 1. Clone and Install Dependencies

```bash
git clone <your-repo-url>
cd splice
npm install
```

### 2. Link to Vercel Project

```bash
vercel link
```

Follow the prompts to:
- Select your Vercel account
- Link to existing project or create new one
- Confirm project settings

---

## Environment Configuration

### 1. Create Production Environment File

```bash
cp .env.production.example .env.production
```

### 2. Fill in Required Variables

Edit `.env.production` with your actual values:

```bash
# Critical - Must be set before deployment
DATABASE_URL=postgres://user:password@host.neon.tech/splice?sslmode=require
JWT_SECRET=<generate-with: openssl rand -base64 32>
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRO_PRICE_ID=price_xxxxx
STRIPE_STUDIO_PRICE_ID=price_xxxxx
VITE_BACKEND_URL=https://your-app.vercel.app/api

# AI Services
OPENAI_API_KEY=sk-xxxxx
ELEVENLABS_API_KEY=xxxxx
GEMINI_API_KEY=xxxxx
```

### 3. Add Environment Variables to Vercel

Add all environment variables to your Vercel project:

**Option A: Via Vercel Dashboard**
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Navigate to Settings → Environment Variables
4. Add each variable for Production environment

**Option B: Via CLI**
```bash
# Add each variable
vercel env add DATABASE_URL production
vercel env add JWT_SECRET production
vercel env add STRIPE_SECRET_KEY production
# ... etc
```

**Important Notes:**
- `VITE_*` variables are build-time variables (embedded in the plugin)
- All other variables are runtime variables (serverless functions only)
- Never commit `.env.production` to version control

---

## Database Setup

### 1. Create Neon Database

1. Go to [Neon Console](https://console.neon.tech)
2. Create a new project
3. Copy the connection string

### 2. Run Database Migration

```bash
# Development/Testing
./scripts/db-migrate.sh development

# Production (with safety checks)
./scripts/db-migrate.sh production
```

The migration script will:
- Apply schema from `db/schema.sql`
- Create tables: `users`, `subscriptions`, `usage_records`
- Set up indexes and constraints
- Create helper functions
- Verify installation

**Alternative: Manual Migration via Neon Console**
1. Go to [Neon SQL Editor](https://console.neon.tech)
2. Select your database
3. Copy contents of `db/schema.sql`
4. Execute in SQL Editor

---

## Vercel Deployment

### Option 1: Automated Deployment Script (Recommended)

```bash
# Full deployment with all checks
./scripts/deploy.sh

# Skip tests (not recommended)
./scripts/deploy.sh --skip-tests

# Skip plugin packaging
./scripts/deploy.sh --skip-plugin-build
```

The script will:
1. Verify Node.js version (20+)
2. Check Vercel CLI installation
3. Verify project link
4. Install dependencies
5. Run type checks
6. Run linting
7. Run tests
8. Build project
9. Package UXP plugin
10. Verify database migrations
11. Deploy to Vercel production
12. Display post-deployment checklist

### Option 2: Manual Deployment

```bash
# Install dependencies
npm ci

# Run pre-deployment checks
npm run typecheck
npm run lint
npm run test:run

# Build project
npm run build

# Deploy to production
vercel --prod
```

---

## Stripe Configuration

### 1. Create Products and Prices

1. Go to [Stripe Dashboard → Products](https://dashboard.stripe.com/products)
2. Create two products:
   - **Pro Tier** ($29/month)
   - **Studio Tier** ($99/month)
3. Copy the Price IDs (start with `price_`)
4. Add to environment variables

### 2. Configure Webhooks

1. Go to [Stripe Webhooks](https://dashboard.stripe.com/webhooks)
2. Click "Add endpoint"
3. Set URL: `https://your-app.vercel.app/api/stripe/webhook`
4. Select events to listen for:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the Webhook Signing Secret
6. Add to `STRIPE_WEBHOOK_SECRET` environment variable

### 3. Test Webhooks

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login to Stripe
stripe login

# Forward webhooks to local endpoint
stripe listen --forward-to localhost:3000/api/stripe/webhook

# Trigger test events
stripe trigger customer.subscription.created
```

---

## UXP Plugin Packaging

### 1. Update Plugin Configuration

Edit `manifest.json` to set production backend URL:

```json
{
  "manifestVersion": 5,
  "id": "com.splice.uxp-plugin",
  "name": "Splice",
  "version": "1.0.0",
  // ... other settings
}
```

Ensure `.env.production` has correct `VITE_BACKEND_URL`.

### 2. Build and Package Plugin

```bash
# Build plugin with production config
npm run build

# Package for distribution
npm run uxp:package
```

This creates a `.ccx` file in the `release/` directory.

### 3. Distribute Plugin

**Option A: Adobe Exchange**
1. Go to [Adobe Exchange Developer Portal](https://exchange.adobe.com/developer)
2. Upload the `.ccx` file
3. Fill in plugin details
4. Submit for review

**Option B: Manual Distribution**
1. Share the `.ccx` file with users
2. Users double-click to install
3. Plugin appears in Adobe Premiere Pro

---

## CI/CD with GitHub Actions

### 1. Add GitHub Secrets

Go to your repository Settings → Secrets and add:

- `VERCEL_TOKEN` - Get from [Vercel Account Settings](https://vercel.com/account/tokens)
- `VERCEL_ORG_ID` - Found in `.vercel/project.json` after linking
- `VERCEL_PROJECT_ID` - Found in `.vercel/project.json` after linking

### 2. Workflow Triggers

The GitHub Actions workflow (`.github/workflows/deploy.yml`) automatically:

**On Pull Request:**
- Runs tests
- Performs type checking
- Runs linting
- Creates preview deployment
- Comments PR with preview URL

**On Push to Main:**
- Runs all tests
- Deploys to production
- Verifies health check
- Creates deployment summary

### 3. Manual Deployment

Trigger deployment manually:
1. Go to Actions tab
2. Select "Deploy to Vercel" workflow
3. Click "Run workflow"

---

## Post-Deployment Verification

### 1. Health Check

```bash
curl https://your-app.vercel.app/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-12-15T...",
  "checks": [
    { "service": "database", "status": "healthy", "latencyMs": 45 },
    { "service": "environment", "status": "healthy" }
  ],
  "version": "abc1234"
}
```

### 2. Test Authentication

```bash
# Register a test user
curl -X POST https://your-app.vercel.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}'

# Login
curl -X POST https://your-app.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}'
```

### 3. Test Stripe Integration

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Check webhook events are being received
3. Test subscription creation flow
4. Verify webhook signatures are valid

### 4. Monitor Logs

```bash
# View production logs
vercel logs --prod

# Follow logs in real-time
vercel logs --prod --follow

# Filter by function
vercel logs --prod --output api/auth/login.ts
```

### 5. Test Plugin Connection

1. Install packaged plugin in Adobe Premiere Pro
2. Open plugin panel
3. Test user registration
4. Test login
5. Verify subscription status displays
6. Test AI features (transcription, voice isolation, etc.)

---

## Troubleshooting

### Database Connection Issues

**Problem:** Health check shows database as unhealthy

**Solutions:**
- Verify `DATABASE_URL` is correctly set in Vercel
- Check Neon database is active (not paused)
- Ensure connection string includes `?sslmode=require`
- Test connection with `psql $DATABASE_URL`

### Stripe Webhook Failures

**Problem:** Webhooks not being received or failing

**Solutions:**
- Verify webhook URL is correct (HTTPS)
- Check webhook secret matches Vercel env var
- Review Stripe Dashboard → Webhooks for error logs
- Test locally with `stripe listen`
- Ensure selected events match code handlers

### CORS Errors in Plugin

**Problem:** Plugin can't connect to API

**Solutions:**
- Verify `VITE_BACKEND_URL` matches deployed URL
- Rebuild plugin after changing env vars
- Check `vercel.json` CORS headers
- Test API endpoints directly with curl

### Build Failures

**Problem:** Deployment fails during build

**Solutions:**
- Check TypeScript errors: `npm run typecheck`
- Fix linting issues: `npm run lint:fix`
- Ensure all dependencies are in `package.json`
- Review Vercel build logs

### Environment Variables Not Loading

**Problem:** Variables undefined in serverless functions

**Solutions:**
- Verify variables are set in Vercel Dashboard
- Check variable names match exactly (case-sensitive)
- Redeploy after adding new variables
- Use `vercel env ls` to list configured variables

### Plugin Not Connecting After Deployment

**Problem:** Plugin shows connection errors

**Solutions:**
1. Verify `VITE_BACKEND_URL` is correct
2. Rebuild plugin with production config
3. Re-package and reinstall plugin
4. Check browser console in UXP DevTools
5. Test API health endpoint directly

---

## Deployment Checklist

Before going live:

- [ ] Database schema applied to production
- [ ] All environment variables set in Vercel
- [ ] Stripe webhooks configured and tested
- [ ] Health check endpoint returns healthy
- [ ] Authentication flow tested
- [ ] Subscription creation tested
- [ ] UXP plugin built with production URL
- [ ] Plugin tested end-to-end in Premiere Pro
- [ ] Error monitoring set up (Vercel logs)
- [ ] Backup strategy configured (Neon auto-backups)
- [ ] SSL certificates valid
- [ ] API rate limiting reviewed
- [ ] Security headers configured (check `vercel.json`)

---

## Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Neon Documentation](https://neon.tech/docs)
- [Stripe Webhooks Guide](https://stripe.com/docs/webhooks)
- [Adobe UXP Documentation](https://developer.adobe.com/photoshop/uxp/)
- [GitHub Actions Documentation](https://docs.github.com/actions)

---

## Support

For deployment issues:
1. Check this guide
2. Review Vercel logs
3. Check GitHub Actions logs
4. Review Stripe webhook logs
5. Contact support

---

**Last Updated:** December 15, 2025
