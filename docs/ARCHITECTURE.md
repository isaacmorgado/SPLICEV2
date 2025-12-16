# Architecture Documentation

System architecture, data flow, and design decisions for the Splice UXP Plugin.

## Table of Contents

- [System Overview](#system-overview)
- [Architecture Diagram](#architecture-diagram)
- [Component Architecture](#component-architecture)
- [Data Flow](#data-flow)
- [Database Schema](#database-schema)
- [Error Handling System](#error-handling-system)
- [Security Architecture](#security-architecture)
- [Performance Considerations](#performance-considerations)

---

## System Overview

Splice is a hybrid application consisting of:

1. **UXP Plugin** (Frontend) - Runs inside Adobe Premiere Pro
2. **Vercel Serverless Functions** (Backend) - Handles AI processing, auth, and billing
3. **Neon Postgres** (Database) - Stores users, subscriptions, and usage data
4. **Third-party APIs**:
   - **AI**: Groq Whisper (primary), OpenAI Whisper (fallback), GPT-4o-mini, Gemini Flash
   - **Voice Isolation**: Modal + Demucs (primary), ElevenLabs (legacy)
   - **Payments**: Stripe
   - **Email**: SendGrid

### Key Design Principles

- **Serverless-first**: All backend logic runs on Vercel edge functions for scalability
- **Type-safe**: Full TypeScript coverage with strict mode enabled
- **Error-resilient**: Comprehensive error handling with typed error codes
- **Usage-aware**: Track and enforce subscription limits at every API call
- **UXP-constrained**: Work within Adobe's sandboxed UXP environment

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Adobe Premiere Pro                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   Splice UXP Plugin                        │  │
│  │                                                            │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │  │
│  │  │ UI Components│  │   Services   │  │  API Clients │   │  │
│  │  │  (Spectrum)  │  │              │  │              │   │  │
│  │  │              │  │ - Audio      │  │ - Backend    │   │  │
│  │  │ - Login      │  │   Extractor  │  │   Client     │   │  │
│  │  │ - Dashboard  │  │ - Chunker    │  │ - Premiere   │   │  │
│  │  │ - Features   │  │ - Silence    │  │   API        │   │  │
│  │  │              │  │   Detector   │  │              │   │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │  │
│  │         │                  │                  │           │  │
│  └─────────┼──────────────────┼──────────────────┼───────────┘  │
│            │                  │                  │              │
│            │                  │                  │              │
│            └──────────────────┴──────────────────┘              │
│                               │                                 │
└───────────────────────────────┼─────────────────────────────────┘
                                │
                                │ HTTPS/REST
                                │
            ┌───────────────────▼────────────────────┐
            │       Vercel Serverless Backend        │
            │                                         │
            │  ┌─────────────────────────────────┐   │
            │  │      API Routes (/api/*)        │   │
            │  │                                 │   │
            │  │  /auth/*     - Authentication  │   │
            │  │  /ai/*       - AI Services     │   │
            │  │  /subscription/* - Usage/Tiers │   │
            │  │  /stripe/*   - Payments        │   │
            │  │  /health     - Health Check    │   │
            │  └─────────────────────────────────┘   │
            │                 │                       │
            │  ┌──────────────┴──────────────┐       │
            │  │   Shared Libraries (_lib/)  │       │
            │  │                             │       │
            │  │  - auth.ts    - JWT Auth   │       │
            │  │  - db.ts      - Database   │       │
            │  │  - usage.ts   - Tracking   │       │
            │  │  - stripe.ts  - Payments   │       │
            │  └─────────────────────────────┘       │
            └──────────┬────────────┬─────────────────┘
                       │            │
         ┌─────────────┘            └─────────────┐
         │                                        │
         ▼                                        ▼
┌─────────────────┐                    ┌──────────────────┐
│  Neon Postgres  │                    │  External APIs   │
│                 │                    │                  │
│  - users        │                    │  - Groq Whisper  │
│  - subscriptions│                    │  - OpenAI        │
│  - usage_records│                    │  - Modal/Demucs  │
│  - referrals    │                    │  - ElevenLabs    │
│  - api_keys     │                    │  - Stripe        │
│  - audit_logs   │                    │  - SendGrid      │
└─────────────────┘                    └──────────────────┘
```

---

## Component Architecture

### Frontend (UXP Plugin)

```
src/
├── components/          # UI Layer
│   └── App.ts          # Main application component
├── services/           # Business Logic Layer
│   ├── audio-extractor.ts    # Extract audio from timeline
│   ├── audio-chunker.ts      # Split large files for API
│   ├── ame-exporter.ts       # Adobe Media Encoder wrapper
│   ├── silence-detector.ts   # Silence detection logic
│   └── usage-tracker.ts      # Client-side usage tracking
├── api/                # API Client Layer
│   ├── backend-client.ts     # Backend API wrapper
│   ├── premiere.ts           # Premiere Pro API wrapper
│   ├── whisper.ts            # Direct Whisper API (backup)
│   └── elevenlabs.ts         # Voice isolation API
├── lib/                # Utilities
│   ├── errors.ts             # Error system
│   ├── logger.ts             # Logging
│   ├── storage.ts            # UXP storage wrapper
│   ├── secure-storage.ts     # Encrypted storage for tokens
│   └── operation-lock.ts     # Prevent concurrent operations
└── config/
    └── audio-config.ts       # Audio processing constants
```

### Backend (Vercel Serverless)

```
api/
├── auth/
│   ├── register.ts           # POST /api/auth/register
│   ├── login.ts              # POST /api/auth/login
│   ├── refresh.ts            # POST /api/auth/refresh
│   ├── verify.ts             # POST /api/auth/verify
│   ├── request-reset.ts      # POST /api/auth/request-reset
│   └── reset-password.ts     # POST /api/auth/reset-password
├── ai/
│   ├── transcribe.ts         # POST /api/ai/transcribe
│   ├── analyze-takes.ts      # POST /api/ai/analyze-takes
│   └── isolate-audio.ts      # POST /api/ai/isolate-audio
├── subscription/
│   ├── status.ts             # GET /api/subscription/status
│   ├── usage.ts              # GET/POST /api/subscription/usage
│   └── tiers.ts              # GET /api/subscription/tiers
├── stripe/
│   ├── create-checkout.ts    # POST /api/stripe/create-checkout
│   ├── create-portal.ts      # POST /api/stripe/create-portal
│   ├── cancel-subscription.ts # POST /api/stripe/cancel-subscription
│   └── webhook.ts            # POST /api/stripe/webhook
├── user/
│   ├── profile.ts            # GET/PUT /api/user/profile
│   ├── api-keys.ts           # GET/POST/DELETE /api/user/api-keys
│   └── analytics.ts          # GET /api/user/analytics
├── referrals/
│   ├── generate.ts           # POST /api/referrals/generate
│   └── redeem.ts             # POST /api/referrals/redeem
├── cron/
│   ├── cleanup-database.ts   # Scheduled: Clean stale data
│   ├── expire-trials.ts      # Scheduled: Expire trial subscriptions
│   └── retry-failed-webhooks.ts # Scheduled: Retry failed Stripe webhooks
└── health.ts                 # GET /api/health

lib/                          # Shared backend utilities
├── auth.ts                   # JWT creation/verification
├── db.ts                     # Database queries & connection pool
├── usage.ts                  # Usage tracking/checking
├── stripe.ts                 # Stripe SDK wrapper
├── rate-limit.ts             # API rate limiting (sliding window)
├── referrals.ts              # Referral code generation & redemption
├── email.ts                  # SendGrid email service
├── api-keys.ts               # BYOK key encryption/storage
├── audit-log.ts              # Activity logging for security
├── middleware.ts             # Request validation & auth middleware
├── password-reset.ts         # Password reset token management
├── cancellation.ts           # Subscription cancellation logic
├── groq.ts                   # Groq Whisper API client
└── voice-isolation.ts        # Voice isolation (Modal/ElevenLabs)
```

---

## Data Flow

### 1. Silence Detection Workflow

```
┌──────────────┐
│ User clicks  │
│ "Find Silence"│
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Frontend: Audio Extraction                           │
│                                                      │
│ 1. Get active sequence from Premiere Pro            │
│ 2. Validate timeline duration (< 2 hours)           │
│ 3. Try AME export (preferred)                       │
│    └─> Fallback: Read source files directly        │
│ 4. Result: WAV buffer + duration                    │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Frontend: Audio Chunking (if needed)                │
│                                                      │
│ 1. Check if buffer > 25MB (Whisper limit)           │
│ 2. If yes: Split into ~10min chunks                 │
│    - Parse WAV header                               │
│    - Create aligned chunks (prevent audio clicks)   │
│    - Generate new WAV headers per chunk             │
│ 3. Result: Array of chunks with timestamps          │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Backend: Transcription (/api/ai/transcribe)         │
│                                                      │
│ 1. Authenticate request (JWT)                       │
│ 2. Check usage limits (minutes remaining)           │
│ 3. Call OpenAI Whisper API                          │
│    - Send base64-encoded audio                      │
│    - Request word-level timestamps                  │
│ 4. Track usage in database                          │
│ 5. Return: { text, words[], duration }              │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Frontend: Merge Chunk Transcriptions (if chunked)   │
│                                                      │
│ 1. Adjust timestamps based on chunk offsets         │
│ 2. Concatenate word arrays                          │
│ 3. Result: Complete transcript with accurate times  │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Frontend: Silence Detection                         │
│                                                      │
│ 1. Find gaps between words (transcript.words[])     │
│    - Gap = word[i].end → word[i+1].start            │
│    - Filter: gaps > minDuration (default 300ms)     │
│ 2. Classify gaps with AI (optional)                 │
│    - Send to /api/ai/analyze-takes                  │
│    - LLM determines: natural pause vs cuttable      │
│    - Fallback: Heuristic (gaps > 1.5s = cuttable)   │
│ 3. Result: SilentSection[] with confidence scores   │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Frontend: Display & Apply                           │
│                                                      │
│ 1. Show results in UI table                         │
│    - Start/end time, duration, confidence           │
│ 2. User selects sections to remove                  │
│ 3. Apply to timeline via Premiere API               │
│    - Create markers or ripple delete                │
└──────────────────────────────────────────────────────┘
```

### 2. Take Detection Workflow

```
┌──────────────┐
│ User clicks  │
│ "Find Takes" │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Frontend: Audio Extraction & Transcription          │
│ (Same as Silence Detection steps 1-4)               │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Backend: Take Analysis (/api/ai/analyze-takes)      │
│                                                      │
│ 1. Authenticate request                             │
│ 2. Check usage limits                               │
│ 3. Send transcript to LLM (GPT-4 or Gemini)         │
│    Prompt: "Find repeated phrases (takes)"          │
│ 4. LLM identifies:                                   │
│    - Phrase groups (e.g., "hey guys welcome back")  │
│    - Individual takes with timestamps               │
│    - Confidence scores                              │
│ 5. Track usage                                      │
│ 6. Return: { takeGroups[], totalTakes }             │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Frontend: Display & Select                          │
│                                                      │
│ 1. Group takes by phrase                            │
│ 2. Show all takes for each phrase                   │
│ 3. User selects "best take" per group               │
│ 4. Apply to timeline:                               │
│    - Delete unused takes                            │
│    - Or add markers for manual review               │
└──────────────────────────────────────────────────────┘
```

### 3. Authentication Flow

```
┌──────────────┐
│ User enters  │
│ credentials  │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ POST /api/auth/login                                 │
│                                                      │
│ 1. Hash password with bcrypt                        │
│ 2. Query user from database                         │
│ 3. Verify password                                  │
│ 4. Create JWT tokens:                               │
│    - Access token (1 hour)                          │
│    - Refresh token (30 days)                        │
│ 5. Return tokens + user info                        │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Frontend: Store Tokens                              │
│                                                      │
│ 1. Store in UXP secure storage (encrypted)          │
│ 2. Set Authorization header for future requests     │
│    Authorization: Bearer {access-token}             │
└──────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Subsequent API Calls                                 │
│                                                      │
│ 1. Send with Authorization header                   │
│ 2. Backend: Verify JWT signature                    │
│ 3. Backend: Extract userId from payload             │
│ 4. Backend: Check subscription/usage                │
│ 5. Process request                                  │
└──────────────────────────────────────────────────────┘
       │
       │ (After 1 hour - access token expires)
       ▼
┌──────────────────────────────────────────────────────┐
│ POST /api/auth/refresh                               │
│                                                      │
│ 1. Send refresh token                               │
│ 2. Verify refresh token is valid                    │
│ 3. Create new access token                          │
│ 4. Return new token                                 │
│ 5. Frontend: Update stored token                    │
│ 6. Frontend: Retry failed request                   │
└──────────────────────────────────────────────────────┘
```

### 4. Subscription & Usage Flow

```
┌──────────────┐
│ User upgrades│
│ to Pro       │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ POST /api/stripe/create-checkout                     │
│                                                      │
│ 1. Get user's subscription from DB                  │
│ 2. Create/get Stripe customer                       │
│ 3. Create Stripe checkout session                   │
│ 4. Return checkout URL                              │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Stripe Checkout Page                                │
│ (User completes payment)                            │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ POST /api/stripe/webhook                             │
│                                                      │
│ 1. Verify webhook signature                         │
│ 2. Handle event:                                    │
│    - subscription.created                           │
│    - subscription.updated                           │
│    - invoice.payment_succeeded                      │
│ 3. Update database:                                 │
│    - Set tier = 'pro'                               │
│    - Reset minutes_used = 0                         │
│    - Set period_end = next billing date             │
└──────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ User Makes API Call (e.g., transcribe)              │
│                                                      │
│ 1. GET /api/subscription/status                     │
│    → Returns: { minutesRemaining: 120 }            │
│ 2. Estimate cost: 2 minutes for this audio         │
│ 3. If minutesRemaining >= 2: proceed               │
│ 4. POST /api/ai/transcribe                          │
│ 5. Backend:                                         │
│    - Process request                                │
│    - Create usage record in DB                      │
│    - Increment subscription.minutes_used += 2       │
│ 6. Return result + minutesUsed                      │
└──────────────────────────────────────────────────────┘
```

### 5. Referral System Flow

```
┌──────────────────┐
│ User generates   │
│ referral code    │
└──────┬───────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ POST /api/referrals/generate                         │
│                                                      │
│ 1. Authenticate request                             │
│ 2. Check if user already has a code                 │
│ 3. Generate unique 8-char code                      │
│ 4. Store in referrals table                         │
│ 5. Return referral code + stats                     │
└──────────────────────────────────────────────────────┘
       │
       │ (User shares code with friend)
       ▼
┌──────────────────────────────────────────────────────┐
│ Friend Signs Up                                      │
│                                                      │
│ 1. POST /api/auth/register with referral_code       │
│ 2. Create user account                              │
│ 3. POST /api/referrals/redeem                       │
│    - Validate referral code exists                  │
│    - Check code hasn't been used by this user       │
│    - Award bonus minutes to BOTH users              │
│    - Record redemption in referral_redemptions      │
│ 4. Both referrer and referee get bonus minutes      │
└──────────────────────────────────────────────────────┘
```

### 6. Rate Limiting System

```
┌──────────────────────────────────────────────────────┐
│ Rate Limiting (Sliding Window Algorithm)            │
├──────────────────────────────────────────────────────┤
│                                                      │
│ Limits by Tier:                                      │
│ - Free:   10 requests/minute, 100/hour              │
│ - Pro:    30 requests/minute, 500/hour              │
│ - Studio: 60 requests/minute, 1000/hour             │
│                                                      │
│ Per-Endpoint Limits:                                 │
│ - /api/ai/*: Lower limits (expensive operations)    │
│ - /api/auth/*: Strict limits (prevent brute force)  │
│ - /api/subscription/*: Higher limits (read-heavy)   │
│                                                      │
│ Implementation:                                      │
│ 1. Check request against user's window              │
│ 2. If limit exceeded: 429 Too Many Requests         │
│ 3. Include Retry-After header                       │
│ 4. Log excessive attempts for security monitoring   │
└──────────────────────────────────────────────────────┘
```

### 7. BYOK (Bring Your Own Keys) Flow

```
┌──────────────────┐
│ User adds their  │
│ own API key      │
└──────┬───────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ POST /api/user/api-keys                              │
│                                                      │
│ 1. Authenticate request                             │
│ 2. Validate key format (provider-specific)          │
│ 3. Encrypt key with AES-256-GCM                     │
│    - Uses API_KEY_ENCRYPTION_SECRET                 │
│    - Random IV per key                              │
│ 4. Store encrypted key in database                  │
│ 5. Return key metadata (last 4 chars, provider)     │
└──────────────────────────────────────────────────────┘
       │
       │ (User makes AI request)
       ▼
┌──────────────────────────────────────────────────────┐
│ AI Request with BYOK                                 │
│                                                      │
│ 1. Check if user has BYOK key for this service      │
│ 2. If yes:                                          │
│    - Decrypt user's key                             │
│    - Use their key for API call                     │
│    - Skip usage tracking (unlimited for BYOK)       │
│ 3. If no:                                           │
│    - Use platform API key                           │
│    - Track usage against subscription               │
└──────────────────────────────────────────────────────┘
```

---

## Database Schema

### Entity-Relationship Diagram

```
┌─────────────────────────┐
│ users                   │
├─────────────────────────┤
│ id (UUID, PK)           │
│ email (VARCHAR, UNIQUE) │
│ password_hash (VARCHAR) │
│ created_at (TIMESTAMP)  │
└────────┬────────────────┘
         │
         │ 1:1
         │
         ▼
┌─────────────────────────────────────┐
│ subscriptions                       │
├─────────────────────────────────────┤
│ id (UUID, PK)                       │
│ user_id (UUID, FK → users.id)       │
│ stripe_customer_id (VARCHAR)        │
│ stripe_subscription_id (VARCHAR)    │
│ tier (VARCHAR)  [free/pro/studio]   │
│ status (VARCHAR) [active/canceled]  │
│ minutes_used (INTEGER)              │
│ period_end (TIMESTAMP)              │
│ created_at (TIMESTAMP)              │
└────────┬────────────────────────────┘
         │
         │ 1:N
         │
         ▼
┌──────────────────────────────────────┐
│ usage_records                        │
├──────────────────────────────────────┤
│ id (UUID, PK)                        │
│ user_id (UUID, FK → users.id)        │
│ feature (VARCHAR)                    │
│   [voice_isolation/transcription/   │
│    take_analysis]                    │
│ minutes (DECIMAL)                    │
│ created_at (TIMESTAMP)               │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ referrals                            │
├──────────────────────────────────────┤
│ id (UUID, PK)                        │
│ user_id (UUID, FK → users.id)        │
│ code (VARCHAR, UNIQUE)               │
│ redemptions_count (INTEGER)          │
│ created_at (TIMESTAMP)               │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ referral_redemptions                 │
├──────────────────────────────────────┤
│ id (UUID, PK)                        │
│ referral_id (UUID, FK → referrals)   │
│ redeemed_by (UUID, FK → users.id)    │
│ bonus_minutes (INTEGER)              │
│ created_at (TIMESTAMP)               │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ user_api_keys                        │
├──────────────────────────────────────┤
│ id (UUID, PK)                        │
│ user_id (UUID, FK → users.id)        │
│ provider (VARCHAR)                   │
│   [openai/groq/elevenlabs/gemini]    │
│ encrypted_key (TEXT)                 │
│ key_hint (VARCHAR)  # last 4 chars   │
│ created_at (TIMESTAMP)               │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ audit_logs                           │
├──────────────────────────────────────┤
│ id (UUID, PK)                        │
│ user_id (UUID, FK → users.id)        │
│ action (VARCHAR)                     │
│ resource (VARCHAR)                   │
│ metadata (JSONB)                     │
│ ip_address (VARCHAR)                 │
│ created_at (TIMESTAMP)               │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ password_reset_tokens                │
├──────────────────────────────────────┤
│ id (UUID, PK)                        │
│ user_id (UUID, FK → users.id)        │
│ token_hash (VARCHAR)                 │
│ expires_at (TIMESTAMP)               │
│ used_at (TIMESTAMP, nullable)        │
│ created_at (TIMESTAMP)               │
└──────────────────────────────────────┘
```

### Key Relationships

- **users → subscriptions**: One-to-one (enforced by UNIQUE constraint)
- **users → usage_records**: One-to-many (audit trail)
- **users → referrals**: One-to-one (each user can have one referral code)
- **users → user_api_keys**: One-to-many (multiple BYOK keys per user)
- **users → audit_logs**: One-to-many (activity history)
- **users → password_reset_tokens**: One-to-many (multiple reset attempts)
- **referrals → referral_redemptions**: One-to-many (track who redeemed)
- **CASCADE DELETE**: When a user is deleted, all related records are also deleted

### Indexes

```sql
-- Fast lookups
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);

-- Stripe webhooks
CREATE INDEX idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX idx_subscriptions_stripe_subscription ON subscriptions(stripe_subscription_id);

-- Usage queries
CREATE INDEX idx_usage_records_user_id ON usage_records(user_id);
CREATE INDEX idx_usage_records_created_at ON usage_records(created_at);
CREATE INDEX idx_usage_records_user_date ON usage_records(user_id, created_at DESC);

-- Referral system
CREATE UNIQUE INDEX idx_referrals_code ON referrals(code);
CREATE INDEX idx_referrals_user_id ON referrals(user_id);
CREATE INDEX idx_referral_redemptions_referral ON referral_redemptions(referral_id);

-- BYOK keys
CREATE INDEX idx_user_api_keys_user ON user_api_keys(user_id);
CREATE UNIQUE INDEX idx_user_api_keys_user_provider ON user_api_keys(user_id, provider);

-- Audit logs
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- Password reset
CREATE INDEX idx_password_reset_user ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_expires ON password_reset_tokens(expires_at);
```

---

## Error Handling System

### Error Code Hierarchy

```
SpliceError (Base Class)
├── code: SpliceErrorCode
├── message: string (technical, for logs)
├── userMessage: string (friendly, for UI)
├── context?: Record<string, unknown>
└── timestamp: string

Error Code Categories:
├── AME_xxx   - Adobe Media Encoder (100-199)
├── AUD_xxx   - Audio Extraction (200-299)
├── CHK_xxx   - Audio Chunking (300-399)
├── PPR_xxx   - Premiere Pro API (400-499)
├── TRS_xxx   - Transcription (500-599)
├── SIL_xxx   - Silence Detection (600-699)
├── TKE_xxx   - Take Detection (700-799)
├── NET_xxx   - Network/API (800-899)
└── UNK_999   - Unknown
```

### Error Flow

```
1. Error Occurs
   └─> Service throws SpliceError with code

2. Caught in Higher Layer
   └─> Logged with error.toLogString()

3. Displayed to User
   └─> Show error.toDisplayString()
       Format: "{userMessage} ({code})"

4. Reported to Backend (Optional)
   └─> Send error.toJSON() for analytics
```

### Example Usage

```typescript
// Throwing an error
throw new SpliceError(
  SpliceErrorCode.AUDIO_NO_SEQUENCE,
  'No active sequence found in Premiere',
  { projectOpen: true, sequencesCount: 0 }
);

// Catching and wrapping unknown errors
try {
  await riskyOperation();
} catch (error) {
  throw wrapError(error, SpliceErrorCode.AUDIO_EXTRACTION_FAILED);
}

// Logging
logger.error(error.toLogString());
// Output: [AUD_201] No active sequence found | Context: {"projectOpen":true,"sequencesCount":0}

// Displaying to user
showErrorDialog(error.toDisplayString());
// Output: "No sequence is open. Please open a sequence in Premiere Pro. (AUD_201)"
```

---

## Security Architecture

### Authentication

```
┌──────────────────────┐
│ JWT-based Auth       │
├──────────────────────┤
│ - HS256 algorithm    │
│ - 1 hour expiry      │
│ - Refresh tokens     │
│   (30 days)          │
└──────────────────────┘
```

**Token Payload:**
```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "iat": 1234567890,
  "exp": 1234571490
}
```

**Storage:**
- UXP Secure Storage (encrypted at rest)
- Never stored in localStorage or cookies

### Password Security

```
Registration/Login Flow:
1. Client sends plaintext password (HTTPS only)
2. Server hashes with bcrypt (cost factor 12)
3. Store hash in database
4. Never store plaintext passwords
```

### API Security

**Request Validation:**
```typescript
// Every protected endpoint
export default async function handler(req, res) {
  // 1. Authenticate
  const payload = await authenticateRequest(req);
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 2. Validate input
  const { audioBase64 } = req.body;
  if (!audioBase64) {
    return res.status(400).json({ error: 'Audio data required' });
  }

  // 3. Check permissions/usage
  const hasMinutes = await hasEnoughMinutes(payload.userId, estimatedMinutes);
  if (!hasMinutes) {
    return res.status(402).json({ error: 'Insufficient minutes' });
  }

  // 4. Process request
}
```

**Headers:**
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

### Stripe Webhook Security

```typescript
// Verify webhook signature
const event = stripe.webhooks.constructEvent(
  req.body,
  req.headers['stripe-signature'],
  process.env.STRIPE_WEBHOOK_SECRET
);

// Prevents replay attacks and spoofing
```

---

## Performance Considerations

### Audio Chunking

**Problem:** Whisper API has a 25MB file limit.

**Solution:**
```
1. Check buffer size before sending
2. If > 25MB:
   - Split into ~10 minute chunks
   - Align to sample boundaries (prevent audio artifacts)
   - Process chunks in parallel (future optimization)
   - Merge transcription results with time offsets
```

**Memory Optimization:**
```typescript
// Use generator for large files
async *chunkWavBufferIterator(buffer, duration) {
  // Yield chunks one at a time
  // Avoids loading all chunks into memory
}
```

### Database Queries

**Optimized Usage Check:**
```sql
-- Single query to get subscription + usage
SELECT
  s.tier,
  s.minutes_used,
  s.period_end,
  t.monthly_minutes
FROM subscriptions s
JOIN tiers t ON s.tier = t.id
WHERE s.user_id = $1;
```

**Batch Usage Tracking:**
```sql
-- Insert usage record and update subscription in one transaction
BEGIN;
  INSERT INTO usage_records (user_id, feature, minutes) VALUES ($1, $2, $3);
  UPDATE subscriptions SET minutes_used = minutes_used + $3 WHERE user_id = $1;
COMMIT;
```

### Caching Strategy

**Static Data:**
```typescript
// Cache tier information (rarely changes)
const TIERS_CACHE_TTL = 3600; // 1 hour

// Cache user subscription status
const SUBSCRIPTION_CACHE_TTL = 300; // 5 minutes
```

**Invalidation:**
- Clear on subscription update (Stripe webhook)
- Clear on usage tracking
- Use Vercel Edge Cache for public endpoints

### Serverless Cold Starts

**Mitigation:**
```typescript
// Keep dependencies minimal
// Use Vercel's bundling optimizations
// Pre-warm functions with health checks

// Bad: Import entire library
import _ from 'lodash';

// Good: Import specific functions
import { debounce } from 'lodash/debounce';
```

---

## Future Architecture Improvements

### 1. Real-time Processing

```
Current: Batch processing (extract → upload → transcribe)
Future:  Streaming audio to backend during extraction
         WebSockets for progress updates
```

### 2. Distributed Processing

```
Current: Single serverless function per request
Future:  Queue-based architecture
         - Job queue (Redis/BullMQ)
         - Worker functions process in parallel
         - Retry failed jobs
```

### 3. Client-side ML

```
Current: All AI processing on backend
Future:  On-device models for basic features
         - Silence detection with WebAssembly
         - Reduce API costs for free tier
```

### 4. Enhanced Caching

```
Current: No caching of transcriptions
Future:  Cache common audio patterns
         - Hash audio chunks
         - Store results in Redis
         - Deduplicate processing
```

---

## Technology Choices Rationale

### Why UXP?
- **Native integration** with Premiere Pro
- **Spectrum components** match Adobe UI
- **Sandboxed security** protects user projects

### Why Vercel Serverless?
- **Auto-scaling** handles variable load
- **Edge functions** reduce latency globally
- **Zero DevOps** - focus on features, not infrastructure
- **Cron jobs** - scheduled tasks without infrastructure

### Why Neon Postgres?
- **Serverless** - pay per use
- **Postgres compatibility** - full SQL features
- **Connection pooling** - handles serverless constraints

### Why TypeScript?
- **Type safety** prevents runtime errors
- **Better IDE support** for large codebase
- **Shared types** between frontend/backend

### Why Stripe?
- **Industry standard** for SaaS billing
- **Robust webhooks** for subscription events
- **Customer portal** - self-service management

### Why Groq for Transcription?
- **67% cheaper** than OpenAI Whisper
- **Faster inference** with dedicated hardware
- **Same Whisper model** - identical accuracy

### Why Modal + Demucs for Voice Isolation?
- **97% cheaper** than ElevenLabs
- **Open-source model** (Demucs by Meta)
- **Better quality** for music/noise separation
- **Scalable GPU** infrastructure

### Why SendGrid for Email?
- **Reliable delivery** for transactional emails
- **Easy integration** with Vercel
- **Detailed analytics** for delivery tracking

---

## Deployment Architecture

### Production Environment

```
Frontend (UXP Plugin):
- Built with Vite
- Packaged as .ccx file
- Distributed via Adobe Exchange

Backend (Vercel):
- Git-based deployment
- Preview deployments for PRs
- Production domain: api.splice.app

Database (Neon):
- Primary region: us-east-1
- Automatic backups
- Point-in-time recovery
```

### Environment Variables

```
Development:  .env.local (gitignored)
Staging:      Vercel environment (splice-staging)
Production:   Vercel environment (splice-production)
```

### Monitoring

```
Logs:        Vercel Analytics + Custom logger
Errors:      Sentry (future)
Performance: Vercel Speed Insights
Uptime:      /api/health endpoint
```

---

## Conclusion

The Splice architecture is designed for:
- **Scalability** - Serverless handles variable load
- **Reliability** - Comprehensive error handling
- **Performance** - Optimized for large audio files
- **Security** - JWT auth, encrypted storage, webhook verification
- **Maintainability** - TypeScript, clear separation of concerns

For implementation details, see:
- [API Documentation](API.md)
- [Development Guide](DEVELOPMENT.md)
