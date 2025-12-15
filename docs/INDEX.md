# Splice Documentation Index

Welcome to the Splice documentation! This index will help you find what you need quickly.

## Documentation Overview

| Document | Purpose | Audience |
|----------|---------|----------|
| [README.md](../README.md) | Project overview, quick start, installation | Everyone |
| [API.md](API.md) | Backend API reference and examples | Frontend/Backend developers |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, data flow, technical decisions | Developers, architects |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Setup, testing, building, deployment | Developers |

---

## Quick Navigation

### I want to...

**Get started with development**
→ Start with [DEVELOPMENT.md - Development Setup](DEVELOPMENT.md#development-setup)

**Understand how the system works**
→ Read [ARCHITECTURE.md - System Overview](ARCHITECTURE.md#system-overview)

**Integrate with the API**
→ Check [API.md - Table of Contents](API.md#table-of-contents)

**Learn about features**
→ See [README.md - Features](../README.md#features)

**Deploy to production**
→ Follow [DEVELOPMENT.md - Deployment](DEVELOPMENT.md#deployment)

**Troubleshoot issues**
→ Check [DEVELOPMENT.md - Common Issues](DEVELOPMENT.md#common-issues)

**Understand error codes**
→ Review [ARCHITECTURE.md - Error Handling](ARCHITECTURE.md#error-handling-system)

---

## Key Topics by Role

### For New Developers

1. Read [README.md](../README.md) - Get project context
2. Follow [DEVELOPMENT.md - Initial Setup](DEVELOPMENT.md#initial-setup)
3. Review [ARCHITECTURE.md - Component Architecture](ARCHITECTURE.md#component-architecture)
4. Start with [DEVELOPMENT.md - Development Workflow](DEVELOPMENT.md#development-workflow)

### For Frontend Developers (UXP Plugin)

**Essential Reading:**
- [ARCHITECTURE.md - Component Architecture](ARCHITECTURE.md#component-architecture)
- [DEVELOPMENT.md - Frontend Development](DEVELOPMENT.md#1-frontend-development-uxp-plugin)
- [ARCHITECTURE.md - Data Flow](ARCHITECTURE.md#data-flow)

**Key Files to Understand:**
```
src/services/audio-extractor.ts    - Audio extraction from timeline
src/services/audio-chunker.ts      - Large file handling
src/services/silence-detector.ts   - Silence detection logic
src/api/backend-client.ts          - API integration
```

### For Backend Developers (Vercel Functions)

**Essential Reading:**
- [API.md - Complete Reference](API.md)
- [DEVELOPMENT.md - Backend Development](DEVELOPMENT.md#2-backend-development-vercel-functions)
- [ARCHITECTURE.md - Database Schema](ARCHITECTURE.md#database-schema)

**Key Files to Understand:**
```
api/_lib/auth.ts       - JWT authentication
api/_lib/usage.ts      - Usage tracking system
api/_lib/db.ts         - Database queries
api/ai/transcribe.ts   - Main AI service
```

### For DevOps/Deployment

**Essential Reading:**
- [DEVELOPMENT.md - Deployment](DEVELOPMENT.md#deployment)
- [ARCHITECTURE.md - Deployment Architecture](ARCHITECTURE.md#deployment-architecture)
- [API.md - Webhooks](API.md#webhooks)

**Configuration Files:**
```
vercel.json            - Vercel deployment config
manifest.json          - UXP plugin manifest
db/schema.sql          - Database schema
.env.example           - Environment variables
```

---

## Feature Documentation

### Silence Detection
- **Overview**: [README.md - Features](../README.md#core-capabilities)
- **Architecture**: [ARCHITECTURE.md - Silence Detection Workflow](ARCHITECTURE.md#1-silence-detection-workflow)
- **Implementation**: `src/services/silence-detector.ts`
- **API**: [API.md - POST /api/ai/transcribe](API.md#post-apiai-transcribe)

### Take Detection
- **Overview**: [README.md - Features](../README.md#core-capabilities)
- **Architecture**: [ARCHITECTURE.md - Take Detection Workflow](ARCHITECTURE.md#2-take-detection-workflow)
- **API**: [API.md - POST /api/ai/analyze-takes](API.md#post-apiai-analyze-takes)

### Audio Chunking
- **Why**: Handle files > 25MB (Whisper API limit)
- **Architecture**: [ARCHITECTURE.md - Audio Chunking](ARCHITECTURE.md#audio-chunking)
- **Implementation**: `src/services/audio-chunker.ts`
- **Tests**: `tests/services/audio-chunker.test.ts`

### Subscription System
- **Overview**: [README.md - Subscription Tiers](../README.md#subscription-tiers)
- **Architecture**: [ARCHITECTURE.md - Subscription Flow](ARCHITECTURE.md#4-subscription--usage-flow)
- **API**: [API.md - Subscription Management](API.md#subscription-management)
- **Database**: [ARCHITECTURE.md - Database Schema](ARCHITECTURE.md#database-schema)

### Error Handling
- **System**: [ARCHITECTURE.md - Error Handling](ARCHITECTURE.md#error-handling-system)
- **Error Codes**: `src/lib/errors.ts`
- **Usage**: [README.md - Error Handling](../README.md#error-handling)

---

## API Endpoints Quick Reference

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Sign in
- `POST /api/auth/refresh` - Refresh token
- `POST /api/auth/verify` - Verify token

### AI Services
- `POST /api/ai/transcribe` - Transcribe audio with timestamps
- `POST /api/ai/analyze-takes` - Detect repeated takes
- `POST /api/ai/isolate-audio` - Voice isolation (optional)

### Subscription
- `GET /api/subscription/status` - Get current usage
- `GET /api/subscription/usage` - Usage history
- `GET /api/subscription/tiers` - Available plans (public)

### Stripe
- `POST /api/stripe/create-checkout` - Start upgrade
- `POST /api/stripe/create-portal` - Manage subscription
- `POST /api/stripe/webhook` - Handle Stripe events

### System
- `GET /api/health` - Health check

[Full API documentation →](API.md)

---

## Error Code Reference

Quick lookup for common error codes:

| Code | Category | Description |
|------|----------|-------------|
| AME_101 | Export | Media Encoder not available |
| AUD_201 | Audio | No sequence open |
| AUD_206 | Audio | Timeline too long (> 2 hours) |
| CHK_301 | Chunking | Invalid WAV file |
| PPR_401 | Premiere | Premiere API not available |
| TRS_501 | Transcription | Transcription failed |
| NET_801 | Network | Network connection failed |

[Complete error code list →](ARCHITECTURE.md#error-code-hierarchy)

---

## Development Commands Quick Reference

```bash
# Setup
npm install
cp .env.example .env
uxp service start

# Development
npm run dev                  # Dev server
npm run build -- --watch     # Watch build
npm run uxp:watch           # Auto-reload in Premiere

# Testing
npm test                    # Run tests (watch mode)
npm run test:run            # Run tests once
npm run typecheck           # Type check
npm run lint                # Lint code

# Deployment
vercel --prod               # Deploy backend
npm run uxp:package         # Package plugin
```

[Full development guide →](DEVELOPMENT.md)

---

## Data Flow Diagrams

### Silence Detection
```
Timeline → Audio Extract → Chunk (if needed) → Transcribe →
Find Gaps → AI Classify → Display → Apply to Timeline
```
[Detailed diagram →](ARCHITECTURE.md#1-silence-detection-workflow)

### Authentication
```
Login → JWT Token → Store Securely → Include in Requests →
Verify on Backend → Refresh when Expired
```
[Detailed diagram →](ARCHITECTURE.md#3-authentication-flow)

### Subscription
```
User Upgrades → Stripe Checkout → Payment → Webhook →
Update Database → Track Usage → Enforce Limits
```
[Detailed diagram →](ARCHITECTURE.md#4-subscription--usage-flow)

---

## External Resources

### Adobe
- [UXP Documentation](https://developer.adobe.com/udt/)
- [Premiere Pro Scripting](https://ppro-scripting.docsforadobe.dev/)
- [Adobe Exchange](https://exchange.adobe.com/)

### APIs
- [OpenAI Whisper](https://platform.openai.com/docs/guides/speech-to-text)
- [Stripe Documentation](https://stripe.com/docs/api)
- [Vercel Functions](https://vercel.com/docs/functions)

### Tools
- [Neon Postgres](https://neon.tech/docs)
- [Vitest](https://vitest.dev/)
- [TypeScript](https://www.typescriptlang.org/docs/)

---

## Getting Help

1. **Documentation** - Search this documentation first
2. **GitHub Issues** - Check existing issues and discussions
3. **Create Issue** - For bugs or feature requests
4. **Discussions** - For questions and community support

---

## Document Change Log

| Date | Document | Changes |
|------|----------|---------|
| 2024-12-15 | All | Initial comprehensive documentation created |

---

**Last Updated**: December 15, 2024
**Documentation Version**: 1.0.0
**Splice Version**: 1.0.0
