# Rate Limiting with User ID Support

## Overview

The rate limiting system now supports user-based rate limiting for authenticated requests, in addition to IP-based rate limiting for unauthenticated requests. This prevents users from bypassing rate limits through IP rotation.

## How It Works

### Rate Limit Key Generation

The system generates rate limit keys based on authentication status:

- **Authenticated requests**: `{prefix}:user:{userId}` (e.g., `api:user:user-123`)
- **Unauthenticated requests**: `{prefix}:ip:{ipAddress}` (e.g., `login:ip:192.168.1.1`)

This ensures that:
1. Authenticated users are tracked by their user ID, regardless of IP changes
2. Unauthenticated requests are still protected by IP-based rate limiting
3. Rate limits are isolated between different endpoint types (login, api, register, etc.)

## API Reference

### `getRateLimitIdentifier(ip: string, userId?: string, prefix: string): string`

Helper function to generate the appropriate rate limit key.

**Parameters:**
- `ip` - Client IP address
- `userId` - Optional user ID (for authenticated requests)
- `prefix` - Rate limit prefix from config (e.g., 'api', 'login')

**Returns:** The composite rate limit key

**Example:**
```typescript
import { getRateLimitIdentifier } from './lib/rate-limit';

// For authenticated request
const key = getRateLimitIdentifier('192.168.1.1', 'user-123', 'api');
// Returns: "api:user:user-123"

// For unauthenticated request
const key = getRateLimitIdentifier('192.168.1.1', undefined, 'login');
// Returns: "login:ip:192.168.1.1"
```

### `checkRateLimit(identifier: string, config: RateLimitConfig, userId?: string): Promise<RateLimitResult>`

Check and update rate limit for a request.

**Parameters:**
- `identifier` - IP address (usually from `getClientIP()`)
- `config` - Rate limit configuration
- `userId` - Optional user ID for authenticated requests

**Returns:** Promise resolving to RateLimitResult

## Usage Examples

### Example 1: Unauthenticated Endpoint (IP-based)

For endpoints like login, register, or password reset that don't require authentication:

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit, getClientIP, RATE_LIMITS } from '../../lib/rate-limit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check rate limit by IP only (no userId)
    const clientIP = getClientIP(req);
    const rateLimitResult = await checkRateLimit(clientIP, RATE_LIMITS.login);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', RATE_LIMITS.login.maxRequests);
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);
    res.setHeader('X-RateLimit-Reset', rateLimitResult.resetAt.toISOString());

    if (!rateLimitResult.allowed) {
      res.setHeader('Retry-After', rateLimitResult.retryAfter || 60);
      return res.status(429).json({
        error: 'Too many login attempts',
        message: `Please try again in ${rateLimitResult.retryAfter} seconds`,
        retryAfter: rateLimitResult.retryAfter,
      });
    }

    // Continue with login logic...
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

### Example 2: Authenticated Endpoint (User-based)

For authenticated endpoints like API calls, use user ID for rate limiting:

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../../lib/auth';
import { checkRateLimit, getClientIP, RATE_LIMITS } from '../../lib/rate-limit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate request first
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check rate limit by user ID
    const clientIP = getClientIP(req);
    const rateLimitResult = await checkRateLimit(
      clientIP,
      RATE_LIMITS.api,
      payload.userId  // Pass user ID for authenticated rate limiting
    );

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', RATE_LIMITS.api.maxRequests);
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);
    res.setHeader('X-RateLimit-Reset', rateLimitResult.resetAt.toISOString());

    if (!rateLimitResult.allowed) {
      res.setHeader('Retry-After', rateLimitResult.retryAfter || 60);
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many requests. Please try again in ${rateLimitResult.retryAfter} seconds`,
        retryAfter: rateLimitResult.retryAfter,
      });
    }

    // Continue with API logic...
  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

### Example 3: Optional Authentication (Hybrid)

For endpoints that work both authenticated and unauthenticated:

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../../lib/auth';
import { checkRateLimit, getClientIP, RATE_LIMITS } from '../../lib/rate-limit';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Try to authenticate (optional)
    const payload = await authenticateRequest(req);
    const userId = payload?.userId;

    // Check rate limit - uses user ID if authenticated, IP if not
    const clientIP = getClientIP(req);
    const rateLimitResult = await checkRateLimit(
      clientIP,
      RATE_LIMITS.api,
      userId  // Will be undefined for unauthenticated requests
    );

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', RATE_LIMITS.api.maxRequests);
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);
    res.setHeader('X-RateLimit-Reset', rateLimitResult.resetAt.toISOString());

    if (!rateLimitResult.allowed) {
      res.setHeader('Retry-After', rateLimitResult.retryAfter || 60);
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: rateLimitResult.retryAfter,
      });
    }

    // Continue with logic...
    // Authenticated users might get enhanced features
    if (userId) {
      // Enhanced functionality for authenticated users
    } else {
      // Limited functionality for unauthenticated users
    }
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

## Migration Guide

### Updating Existing Endpoints

If you have existing authenticated endpoints that use rate limiting by IP:

**Before:**
```typescript
const clientIP = getClientIP(req);
const rateLimitResult = await checkRateLimit(clientIP, RATE_LIMITS.api);
```

**After:**
```typescript
const payload = await authenticateRequest(req);
const clientIP = getClientIP(req);
const rateLimitResult = await checkRateLimit(
  clientIP,
  RATE_LIMITS.api,
  payload?.userId  // Add user ID parameter
);
```

### Backward Compatibility

The changes are fully backward compatible:
- Existing calls without the `userId` parameter continue to work
- IP-based rate limiting is still used when `userId` is undefined
- No database schema changes required

## Rate Limit Configuration

Available rate limit configurations in `RATE_LIMITS`:

| Config | Max Requests | Window | Use Case |
|--------|--------------|--------|----------|
| `login` | 5 | 60s | Login attempts |
| `register` | 3 | 300s (5min) | User registration |
| `passwordReset` | 3 | 600s (10min) | Password reset requests |
| `api` | 100 | 60s | General API calls |

### Creating Custom Rate Limits

```typescript
const customRateLimit: RateLimitConfig = {
  maxRequests: 10,
  windowSeconds: 60,
  prefix: 'custom-endpoint',
};

const rateLimitResult = await checkRateLimit(clientIP, customRateLimit, userId);
```

## Best Practices

1. **Always use user ID for authenticated endpoints**: Prevents IP rotation bypass
2. **Set appropriate rate limit headers**: Helps clients implement proper retry logic
3. **Use specific prefixes**: Isolates rate limits between different endpoint types
4. **Handle rate limit failures gracefully**: Provide clear error messages with retry information
5. **Monitor rate limit metrics**: Track which users/IPs are hitting limits

## Testing

The `getRateLimitIdentifier` function is fully tested. Example test:

```typescript
import { getRateLimitIdentifier } from '../../lib/rate-limit';

// Test with user ID
expect(getRateLimitIdentifier('192.168.1.1', 'user-123', 'api'))
  .toBe('api:user:user-123');

// Test without user ID
expect(getRateLimitIdentifier('192.168.1.1', undefined, 'api'))
  .toBe('api:ip:192.168.1.1');
```

## Database Schema

The rate limiting uses the existing `rate_limits` table:

```sql
CREATE TABLE rate_limits (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) NOT NULL,  -- Format: {prefix}:user:{userId} or {prefix}:ip:{ip}
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  INDEX idx_rate_limits_key (key),
  INDEX idx_rate_limits_created_at (created_at)
);
```

No schema changes are required - the key format is flexible and supports both user and IP-based identifiers.
