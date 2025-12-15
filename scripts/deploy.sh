#!/bin/bash

# ===========================================
# Splice Plugin - Production Deployment Script
# ===========================================
# This script performs pre-deployment checks and deploys to Vercel
#
# Usage:
#   ./scripts/deploy.sh [--skip-tests] [--skip-plugin-build]
#
# Options:
#   --skip-tests         Skip running tests (not recommended)
#   --skip-plugin-build  Skip building the UXP plugin package
#
# Prerequisites:
#   - Vercel CLI installed (npm i -g vercel)
#   - Vercel project linked (vercel link)
#   - All environment variables configured in Vercel dashboard

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse command line arguments
SKIP_TESTS=false
SKIP_PLUGIN_BUILD=false

for arg in "$@"; do
  case $arg in
    --skip-tests)
      SKIP_TESTS=true
      shift
      ;;
    --skip-plugin-build)
      SKIP_PLUGIN_BUILD=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $arg${NC}"
      exit 1
      ;;
  esac
done

# Helper functions
print_header() {
  echo -e "\n${BLUE}===================================${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}===================================${NC}\n"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

# Check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# ===========================================
# PRE-DEPLOYMENT CHECKS
# ===========================================

print_header "Pre-Deployment Checks"

# Check Node version
echo "Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  print_error "Node.js version 20 or higher required. Current: $(node -v)"
  exit 1
fi
print_success "Node.js version: $(node -v)"

# Check if Vercel CLI is installed
echo "Checking Vercel CLI..."
if ! command_exists vercel; then
  print_error "Vercel CLI not found. Install with: npm i -g vercel"
  exit 1
fi
print_success "Vercel CLI installed: $(vercel --version)"

# Check if project is linked to Vercel
echo "Checking Vercel project link..."
if [ ! -f ".vercel/project.json" ]; then
  print_warning "Project not linked to Vercel. Running 'vercel link'..."
  vercel link
fi
print_success "Vercel project linked"

# Verify critical environment variables in Vercel
echo "Checking Vercel environment variables..."
REQUIRED_ENV_VARS=(
  "DATABASE_URL"
  "JWT_SECRET"
  "STRIPE_SECRET_KEY"
  "STRIPE_WEBHOOK_SECRET"
  "STRIPE_PRO_PRICE_ID"
  "STRIPE_STUDIO_PRICE_ID"
  "VITE_BACKEND_URL"
)

MISSING_VARS=()
for var in "${REQUIRED_ENV_VARS[@]}"; do
  # Check if variable is set in Vercel (this will show all env vars)
  if ! vercel env ls production 2>/dev/null | grep -q "$var"; then
    MISSING_VARS+=("$var")
  fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
  print_warning "Some environment variables may not be set in Vercel:"
  for var in "${MISSING_VARS[@]}"; do
    echo "  - $var"
  done
  print_warning "Please verify in Vercel dashboard: https://vercel.com/dashboard"
  read -p "Continue anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# ===========================================
# CODE QUALITY CHECKS
# ===========================================

print_header "Code Quality Checks"

# Install dependencies
echo "Installing dependencies..."
npm ci --prefer-offline
print_success "Dependencies installed"

# Run TypeScript type checking
echo "Running TypeScript type check..."
npm run typecheck
print_success "Type check passed"

# Run linting
echo "Running ESLint..."
npm run lint
print_success "Linting passed"

# Run tests (unless skipped)
if [ "$SKIP_TESTS" = false ]; then
  echo "Running tests..."
  npm run test:run
  print_success "All tests passed"
else
  print_warning "Tests skipped (--skip-tests flag)"
fi

# ===========================================
# BUILD VERIFICATION
# ===========================================

print_header "Build Verification"

# Build the project
echo "Building project..."
npm run build
print_success "Build completed"

# Verify dist directory exists
if [ ! -d "dist" ]; then
  print_error "Build failed: dist directory not found"
  exit 1
fi

# Verify manifest.json was copied
if [ ! -f "dist/manifest.json" ]; then
  print_error "Build failed: manifest.json not found in dist/"
  exit 1
fi
print_success "Build artifacts verified"

# ===========================================
# UXP PLUGIN PACKAGING
# ===========================================

if [ "$SKIP_PLUGIN_BUILD" = false ]; then
  print_header "UXP Plugin Packaging"

  # Check if UXP CLI is installed
  if ! command_exists uxp; then
    print_warning "UXP CLI not found. Install with: npm i -g @adobe/uxp-devtool-cli"
    print_warning "Skipping plugin packaging..."
  else
    echo "Packaging UXP plugin..."
    npm run uxp:package
    print_success "UXP plugin packaged to ./release/"

    # List generated packages
    if [ -d "release" ]; then
      echo "Generated plugin packages:"
      ls -lh release/*.ccx 2>/dev/null || true
    fi
  fi
else
  print_warning "UXP plugin packaging skipped (--skip-plugin-build flag)"
fi

# ===========================================
# DATABASE MIGRATION CHECK
# ===========================================

print_header "Database Migration Check"

print_warning "IMPORTANT: Ensure database migrations are up to date"
echo "Run the following command to apply migrations:"
echo "  ./scripts/db-migrate.sh production"
echo ""
read -p "Have you run database migrations? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  print_error "Please run database migrations before deploying"
  exit 1
fi
print_success "Database migrations confirmed"

# ===========================================
# DEPLOYMENT
# ===========================================

print_header "Deploying to Vercel"

echo "Deploying to production..."
echo ""

# Deploy to production
vercel --prod

print_success "Deployment completed!"

# ===========================================
# POST-DEPLOYMENT CHECKLIST
# ===========================================

print_header "Post-Deployment Checklist"

echo "Please verify the following:"
echo ""
echo "1. API Health Check:"
echo "   curl https://your-app.vercel.app/api/health"
echo ""
echo "2. Stripe Webhook Configuration:"
echo "   - Webhook URL: https://your-app.vercel.app/api/stripe/webhook"
echo "   - Events: customer.subscription.*, invoice.payment_*"
echo "   - Status: Active"
echo "   Dashboard: https://dashboard.stripe.com/webhooks"
echo ""
echo "3. Database Connection:"
echo "   - Check health endpoint shows database as 'healthy'"
echo ""
echo "4. Plugin Configuration:"
echo "   - Update VITE_BACKEND_URL in plugin to production URL"
echo "   - Rebuild plugin with production config"
echo "   - Test plugin authentication and API calls"
echo ""
echo "5. Environment Variables:"
echo "   - Verify all secrets are set in Vercel dashboard"
echo "   - Check for any missing optional variables"
echo ""
echo "6. UXP Plugin Distribution:"
echo "   - Upload packaged .ccx file to Adobe Exchange"
echo "   - Or distribute to users for manual installation"
echo ""

print_success "Deployment script completed successfully!"
echo ""
