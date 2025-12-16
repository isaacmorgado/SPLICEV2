import { getSql } from './db.js';

/**
 * Rate Limiter for Vercel Serverless Functions
 * Uses database-backed storage for distributed rate limiting
 */

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** Identifier prefix for different rate limit types */
  prefix: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter?: number; // seconds until reset
}

// Default configurations for different endpoints
export const RATE_LIMITS = {
  login: {
    maxRequests: 5,
    windowSeconds: 60, // 5 attempts per minute
    prefix: 'login',
  },
  register: {
    maxRequests: 3,
    windowSeconds: 300, // 3 registrations per 5 minutes
    prefix: 'register',
  },
  passwordReset: {
    maxRequests: 3,
    windowSeconds: 600, // 3 resets per 10 minutes
    prefix: 'pwd_reset',
  },
  api: {
    maxRequests: 100,
    windowSeconds: 60, // 100 requests per minute
    prefix: 'api',
  },
} as const;

/**
 * Get the rate limit identifier key
 * @param ip - IP address
 * @param userId - Optional user ID for authenticated requests
 * @param prefix - Rate limit prefix from config
 * @returns The composite rate limit key
 */
export function getRateLimitIdentifier(
  ip: string,
  userId: string | undefined,
  prefix: string
): string {
  if (userId) {
    return `${prefix}:user:${userId}`;
  }
  return `${prefix}:ip:${ip}`;
}

/**
 * Check and update rate limit for a given identifier
 * @param identifier - Unique identifier (usually IP address)
 * @param config - Rate limit configuration
 * @param userId - Optional user ID for authenticated requests
 * @returns Rate limit result
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig,
  userId?: string
): Promise<RateLimitResult> {
  const key = getRateLimitIdentifier(identifier, userId, config.prefix);
  const now = new Date();
  const windowStart = new Date(now.getTime() - config.windowSeconds * 1000);

  try {
    const sql = await getSql();

    // Clean up old entries and count recent requests in one query
    const result = await sql`
      WITH cleanup AS (
        DELETE FROM rate_limits
        WHERE key = ${key} AND created_at < ${windowStart}
      ),
      recent AS (
        SELECT COUNT(*) as count
        FROM rate_limits
        WHERE key = ${key} AND created_at >= ${windowStart}
      )
      SELECT count FROM recent
    `;

    const countRow = result[0] as { count: string } | undefined;
    const currentCount = parseInt(countRow?.count || '0', 10);
    const resetAt = new Date(now.getTime() + config.windowSeconds * 1000);

    if (currentCount >= config.maxRequests) {
      // Rate limit exceeded
      const oldestEntry = await sql`
        SELECT created_at FROM rate_limits
        WHERE key = ${key}
        ORDER BY created_at ASC
        LIMIT 1
      `;

      const oldestRow = oldestEntry[0] as { created_at: string } | undefined;
      const retryAfter = oldestRow
        ? Math.ceil(
            (new Date(oldestRow.created_at).getTime() +
              config.windowSeconds * 1000 -
              now.getTime()) /
              1000
          )
        : config.windowSeconds;

      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfter: Math.max(1, retryAfter),
      };
    }

    // Record this request
    await sql`
      INSERT INTO rate_limits (key, created_at)
      VALUES (${key}, ${now})
    `;

    return {
      allowed: true,
      remaining: config.maxRequests - currentCount - 1,
      resetAt,
    };
  } catch (error) {
    console.error('Rate limit check failed:', error);
    // Fail open - allow request if rate limiting fails
    // In production, you might want to fail closed instead
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: new Date(now.getTime() + config.windowSeconds * 1000),
    };
  }
}

/**
 * Get client IP from Vercel request
 */
export function getClientIP(req: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  // Vercel provides the real client IP in x-forwarded-for
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ip.trim();
  }

  // Fallback headers
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return Array.isArray(realIP) ? realIP[0] : realIP;
  }

  return 'unknown';
}

/**
 * Account lockout tracking
 */
