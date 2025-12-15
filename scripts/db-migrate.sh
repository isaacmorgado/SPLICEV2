#!/bin/bash

# ===========================================
# Splice Plugin - Database Migration Script
# ===========================================
# This script handles database schema migrations for the Splice plugin
#
# Usage:
#   ./scripts/db-migrate.sh <environment> [--force]
#
# Arguments:
#   environment  - Target environment: development, staging, or production
#   --force     - Skip confirmation prompts (use with caution)
#
# Examples:
#   ./scripts/db-migrate.sh development
#   ./scripts/db-migrate.sh production
#   ./scripts/db-migrate.sh staging --force
#
# Prerequisites:
#   - PostgreSQL client (psql) installed
#   - DATABASE_URL environment variable set for the target environment
#   - Or use Neon SQL Editor: https://console.neon.tech

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
ENVIRONMENT=""
FORCE=false

for arg in "$@"; do
  case $arg in
    development|staging|production)
      ENVIRONMENT=$arg
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    *)
      if [ -z "$ENVIRONMENT" ]; then
        echo -e "${RED}Unknown environment: $arg${NC}"
        echo "Usage: $0 <development|staging|production> [--force]"
        exit 1
      fi
      ;;
  esac
done

# Validate environment argument
if [ -z "$ENVIRONMENT" ]; then
  echo -e "${RED}Error: Environment argument required${NC}"
  echo "Usage: $0 <development|staging|production> [--force]"
  exit 1
fi

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
# ENVIRONMENT SETUP
# ===========================================

print_header "Database Migration - $ENVIRONMENT"

# Determine which .env file to use
ENV_FILE=""
case $ENVIRONMENT in
  development)
    ENV_FILE=".env"
    ;;
  staging)
    ENV_FILE=".env.staging"
    ;;
  production)
    ENV_FILE=".env.production"
    ;;
esac

# Load environment variables if file exists
if [ -f "$ENV_FILE" ]; then
  echo "Loading environment from $ENV_FILE..."
  export $(cat "$ENV_FILE" | grep -v '^#' | grep -v '^$' | xargs)
  print_success "Environment loaded"
else
  print_warning "$ENV_FILE not found. Using current environment variables."
fi

# Verify DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  print_error "DATABASE_URL environment variable not set"
  echo "Please set DATABASE_URL or create $ENV_FILE with the database connection string"
  exit 1
fi

# Mask password in DATABASE_URL for display
MASKED_URL=$(echo "$DATABASE_URL" | sed -E 's/:([^@]+)@/:****@/')
echo "Database URL: $MASKED_URL"

# ===========================================
# SAFETY CHECKS
# ===========================================

print_header "Safety Checks"

# Production environment safety
if [ "$ENVIRONMENT" = "production" ] && [ "$FORCE" = false ]; then
  print_warning "YOU ARE ABOUT TO MODIFY THE PRODUCTION DATABASE"
  echo "This will apply schema changes that may affect live users."
  echo ""
  read -p "Are you absolutely sure you want to continue? (type 'yes' to confirm): " -r
  echo
  if [ "$REPLY" != "yes" ]; then
    print_error "Migration cancelled by user"
    exit 1
  fi
fi

# Check if psql is available
if ! command_exists psql; then
  print_warning "PostgreSQL client (psql) not found"
  echo ""
  echo "Option 1: Install PostgreSQL client"
  echo "  macOS: brew install postgresql"
  echo "  Ubuntu: sudo apt-get install postgresql-client"
  echo ""
  echo "Option 2: Use Neon SQL Editor (recommended for production)"
  echo "  1. Go to https://console.neon.tech"
  echo "  2. Select your database"
  echo "  3. Open SQL Editor"
  echo "  4. Copy and paste the contents of db/schema.sql"
  echo ""
  read -p "Open Neon Console? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command_exists open; then
      open "https://console.neon.tech"
    elif command_exists xdg-open; then
      xdg-open "https://console.neon.tech"
    fi
  fi
  exit 1
