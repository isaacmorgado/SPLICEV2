# Example: Adding User-Based Rate Limiting to an Authenticated Endpoint

This document shows a practical example of adding user-based rate limiting to an existing authenticated API endpoint.

## Before: Without Rate Limiting

Here's the original `/api/subscription/usage.ts` endpoint without rate limiting:

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Dynamic imports for Vercel bundling
  const auth = await import('../../lib/auth.js');
  const db = await import('../../lib/db.js');
  const usageModule = await import('../../lib/usage.js');

  const { authenticateRequest } = auth;
  const { getUsageRecords } = db;
  const { checkUsage } = usageModule;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate request
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get usage summary
    const usage = await checkUsage(payload.userId);

    // ... rest of the endpoint logic

    return res.status(200).json({
      summary: {
        tier: usage.tier,
        minutesUsed: usage.used,
        // ... more data
      },
    });
  } catch (error) {
    console.error('Usage fetch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

### Issues with this approach:
1. No protection against abuse - a user could spam this endpoint
2. No rate limiting means potential database overload
3. No feedback to clients about rate limit status

## After: With User-Based Rate Limiting

Here's the updated endpoint with user-based rate limiting:

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Dynamic imports for Vercel bundling
  const auth = await import('../../lib/auth.js');
  const db = await import('../../lib/db.js');
  const usageModule = await import('../../lib/usage.js');
  const rateLimit = await import('../../lib/rate-limit.js');  // NEW: Import rate limiting

  const { authenticateRequest } = auth;
  const { getUsageRecords } = db;
  const { checkUsage } = usageModule;
  const { checkRateLimit, getClientIP, RATE_LIMITS } = rateLimit;  // NEW: Import rate limit functions

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate request FIRST
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // NEW: Check rate limit using user ID
    const clientIP = getClientIP(req);
    const rateLimitResult = await checkRateLimit(
      clientIP,
      RATE_LIMITS.api,
      payload.userId  // Use user ID for authenticated rate limiting
    );

    // NEW: Set rate limit headers
    res.setHeader('X-RateLimit-Limit', RATE_LIMITS.api.maxRequests);
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);
    res.setHeader('X-RateLimit-Reset', rateLimitResult.resetAt.toISOString());

    // NEW: Handle rate limit exceeded
    if (!rateLimitResult.allowed) {
      res.setHeader('Retry-After', rateLimitResult.retryAfter || 60);
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many requests. Please try again in ${rateLimitResult.retryAfter} seconds`,
        retryAfter: rateLimitResult.retryAfter,
      });
    }

    // Get usage summary
    const usage = await checkUsage(payload.userId);

    // ... rest of the endpoint logic (unchanged)

    return res.status(200).json({
      summary: {
        tier: usage.tier,
        minutesUsed: usage.used,
        // ... more data
      },
    });
  } catch (error) {
    console.error('Usage fetch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

## Key Changes Explained

### 1. Import Rate Limiting Module
```typescript
const rateLimit = await import('../../lib/rate-limit.js');
const { checkRateLimit, getClientIP, RATE_LIMITS } = rateLimit;
```

### 2. Authenticate Before Rate Limiting
```typescript
// Authenticate FIRST to get user ID
const payload = await authenticateRequest(req);
if (!payload) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

Important: Always authenticate before checking rate limits for authenticated endpoints. This ensures you have the `userId` available.

### 3. Check Rate Limit with User ID
```typescript
const clientIP = getClientIP(req);
const rateLimitResult = await checkRateLimit(
  clientIP,
  RATE_LIMITS.api,
  payload.userId  // Pass user ID - this is the key change!
);
```

This creates a rate limit key like `api:user:user-123` instead of `api:ip:192.168.1.1`.

### 4. Set Rate Limit Headers
```typescript
res.setHeader('X-RateLimit-Limit', RATE_LIMITS.api.maxRequests);
res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);
res.setHeader('X-RateLimit-Reset', rateLimitResult.resetAt.toISOString());
```

These headers help clients implement proper rate limit handling.

### 5. Handle Rate Limit Exceeded
```typescript
if (!rateLimitResult.allowed) {
  res.setHeader('Retry-After', rateLimitResult.retryAfter || 60);
  return res.status(429).json({
    error: 'Rate limit exceeded',
    message: `Too many requests. Please try again in ${rateLimitResult.retryAfter} seconds`,
    retryAfter: rateLimitResult.retryAfter,
  });
}
```

Return a clear 429 status with retry information.

## Benefits

### 1. User-Based Tracking
- Each user has their own rate limit
- Changing IPs doesn't bypass the limit
- VPN/proxy rotation is ineffective

### 2. Better Security
- Prevents abuse from individual users
- Protects database from overload
- No impact on other legitimate users

### 3. Client Visibility
Response headers show rate limit status:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 2025-12-15T22:00:00.000Z
```

Clients can implement smart retry logic and show users their limit status.

### 4. Backward Compatible
- Existing unauthenticated flows still work (uses IP)
- No database migrations required
- No breaking changes to API contracts

## Testing the Updated Endpoint

### Test 1: Normal Request
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:3000/api/subscription/usage
```

Response includes headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 2025-12-15T22:00:00.000Z
```

### Test 2: Rate Limit Exceeded
After 100 requests in 60 seconds:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:3000/api/subscription/usage
```

Response:
```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again in 45 seconds",
  "retryAfter": 45
}
```

Headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 2025-12-15T22:00:00.000Z
Retry-After: 45
```

## Best Practices Checklist

- ✅ Authenticate before rate limiting (to get user ID)
- ✅ Use `RATE_LIMITS.api` for general API endpoints
- ✅ Set all three rate limit headers
- ✅ Return 429 status when limit exceeded
- ✅ Include `Retry-After` header
- ✅ Provide clear error messages
- ✅ Pass `payload.userId` to `checkRateLimit()`

## Common Mistakes to Avoid

### ❌ Don't check rate limit before authentication
```typescript
// WRONG - no user ID available yet
const rateLimitResult = await checkRateLimit(clientIP, RATE_LIMITS.api);
const payload = await authenticateRequest(req);
```

### ❌ Don't forget to pass user ID
```typescript
// WRONG - will use IP-based rate limiting
const rateLimitResult = await checkRateLimit(clientIP, RATE_LIMITS.api);
```

### ❌ Don't use wrong rate limit config
```typescript
// WRONG - login config is for unauthenticated endpoints
const rateLimitResult = await checkRateLimit(
  clientIP,
  RATE_LIMITS.login,  // Should be RATE_LIMITS.api
  payload.userId
);
```

### ✅ Correct implementation
```typescript
// CORRECT
const payload = await authenticateRequest(req);
if (!payload) return res.status(401).json({ error: 'Unauthorized' });

const clientIP = getClientIP(req);
const rateLimitResult = await checkRateLimit(
  clientIP,
  RATE_LIMITS.api,
  payload.userId
);
```

## Roll-Out Strategy

### Phase 1: Add to High-Traffic Endpoints
Start with endpoints that:
- Are called frequently
- Could be abused
- Have expensive operations (DB queries, AI processing)

Examples:
- `/api/ai/transcribe`
- `/api/ai/analyze-takes`
- `/api/subscription/usage`

### Phase 2: Add to All Authenticated Endpoints
After verifying Phase 1, add to all authenticated endpoints for consistent protection.

### Phase 3: Monitor and Adjust
- Track rate limit hits in logs
- Adjust `maxRequests` if needed
- Create custom configs for specific endpoints if needed

## Summary

Adding user-based rate limiting to authenticated endpoints:
1. Prevents abuse by individual users
2. Protects infrastructure from overload
3. Provides clear feedback to clients
4. Is backward compatible
5. Requires minimal code changes (6-8 lines)

The key is passing `payload.userId` to `checkRateLimit()` - this single parameter enables user-based tracking instead of IP-based tracking.