export interface LockoutConfig {
  /** Number of failed attempts before lockout */
  maxFailedAttempts: number;
  /** Lockout duration in seconds */
  lockoutSeconds: number;
}

export const LOCKOUT_CONFIG: LockoutConfig = {
  maxFailedAttempts: 5,
  lockoutSeconds: 900, // 15 minutes
};

export interface LockoutResult {
  locked: boolean;
  failedAttempts: number;
  unlockAt?: Date;
}

/**
 * Check if an account is locked out
 */
export async function checkAccountLockout(email: string): Promise<LockoutResult> {
  try {
    const sql = await getSql();
    const result = await sql`
      SELECT failed_attempts, locked_until
      FROM account_lockouts
      WHERE email = ${email.toLowerCase()}
    `;

    if (result.length === 0) {
      return { locked: false, failedAttempts: 0 };
    }

    const row = result[0] as { failed_attempts: number; locked_until: string | null };
    const { failed_attempts, locked_until } = row;
    const now = new Date();

    if (locked_until && new Date(locked_until) > now) {
      return {
        locked: true,
        failedAttempts: failed_attempts,
        unlockAt: new Date(locked_until),
      };
    }

    // Lock has expired, reset if needed
    if (locked_until && new Date(locked_until) <= now) {
      await sql`
        UPDATE account_lockouts
        SET failed_attempts = 0, locked_until = NULL
        WHERE email = ${email.toLowerCase()}
      `;
      return { locked: false, failedAttempts: 0 };
    }

    return { locked: false, failedAttempts: failed_attempts };
  } catch (error) {
    console.error('Lockout check failed:', error);
    return { locked: false, failedAttempts: 0 };
  }
}

/**
 * Record a failed login attempt
 */
export async function recordFailedLogin(email: string): Promise<LockoutResult> {
  const lowerEmail = email.toLowerCase();
  const now = new Date();

  try {
    const sql = await getSql();

    // Upsert failed attempt
    const result = await sql`
      INSERT INTO account_lockouts (email, failed_attempts, last_attempt)
      VALUES (${lowerEmail}, 1, ${now})
      ON CONFLICT (email) DO UPDATE
      SET
        failed_attempts = account_lockouts.failed_attempts + 1,
        last_attempt = ${now}
      RETURNING failed_attempts
    `;

    const row = result[0] as { failed_attempts: number } | undefined;
    const failedAttempts = row?.failed_attempts || 1;

    // Check if we need to lock the account
    if (failedAttempts >= LOCKOUT_CONFIG.maxFailedAttempts) {
      const lockUntil = new Date(now.getTime() + LOCKOUT_CONFIG.lockoutSeconds * 1000);

      await sql`
        UPDATE account_lockouts
        SET locked_until = ${lockUntil}
        WHERE email = ${lowerEmail}
      `;

      return {
        locked: true,
        failedAttempts,
        unlockAt: lockUntil,
      };
    }

    return { locked: false, failedAttempts };
  } catch (error) {
    console.error('Record failed login error:', error);
    return { locked: false, failedAttempts: 0 };
  }
}

/**
 * Clear failed login attempts on successful login
 */
export async function clearFailedLogins(email: string): Promise<void> {
  try {
    const sql = await getSql();
    await sql`
      DELETE FROM account_lockouts
      WHERE email = ${email.toLowerCase()}
    `;
  } catch (error) {
    console.error('Clear failed logins error:', error);
  }
}

/**
 * Password complexity validation
 */
export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePasswordComplexity(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (password.length > 128) {
    errors.push('Password must be less than 128 characters');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  // Check for common passwords (basic list)
  const commonPasswords = [
    'password',
    'password1',
    '12345678',
    'qwerty123',
    'letmein',
    'welcome1',
    'admin123',
    'iloveyou',
  ];

  if (commonPasswords.includes(password.toLowerCase())) {
    errors.push('Password is too common, please choose a more unique password');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Email validation
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 255;
}