fi

print_success "PostgreSQL client found"

# ===========================================
# BACKUP REMINDER
# ===========================================

if [ "$ENVIRONMENT" = "production" ]; then
  print_header "Backup Reminder"
  print_warning "IMPORTANT: Ensure you have a database backup before proceeding"
  echo ""
  echo "Neon automatically creates backups, but you can also create a manual backup:"
  echo "  1. Go to https://console.neon.tech"
  echo "  2. Select your database"
  echo "  3. Navigate to 'Backups' tab"
  echo "  4. Create a manual backup point"
  echo ""
  if [ "$FORCE" = false ]; then
    read -p "Have you verified backups are in place? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      print_error "Please create a backup before proceeding"
      exit 1
    fi
  fi
fi

# ===========================================
# MIGRATION EXECUTION
# ===========================================

print_header "Executing Migration"

SCHEMA_FILE="db/schema.sql"

# Verify schema file exists
if [ ! -f "$SCHEMA_FILE" ]; then
  print_error "Schema file not found: $SCHEMA_FILE"
  exit 1
fi

echo "Migration file: $SCHEMA_FILE"
echo ""

# Show what will be executed
echo "Migration will execute the following:"
echo "----------------------------------------"
head -20 "$SCHEMA_FILE"
echo "..."
echo "----------------------------------------"
echo ""

if [ "$FORCE" = false ]; then
  read -p "Proceed with migration? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_error "Migration cancelled by user"
    exit 1
  fi
fi

# Execute migration
echo "Executing migration..."
psql "$DATABASE_URL" -f "$SCHEMA_FILE"

if [ $? -eq 0 ]; then
  print_success "Migration completed successfully!"
else
  print_error "Migration failed. Please check the error messages above."
  exit 1
fi

# ===========================================
# VERIFICATION
# ===========================================

print_header "Verification"

echo "Verifying database schema..."

# List tables
echo "Tables created:"
psql "$DATABASE_URL" -c "\dt" 2>/dev/null || print_warning "Could not list tables"

# Count rows in critical tables
echo ""
echo "Row counts:"
psql "$DATABASE_URL" -c "SELECT 'users' as table_name, COUNT(*) as count FROM users
                          UNION ALL SELECT 'subscriptions', COUNT(*) FROM subscriptions
                          UNION ALL SELECT 'usage_records', COUNT(*) FROM usage_records;" 2>/dev/null || print_warning "Could not query tables"

# Verify extensions
echo ""
echo "Extensions:"
psql "$DATABASE_URL" -c "SELECT extname FROM pg_extension WHERE extname = 'pgcrypto';" 2>/dev/null || print_warning "Could not verify extensions"

# Verify functions
echo ""
echo "Functions:"
psql "$DATABASE_URL" -c "SELECT routine_name FROM information_schema.routines WHERE routine_name = 'get_current_period_usage';" 2>/dev/null || print_warning "Could not verify functions"

print_success "Verification completed"

# ===========================================
# POST-MIGRATION STEPS
# ===========================================

print_header "Post-Migration Steps"

echo "Migration completed successfully for $ENVIRONMENT environment."
echo ""
echo "Next steps:"
echo ""
echo "1. Test database connectivity:"
echo "   curl https://your-app.vercel.app/api/health"
echo ""
echo "2. Verify authentication works:"
echo "   Test user registration and login"
echo ""
echo "3. Check subscription management:"
echo "   Test Stripe webhook processing"
echo ""
echo "4. Monitor logs:"
echo "   vercel logs --prod"
echo ""

if [ "$ENVIRONMENT" = "production" ]; then
  echo "5. Production-specific checks:"
  echo "   - Verify all indexes are created"
  echo "   - Check query performance"
  echo "   - Monitor error rates"
  echo "   - Test user flows end-to-end"
  echo ""
fi

print_success "Database migration script completed!"
echo ""
