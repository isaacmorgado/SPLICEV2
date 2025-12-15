# Deployment Scripts

This directory contains scripts for deploying and managing the Splice UXP Plugin.

## Scripts Overview

### deploy.sh

Full production deployment script with comprehensive pre-checks and verification.

**Usage:**
```bash
# Full deployment with all checks (recommended)
./scripts/deploy.sh

# Skip tests (not recommended for production)
./scripts/deploy.sh --skip-tests

# Skip UXP plugin packaging
./scripts/deploy.sh --skip-plugin-build
```

**npm script aliases:**
```bash
npm run deploy
npm run deploy:skip-tests
```

**What it does:**
1. Verifies Node.js version (20+)
2. Checks Vercel CLI installation and project link
3. Validates environment variables are set
4. Installs dependencies with `npm ci`
5. Runs TypeScript type checking
6. Runs ESLint
7. Runs test suite
8. Builds project
9. Packages UXP plugin
10. Confirms database migrations
11. Deploys to Vercel production
12. Displays post-deployment checklist

**Prerequisites:**
- Vercel CLI installed: `npm i -g vercel`
- Project linked: `vercel link`
- Environment variables configured in Vercel dashboard
- All required secrets (DATABASE_URL, JWT_SECRET, etc.)

---

### db-migrate.sh

Database schema migration script for applying SQL changes to Neon PostgreSQL.

**Usage:**
```bash
# Development environment
./scripts/db-migrate.sh development

# Production environment (with safety prompts)
./scripts/db-migrate.sh production

# Skip confirmation prompts (use with caution)
./scripts/db-migrate.sh production --force
```

**npm script aliases:**
```bash
npm run db:migrate:dev
npm run db:migrate:prod
```

**What it does:**
1. Loads environment variables from appropriate .env file
2. Verifies DATABASE_URL is set
3. Runs safety checks (especially for production)
4. Reminds about backups for production deployments
5. Executes `db/schema.sql` against the database
6. Verifies tables, extensions, and functions were created
7. Displays verification results

**Prerequisites:**
- PostgreSQL client (psql) installed
  - macOS: `brew install postgresql`
  - Ubuntu: `sudo apt-get install postgresql-client`
- DATABASE_URL set in environment or .env file

**Alternative:**
If psql is not available, use Neon SQL Editor:
1. Go to https://console.neon.tech
2. Select your database
3. Open SQL Editor
4. Copy and paste contents of `db/schema.sql`

---

## Environment Files

Scripts use these environment files:

- `.env` - Development environment (loaded for `development`)
- `.env.staging` - Staging environment (loaded for `staging`)
- `.env.production` - Production environment (loaded for `production`)

Create from templates:
```bash
cp .env.example .env
cp .env.production.example .env.production
```

---

## Common Workflows

### First-time Production Deployment

```bash
# 1. Set up environment
cp .env.production.example .env.production
# Edit .env.production with real values

# 2. Link Vercel project
vercel link

# 3. Add environment variables to Vercel
vercel env add DATABASE_URL production
vercel env add JWT_SECRET production
# ... add all required variables

# 4. Run database migration
./scripts/db-migrate.sh production

# 5. Deploy to production
./scripts/deploy.sh
```

### Regular Updates

```bash
# Run deployment script (handles everything)
./scripts/deploy.sh

# Or use npm script
npm run deploy
```

### Database Schema Changes

```bash
# 1. Update db/schema.sql with changes

# 2. Test in development
./scripts/db-migrate.sh development

# 3. Deploy to production
./scripts/db-migrate.sh production
```

### Quick Deploy Without Tests

```bash
# Use with caution - tests are important!
./scripts/deploy.sh --skip-tests
```

---

## Script Features

### Color-Coded Output

- **Green (✓)** - Success messages
- **Red (✗)** - Error messages
- **Yellow (⚠)** - Warnings
- **Blue** - Section headers

### Safety Features

- **Environment validation** - Verifies required variables are set
- **Production warnings** - Extra prompts for production deployments
- **Backup reminders** - Reminds to backup database before migrations
- **Version checks** - Ensures correct Node.js version
- **Syntax validation** - Checks for errors before execution

### Exit Codes

- `0` - Success
- `1` - Error (missing dependencies, failed checks, user cancelled)
- `2` - Syntax error

---

## Troubleshooting

### "Vercel CLI not found"

```bash
npm install -g vercel
```

### "Project not linked to Vercel"

```bash
vercel link
```

### "DATABASE_URL environment variable not set"

Ensure .env file exists with DATABASE_URL, or export it:
```bash
export DATABASE_URL="postgres://user:password@host.neon.tech/dbname"
```

### "PostgreSQL client (psql) not found"

Install PostgreSQL:
```bash
# macOS
brew install postgresql

# Ubuntu/Debian
sudo apt-get install postgresql-client
```

Or use Neon SQL Editor as alternative.

### "Permission denied"

Make scripts executable:
```bash
chmod +x scripts/deploy.sh
chmod +x scripts/db-migrate.sh
```

### "Tests failing"

Fix test failures before deploying, or use:
```bash
./scripts/deploy.sh --skip-tests  # Not recommended
```

---

## Best Practices

1. **Always run database migrations before deploying code**
   ```bash
   ./scripts/db-migrate.sh production
   ./scripts/deploy.sh
   ```

2. **Test migrations in development first**
   ```bash
   ./scripts/db-migrate.sh development
   ```

3. **Review changes before production deployment**
   - Check git diff
   - Review PR changes
   - Verify tests pass

4. **Monitor deployments**
   ```bash
   vercel logs --prod --follow
   ```

5. **Use GitHub Actions for automated deployments**
   - Push to main branch triggers automatic deployment
   - See `.github/workflows/deploy.yml`

---

## Related Documentation

- [DEPLOYMENT.md](../DEPLOYMENT.md) - Full deployment guide
- [.github/DEPLOYMENT_CHECKLIST.md](../.github/DEPLOYMENT_CHECKLIST.md) - Quick checklist
- [.env.production.example](../.env.production.example) - Environment variables reference
- [db/schema.sql](../db/schema.sql) - Database schema

---

## Support

For issues with scripts:
1. Check script output for specific error messages
2. Review related documentation
3. Check Vercel/Neon dashboard for service status
4. Verify all prerequisites are installed
