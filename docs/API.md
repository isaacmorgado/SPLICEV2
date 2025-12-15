# API Documentation

Complete reference for Splice backend API endpoints.

**Base URL**: `https://your-vercel-deployment.vercel.app/api`

All endpoints require authentication unless otherwise noted.

## Table of Contents

- [Authentication](#authentication)
- [Subscription Management](#subscription-management)
- [AI Services](#ai-services)
- [Payment (Stripe)](#payment-stripe)
- [Health & Status](#health--status)
- [Error Handling](#error-handling)

---

## Authentication

### POST /api/auth/register

Create a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "secure-password"
}
```

**Response (200):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  },
  "token": "jwt-access-token",
  "refreshToken": "jwt-refresh-token",
  "expiresAt": "2024-01-01T00:00:00.000Z"
}
```

**Errors:**
- `400` - Invalid email or password
- `409` - Email already exists

---

### POST /api/auth/login

Authenticate an existing user.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "secure-password"
}
```

**Response (200):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  },
  "token": "jwt-access-token",
  "refreshToken": "jwt-refresh-token",
  "expiresAt": "2024-01-01T00:00:00.000Z"
}
```

**Errors:**
- `400` - Invalid email or password
- `401` - Incorrect credentials

---

### POST /api/auth/refresh

Refresh an expired access token using a refresh token.

**Request Body:**
```json
{
  "refreshToken": "jwt-refresh-token"
}
```

**Response (200):**
```json
{
  "success": true,
  "token": "new-jwt-access-token",
  "expiresAt": "2024-01-01T00:00:00.000Z"
}
```

**Errors:**
- `400` - Refresh token required
- `401` - Invalid or expired refresh token

---

### POST /api/auth/verify

Verify a JWT access token is valid.

**Headers:**
```
Authorization: Bearer {access-token}
```

**Response (200):**
```json
{
  "valid": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  }
}
```

**Errors:**
- `401` - Invalid or expired token

---

## Subscription Management

### GET /api/subscription/status

Get current subscription status and usage.

**Headers:**
```
Authorization: Bearer {access-token}
```

**Response (200):**
```json
{
  "tier": "pro",
  "status": "active",
  "minutesUsed": 45,
  "minutesLimit": 120,
  "minutesRemaining": 75,
  "periodEnd": "2024-02-01T00:00:00.000Z",
  "stripeCustomerId": "cus_xxx",
  "stripeSubscriptionId": "sub_xxx"
}
```

**Errors:**
- `401` - Unauthorized
- `404` - No subscription found

---

### GET /api/subscription/usage

Get detailed usage history.

**Headers:**
```
Authorization: Bearer {access-token}
```

**Query Parameters:**
- `limit` (optional): Max records to return (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Response (200):**
```json
{
  "usage": [
    {
      "id": "uuid",
      "feature": "transcription",
      "minutes": 2.5,
      "createdAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "id": "uuid",
      "feature": "voice_isolation",
      "minutes": 5.0,
      "createdAt": "2024-01-14T14:20:00.000Z"
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

**Errors:**
- `401` - Unauthorized

---

### GET /api/subscription/tiers

Get available subscription tiers (public endpoint).

**Response (200):**
```json
{
  "tiers": [
    {
      "id": "free",
      "name": "Free",
      "monthlyMinutes": 10,
      "priceMonthly": 0,
      "priceFormatted": "Free",
      "features": [
        "Voice isolation for cleaner analysis",
        "AI-powered transcription",
        "Smart silence detection",
        "Take detection & labeling",
        "10 minutes/month"
      ]
    },
    {
      "id": "pro",
      "name": "Pro",
      "monthlyMinutes": 120,
      "priceMonthly": 1499,
      "priceFormatted": "$14.99/mo",
      "features": [
        "Voice isolation for cleaner analysis",
        "AI-powered transcription",
        "Smart silence detection",
        "Take detection & labeling",
        "120 minutes/month",
        "Priority processing",
        "Email support"
      ]
    },
    {
      "id": "studio",
      "name": "Studio",
      "monthlyMinutes": 500,
      "priceMonthly": 3999,
      "priceFormatted": "$39.99/mo",
      "features": [
        "Voice isolation for cleaner analysis",
        "AI-powered transcription",
        "Smart silence detection",
        "Take detection & labeling",
        "500 minutes/month",
        "Priority processing",
        "Priority support",
        "Early access to new features"
      ]
    }
  ]
}
```

---

## AI Services

### POST /api/ai/transcribe

Transcribe audio with word-level timestamps using OpenAI Whisper.

**Headers:**
```
Authorization: Bearer {access-token}
```

**Request Body:**
```json
{
  "audioBase64": "base64-encoded-wav-data",
  "durationSeconds": 120,
  "language": "en",
  "userApiKey": "sk-optional-user-key"
}
```

**Fields:**
- `audioBase64` (required): Base64-encoded WAV audio data
- `durationSeconds` (optional): Audio duration for usage tracking
- `language` (optional): ISO language code (e.g., "en", "es", "fr")
- `userApiKey` (optional): User's own OpenAI API key (bypasses usage tracking)

**Response (200):**
```json
{
  "success": true,
  "transcription": {
    "text": "Hello world, this is a test.",
    "words": [
      {
        "word": "Hello",
        "start": 0.0,
        "end": 0.5
      },
      {
        "word": "world",
        "start": 0.5,
        "end": 1.0
      }
    ],
    "duration": 120
  },
  "minutesUsed": 1.0
}
```

**Errors:**
- `400` - Audio data required
- `401` - Unauthorized
- `402` - Insufficient minutes (upgrade required)
- `500` - Transcription failed

**Usage Calculation:**
- Minutes used = `durationSeconds / 60 * 0.5` (Whisper is fast, ~0.5x multiplier)

---

### POST /api/ai/analyze-takes

Identify repeated takes in a transcript using LLM analysis.

**Headers:**
```
Authorization: Bearer {access-token}
```

**Request Body:**
```json
{
  "transcript": "Timestamped transcript text...",
  "durationSeconds": 120,
  "provider": "openai",
  "userApiKey": "sk-optional-user-key"
}
```

**Fields:**
- `transcript` (required): Transcribed text with timestamps
- `durationSeconds` (optional): For usage tracking
- `provider` (optional): "openai" or "gemini" (default: "openai")
- `userApiKey` (optional): User's own API key

**Response (200):**
```json
{
  "success": true,
  "takeGroups": [
    {
      "phrase": "hey guys welcome back",
      "takes": [
        {
          "takeNumber": 1,
          "startTime": 0.5,
          "endTime": 2.3,
          "confidence": 0.95
        },
        {
          "takeNumber": 2,
          "startTime": 5.1,
          "endTime": 7.2,
          "confidence": 0.92
        }
      ]
    }
  ],
  "totalTakes": 2,
  "minutesUsed": 0.2
}
```

**Errors:**
- `400` - Transcript required
- `401` - Unauthorized
- `402` - Insufficient minutes
- `500` - Analysis failed

**Usage Calculation:**
- Minutes used = `durationSeconds / 60 * 0.1` (LLM is very fast, ~0.1x multiplier)

---

### POST /api/ai/isolate-audio

Isolate vocals from background noise using ElevenLabs (optional feature).

**Headers:**
```
Authorization: Bearer {access-token}
```

**Request Body:**
```json
{
  "audioBase64": "base64-encoded-audio-data",
  "durationSeconds": 120,
  "userApiKey": "elevenlabs-key-optional"
}
```

**Response (200):**
```json
{
  "success": true,
  "vocals": "base64-encoded-isolated-vocals",
  "instrumentals": "base64-encoded-background",
  "minutesUsed": 2.0
}
```

**Errors:**
- `400` - Audio data required
- `401` - Unauthorized
- `402` - Insufficient minutes
- `500` - Isolation failed

**Usage Calculation:**
- Minutes used = `durationSeconds / 60 * 1.0` (Voice isolation is 1:1)

---

## Payment (Stripe)

### POST /api/stripe/create-checkout

Create a Stripe checkout session for subscription upgrade.

**Headers:**
```
Authorization: Bearer {access-token}
```

**Request Body:**
```json
{
  "tier": "pro",
  "successUrl": "https://your-app.com/success",
  "cancelUrl": "https://your-app.com/cancel"
}
```

**Response (200):**
```json
{
  "success": true,
  "sessionId": "cs_test_xxx",
  "url": "https://checkout.stripe.com/pay/cs_test_xxx"
}
```

**Errors:**
- `400` - Invalid tier or missing URLs
- `401` - Unauthorized

---

### POST /api/stripe/create-portal

Create a Stripe customer portal session for managing subscription.

**Headers:**
```
Authorization: Bearer {access-token}
```

**Request Body:**
```json
{
  "returnUrl": "https://your-app.com/account"
}
```

**Response (200):**
```json
{
  "success": true,
  "url": "https://billing.stripe.com/session/xxx"
}
```

**Errors:**
- `400` - Return URL required
- `401` - Unauthorized
- `404` - No Stripe customer found

---

### POST /api/stripe/webhook

Stripe webhook handler for subscription events.

**Headers:**
```
stripe-signature: {webhook-signature}
```

**Events Handled:**
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

**Response (200):**
```json
{
  "received": true
}
```

**Note:** This endpoint is called by Stripe, not by client applications.

---

## Health & Status

### GET /api/health

Health check endpoint for monitoring service status.

**Response (200 - Healthy):**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "checks": [
    {
      "service": "database",
      "status": "healthy",
      "latencyMs": 45
    },
    {
      "service": "environment",
      "status": "healthy"
    }
  ],
  "version": "abc1234"
}
```

**Response (200 - Degraded):**
```json
{
  "status": "degraded",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "checks": [
    {
      "service": "database",
      "status": "unhealthy",
      "error": "Connection timeout"
    },
    {
      "service": "environment",
      "status": "healthy"
    }
  ],
  "version": "abc1234"
}
```

**Response (503 - Unhealthy):**
```json
{
  "status": "unhealthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "checks": [
    {
      "service": "database",
      "status": "unhealthy",
      "error": "Connection failed"
    },
    {
      "service": "environment",
      "status": "unhealthy",
      "error": "Missing required env vars: DATABASE_URL, JWT_SECRET"
    }
  ],
  "version": "abc1234"
}
```

---

## Error Handling

All endpoints return consistent error responses:

### Error Response Format

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "Additional context"
  }
}
```

### Common HTTP Status Codes

- **200** - Success
- **400** - Bad Request (invalid input)
- **401** - Unauthorized (missing or invalid token)
- **402** - Payment Required (insufficient minutes)
- **403** - Forbidden (valid token, insufficient permissions)
- **404** - Not Found
- **405** - Method Not Allowed
- **409** - Conflict (e.g., email already exists)
- **500** - Internal Server Error
- **503** - Service Unavailable

### Usage Limit Errors

When a user runs out of minutes:

```json
{
  "error": "Insufficient minutes",
  "message": "Please upgrade your plan or provide your own API key",
  "remaining": 0,
  "required": 2.5
}
```

---

## Rate Limiting

All endpoints are subject to Vercel's default rate limits:

- **100 requests per 10 seconds** per IP address
- **1000 requests per hour** per user (authenticated)

Exceeding these limits returns:

```json
{
  "error": "Too many requests",
  "retryAfter": 60
}
```

---

## Authentication Flow

### Initial Login

1. Call `/api/auth/login` or `/api/auth/register`
2. Store `token` and `refreshToken` securely
3. Include `token` in `Authorization: Bearer {token}` header

### Token Refresh

Access tokens expire after 1 hour. Refresh tokens last 30 days.

```javascript
// When access token expires (401 response)
const response = await fetch('/api/auth/refresh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ refreshToken })
});

const { token, expiresAt } = await response.json();
// Store new token and retry original request
```

---

## Example Usage

### Complete Transcription Flow

```typescript
// 1. Authenticate
const loginRes = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
const { token } = await loginRes.json();

// 2. Check usage
const statusRes = await fetch('/api/subscription/status', {
  headers: { Authorization: `Bearer ${token}` }
});
const { minutesRemaining } = await statusRes.json();

if (minutesRemaining < 2) {
  // Redirect to upgrade
}

// 3. Transcribe audio
const transcribeRes = await fetch('/api/ai/transcribe', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    audioBase64: base64AudioData,
    durationSeconds: 120,
    language: 'en'
  })
});

const { transcription, minutesUsed } = await transcribeRes.json();
console.log(`Transcription: ${transcription.text}`);
console.log(`Used ${minutesUsed} minutes`);
```

---

## Webhooks

### Stripe Webhook Configuration

Configure in Stripe Dashboard:

**Endpoint URL**: `https://your-vercel-deployment.vercel.app/api/stripe/webhook`

**Events to send**:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

**Webhook Secret**: Store in `STRIPE_WEBHOOK_SECRET` env var

---

## API Client Libraries

### TypeScript/JavaScript

```typescript
import { SpliceAPI } from './api-client';

const api = new SpliceAPI('https://api.splice.app');

// Login
await api.auth.login(email, password);

// Transcribe
const result = await api.ai.transcribe(audioBuffer, { language: 'en' });

// Check usage
const usage = await api.subscription.getStatus();
```

See `/src/api/backend-client.ts` for reference implementation.

---

## Support

For API issues or questions:

- **Documentation**: [Full docs](../README.md)
- **GitHub Issues**: [Report bugs](https://github.com/yourusername/splice/issues)
- **Email**: api-support@splice.app
