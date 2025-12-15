# Development Guide

Comprehensive guide for developing, testing, building, and deploying the Splice UXP Plugin.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Building](#building)
- [Deployment](#deployment)
- [Debugging](#debugging)
- [Common Issues](#common-issues)

---

## Development Setup

### Prerequisites

1. **Node.js** 20.0.0 or later
   ```bash
   node --version  # Should be >= 20.0.0
   ```

2. **Adobe Premiere Pro** 25.6.0 or later
   - UXP plugins only work with compatible versions

3. **UXP Developer Tool** (UDT)
   ```bash
   # Install globally
   npm install -g @adobe/uxp-developer-tool-cli

   # Verify installation
   uxp --version
   ```

4. **Git** (for version control)
   ```bash
   git --version
   ```

### Initial Setup

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/splice.git
cd splice

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env

# Edit .env with your API keys
# Required for backend development:
# - DATABASE_URL (Neon Postgres)
# - JWT_SECRET (random string)
# - STRIPE_SECRET_KEY
# - OPENAI_API_KEY
# Optional:
# - ELEVENLABS_API_KEY
# - GEMINI_API_KEY
```

### Environment Variables

Create a `.env` file in the project root:

```env
# Database
DATABASE_URL=postgresql://username:password@host/database?sslmode=require

# Authentication
JWT_SECRET=your-random-secret-key-generate-with-openssl

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_STUDIO_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...

# OpenAI
OPENAI_API_KEY=sk-...

# Optional: ElevenLabs (voice isolation)
ELEVENLABS_API_KEY=...

# Optional: Gemini (alternative LLM)
GEMINI_API_KEY=...
```

**Generate JWT_SECRET:**
```bash
openssl rand -base64 32
```

### Database Setup

```bash
# 1. Create a Neon database at https://neon.tech
# 2. Copy connection string to DATABASE_URL
# 3. Run schema migration
psql $DATABASE_URL -f db/schema.sql

# Or using a GUI tool like pgAdmin, DBeaver, etc.
```

### UXP Setup

```bash
# 1. Start UXP service (one-time, runs in background)
uxp service start

# 2. Verify service is running
uxp service status

# Should output: "UXP Developer Tool service is running"
```

---

## Project Structure

```
splice/
├── api/                    # Backend (Vercel serverless functions)
│   ├── _lib/              # Shared backend utilities
│   │   ├── auth.ts        # JWT authentication
│   │   ├── db.ts          # Database queries
│   │   ├── stripe.ts      # Stripe integration
│   │   └── usage.ts       # Usage tracking
│   ├── ai/                # AI service endpoints
│   │   ├── transcribe.ts
│   │   ├── analyze-takes.ts
│   │   └── isolate-audio.ts
│   ├── auth/              # Authentication endpoints
│   ├── subscription/      # Subscription/usage endpoints
│   ├── stripe/            # Payment endpoints
│   └── health.ts          # Health check
├── db/
│   └── schema.sql         # Database schema
├── src/                   # Frontend (UXP plugin)
│   ├── api/               # API client wrappers
│   │   ├── backend-client.ts  # Backend API client
│   │   ├── premiere.ts        # Premiere Pro API wrapper
│   │   ├── whisper.ts
│   │   └── elevenlabs.ts
│   ├── components/        # UI components
│   │   └── App.ts
│   ├── config/            # Configuration
│   │   └── audio-config.ts
│   ├── lib/               # Frontend utilities
│   │   ├── errors.ts      # Error handling system
│   │   ├── logger.ts      # Logging
│   │   ├── storage.ts     # UXP storage wrapper
│   │   ├── secure-storage.ts
│   │   └── operation-lock.ts
│   ├── services/          # Business logic
│   │   ├── audio-extractor.ts
│   │   ├── audio-chunker.ts
│   │   ├── ame-exporter.ts
│   │   ├── silence-detector.ts
│   │   └── usage-tracker.ts
│   └── types/             # TypeScript types
│       └── index.d.ts
├── tests/                 # Test files
│   ├── setup.ts
│   ├── lib/
│   ├── services/
│   └── api/
├── dist/                  # Build output (gitignored)
├── .env                   # Environment variables (gitignored)
├── .env.example           # Example env file
├── index.html             # UXP entry point
├── manifest.json          # UXP plugin manifest
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
└── vercel.json            # Vercel deployment config
```

---

## Development Workflow

### 1. Frontend Development (UXP Plugin)

```bash
# Terminal 1: Start dev server (optional, for testing outside Premiere)
npm run dev

# Terminal 2: Build and watch for changes
npm run build -- --watch

# Terminal 3: Load plugin in Premiere Pro
npm run uxp:load

# Auto-reload on changes
npm run uxp:watch

# Or manually reload
npm run uxp:reload
```

**Development Tips:**

- **Hot Reload**: Use `uxp:watch` for automatic reloading
- **Console Logs**: View in UXP Developer Tool console
- **Debugger**: Use Chrome DevTools (click "Debug" in UDT)

### 2. Backend Development (Vercel Functions)

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Run local development server
vercel dev

# API endpoints available at:
# http://localhost:3000/api/auth/login
# http://localhost:3000/api/ai/transcribe
# etc.
```

**Testing Backend Locally:**

```bash
# Use curl or Postman
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

### 3. Full-Stack Development

```bash
# Terminal 1: Backend
vercel dev

# Terminal 2: Frontend build
npm run build -- --watch

# Terminal 3: UXP watch
npm run uxp:watch

# Update backend URL in frontend for local testing
# src/api/backend-client.ts
const API_BASE_URL = 'http://localhost:3000/api';
```

---

## Testing

### Unit Tests (Vitest)

```bash
# Run all tests
npm test

# Run tests in watch mode (recommended during development)
npm run test

# Run tests once (CI/CD)
npm run test:run

# Run specific test file
npm test -- audio-chunker.test.ts

# Run with coverage
npm test -- --coverage
```

### Test Structure

```typescript
// Example test file: tests/services/audio-chunker.test.ts
import { describe, it, expect } from 'vitest';
import { audioChunker } from '@/services/audio-chunker';
import { createMockWavBuffer } from '../utils/wav-builder';

describe('AudioChunker', () => {
  it('should detect if chunking is needed', () => {
    const smallBuffer = new ArrayBuffer(1024); // 1KB
    expect(audioChunker.needsChunking(smallBuffer)).toBe(false);

    const largeBuffer = new ArrayBuffer(30 * 1024 * 1024); // 30MB
    expect(audioChunker.needsChunking(largeBuffer)).toBe(true);
  });

  it('should chunk large WAV files correctly', async () => {
    const wavBuffer = createMockWavBuffer(600); // 10 min WAV
    const chunks = await audioChunker.chunkWavBuffer(wavBuffer, 600);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].startTime).toBe(0);
    expect(chunks[chunks.length - 1].endTime).toBe(600);
  });
});
```

### Integration Tests

```bash
# Test against local backend
npm run test:integration

# Requires:
# - Local Vercel dev server running
# - Database populated with test data
```

### Manual Testing Checklist

- [ ] Login/Register flow
- [ ] Subscription upgrade (use Stripe test cards)
- [ ] Audio extraction from timeline
- [ ] Transcription with word timestamps
- [ ] Silence detection (with and without AI)
- [ ] Take detection
- [ ] Usage tracking updates correctly
- [ ] Error messages display properly
- [ ] Plugin reload preserves state

---

## Building

### Frontend (UXP Plugin)

```bash
# Development build
npm run build

# Production build (minified)
npm run build -- --mode production

# Output: dist/
# ├── index.html
# ├── main.js
# ├── main.css
# └── manifest.json
```

### Type Checking

```bash
# Check types without building
npm run typecheck

# Fix auto-fixable type errors
npm run typecheck -- --noEmit false
```

### Linting & Formatting

```bash
# Lint code
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Format with Prettier
npm run format
```

### Pre-commit Hooks

Husky runs these checks before each commit:

```bash
# Automatically runs on `git commit`:
1. ESLint on staged files
2. Prettier on staged files
3. Type checking

# Skip hooks (not recommended)
git commit --no-verify
```

---

## Deployment

### Backend (Vercel)

#### Initial Setup

```bash
# Link project to Vercel
vercel link

# Set environment variables in Vercel dashboard
# Or via CLI:
vercel env add DATABASE_URL
vercel env add JWT_SECRET
vercel env add STRIPE_SECRET_KEY
# ... etc
```

#### Deploy

```bash
# Deploy to preview (staging)
vercel

# Deploy to production
vercel --prod

# Or use Git integration:
# - Push to `main` branch → auto-deploy to production
# - Push to feature branch → auto-deploy preview
```

#### Post-Deployment

```bash
# Check deployment status
vercel ls

# View logs
vercel logs

# Run health check
curl https://your-app.vercel.app/api/health
```

### Frontend (UXP Plugin)

#### Package Plugin

```bash
# Create .ccx package for distribution
npm run uxp:package

# Output: release/Splice.ccx

# Check package contents
unzip -l release/Splice.ccx
```

#### Adobe Exchange Submission

1. **Prepare Assets**
   - Plugin icon (48x48, 96x96)
   - Screenshots (1280x800)
   - Description and feature list

2. **Test Package**
   ```bash
   # Install .ccx file in Premiere Pro
   # Window > Extensions > Manage Extensions > Install
   ```

3. **Submit to Adobe Exchange**
   - Visit [Adobe Exchange Partner Portal](https://partners.adobe.com/)
   - Upload .ccx file
   - Fill out metadata
   - Submit for review

#### Direct Distribution

```bash
# Host .ccx file on your server
# Users download and install manually

# Or use Adobe's update mechanism
# Update manifest.json with new version
# Push update to Exchange
```

---

## Debugging

### Frontend (UXP Plugin)

#### Chrome DevTools

1. Open UXP Developer Tool
2. Find "Splice" in plugin list
3. Click "Debug" button
4. Chrome DevTools window opens

**Features:**
- Console logs
- Breakpoints
- Network requests
- DOM inspection

#### UXP Logging

```typescript
import { logger } from '@/lib/logger';

// Logs appear in UDT console and browser DevTools
logger.info('User clicked silence detection');
logger.warn('Audio duration exceeds recommended limit', { duration: 7200 });
logger.error('Failed to extract audio', error);
```

#### Common Frontend Issues

**Issue: "Premiere API not available"**
```typescript
// Check if running in Premiere Pro
if (typeof require === 'undefined') {
  console.warn('Not running in UXP environment');
}
```

**Issue: "Permission denied for file access"**
```json
// manifest.json must include:
{
  "requiredPermissions": {
    "localFileSystem": "fullAccess"
  }
}
```

### Backend (Vercel Functions)

#### Local Debugging

```bash
# Run with verbose logging
vercel dev --debug

# View function logs in real-time
vercel logs --follow

# Test specific endpoint
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}' \
  -v
```

#### Production Debugging

```bash
# View recent logs
vercel logs

# View logs for specific deployment
vercel logs --url https://splice-git-main.vercel.app

# Filter by function
vercel logs --since 1h | grep "api/ai/transcribe"
```

#### Database Debugging

```bash
# Connect to Neon database
psql $DATABASE_URL

# Check subscription status
SELECT * FROM subscriptions WHERE user_id = '...';

# Check usage records
SELECT * FROM usage_records
WHERE user_id = '...'
ORDER BY created_at DESC
LIMIT 10;

# Reset usage for testing
UPDATE subscriptions
SET minutes_used = 0
WHERE user_id = '...';
```

---

## Common Issues

### Issue: Build Fails with TypeScript Errors

**Solution:**
```bash
# Clear cache and rebuild
rm -rf node_modules dist
npm install
npm run typecheck
npm run build
```

### Issue: UXP Plugin Won't Load

**Symptoms:** Plugin not appearing in Premiere Pro

**Solutions:**
1. Check Premiere Pro version (must be >= 25.6.0)
2. Verify manifest.json is valid JSON
3. Ensure UXP service is running: `uxp service status`
4. Try reloading: `npm run uxp:reload`
5. Check UDT console for errors

### Issue: Database Connection Failed

**Symptoms:** "Connection timeout" or "Connection refused"

**Solutions:**
```bash
# 1. Verify DATABASE_URL is correct
echo $DATABASE_URL

# 2. Test connection
psql $DATABASE_URL -c "SELECT 1"

# 3. Check Neon dashboard for database status

# 4. Verify SSL mode is enabled
# DATABASE_URL must include: ?sslmode=require
```

### Issue: Stripe Webhook Not Working

**Symptoms:** Subscriptions not updating after payment

**Solutions:**
1. Verify webhook secret in .env matches Stripe dashboard
2. Test webhook locally with Stripe CLI:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
3. Check webhook signature verification in code
4. View webhook logs in Stripe dashboard

### Issue: Audio Extraction Fails

**Symptoms:** "AME_EXPORT_FAILED" or "AUDIO_EXTRACTION_FAILED"

**Solutions:**
1. Check sequence has audio tracks
2. Verify Adobe Media Encoder is installed
3. Try fallback extraction (reads source files directly)
4. Check timeline duration (must be < 2 hours)
5. Ensure disk space available for temp files

### Issue: Transcription API Error

**Symptoms:** "Transcription failed" or 429 rate limit

**Solutions:**
```bash
# 1. Verify OpenAI API key
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# 2. Check file size (must be < 25MB)
# Use audio chunking if needed

# 3. Verify audio format (WAV, PCM)

# 4. Check API quota in OpenAI dashboard
```

### Issue: Tests Failing

**Symptoms:** Tests pass locally but fail in CI

**Solutions:**
1. Ensure Node.js version matches (check `.nvmrc` or `package.json`)
2. Clear test cache: `npx vitest --clearCache`
3. Check environment variables in CI config
4. Run tests with same flags as CI: `npm run test:run`

---

## Performance Optimization

### Frontend

**Bundle Size:**
```bash
# Analyze bundle
npm run build -- --mode production
# Check dist/main.js size

# Use dynamic imports for large dependencies
const heavyModule = await import('./heavy-module');
```

**Memory Management:**
```typescript
// Release large buffers when done
let audioBuffer = await extractAudio();
// ... process buffer ...
audioBuffer = null; // Allow GC
```

### Backend

**Cold Start Optimization:**
```typescript
// Keep imports minimal
// Bad:
import _ from 'lodash';

// Good:
import debounce from 'lodash/debounce';
```

**Database Connection Pooling:**
```typescript
// Use Neon's serverless driver
import { neon } from '@neondatabase/serverless';

// Connections are automatically pooled
const sql = neon(process.env.DATABASE_URL);
```

---

## CI/CD Pipeline

### GitHub Actions (Example)

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:run
```

### Vercel Integration

```yaml
# Auto-deploy on push
# - main branch → production
# - other branches → preview

# Configure in vercel.json:
{
  "git": {
    "deploymentEnabled": {
      "main": true
    }
  }
}
```

---

## Best Practices

### Code Style

1. **Use TypeScript strict mode**
   ```json
   // tsconfig.json
   {
     "compilerOptions": {
       "strict": true
     }
   }
   ```

2. **Prefer async/await over callbacks**
   ```typescript
   // Good
   const result = await apiCall();

   // Avoid
   apiCall().then(result => { ... });
   ```

3. **Use SpliceError for all errors**
   ```typescript
   // Good
   throw new SpliceError(
     SpliceErrorCode.AUDIO_NO_SEQUENCE,
     'No active sequence'
   );

   // Avoid
   throw new Error('No sequence');
   ```

4. **Log important operations**
   ```typescript
   logger.info('Starting audio extraction', { duration });
   logger.error('Extraction failed', error);
   ```

### Git Workflow

```bash
# 1. Create feature branch
git checkout -b feature/silence-detection-v2

# 2. Make changes
# ... edit files ...

# 3. Commit (husky runs checks)
git add .
git commit -m "Improve silence detection algorithm"

# 4. Push and create PR
git push origin feature/silence-detection-v2

# 5. After review and approval, merge to main
```

### Version Management

```json
// package.json - Follow semver
{
  "version": "1.2.3"
  //         ^ ^ ^
  //         | | patch (bug fixes)
  //         | minor (new features, backward compatible)
  //         major (breaking changes)
}
```

---

## Resources

### Documentation
- [Adobe UXP Documentation](https://developer.adobe.com/udt/)
- [Premiere Pro API Reference](https://ppro-scripting.docsforadobe.dev/)
- [Vercel Functions Docs](https://vercel.com/docs/functions)
- [Vitest Documentation](https://vitest.dev/)

### Tools
- [UXP Developer Tool](https://developer.adobe.com/udt/download/)
- [Vercel CLI](https://vercel.com/docs/cli)
- [Stripe CLI](https://stripe.com/docs/stripe-cli)

### Community
- [Adobe UXP Forum](https://forums.creativeclouddeveloper.com/)
- [Splice GitHub Discussions](https://github.com/yourusername/splice/discussions)

---

## Getting Help

1. **Check documentation** (this file, API.md, ARCHITECTURE.md)
2. **Search existing issues** on GitHub
3. **Create new issue** with:
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots/logs
   - Environment details (Premiere version, OS, etc.)
4. **Join discussions** for general questions

---

## Contributing

See [Contributing Guidelines](../CONTRIBUTING.md) for:
- Code review process
- Branch naming conventions
- Commit message format
- Pull request template
