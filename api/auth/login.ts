import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Dynamic imports for Vercel bundling
  const db = await import('../../lib/db.js');
  const auth = await import('../../lib/auth.js');
  const rateLimit = await import('../../lib/rate-limit.js');

  const { getUserByEmail } = db;
  const { verifyPassword, createToken, createRefreshToken, getTokenExpiry } = auth;
  const {
    checkRateLimit,
    getClientIP,
    RATE_LIMITS,
    checkAccountLockout,
    recordFailedLogin,
    clearFailedLogins,
    validateEmail,
  } = rateLimit;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check rate limit by IP
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

    // Check account lockout
    const lockoutResult = await checkAccountLockout(email);
    if (lockoutResult.locked) {
      const unlockIn = lockoutResult.unlockAt
        ? Math.ceil((lockoutResult.unlockAt.getTime() - Date.now()) / 1000 / 60)
        : 15;

      return res.status(423).json({
        error: 'Account temporarily locked',
        message: `Too many failed login attempts. Please try again in ${unlockIn} minutes.`,
        unlockAt: lockoutResult.unlockAt?.toISOString(),
      });
    }

    // Find user
    const user = await getUserByEmail(email);
    if (!user) {
      // Record failed attempt even for non-existent users (prevents enumeration)
      await recordFailedLogin(email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      // Record failed login attempt
      const failedResult = await recordFailedLogin(email);

      if (failedResult.locked) {
        return res.status(423).json({
          error: 'Account temporarily locked',
          message: 'Too many failed login attempts. Please try again in 15 minutes.',
          unlockAt: failedResult.unlockAt?.toISOString(),
        });
      }

      const remainingAttempts = 5 - failedResult.failedAttempts;
      return res.status(401).json({
        error: 'Invalid credentials',
        remainingAttempts: Math.max(0, remainingAttempts),
      });
    }

    // Successful login - clear failed attempts
    await clearFailedLogins(email);

    // Generate JWT tokens
    const tokenPayload = {
      userId: user.id,
      email: user.email,
    };
    const token = await createToken(tokenPayload);
    const refreshToken = await createRefreshToken(tokenPayload);
    const expiresAt = getTokenExpiry();

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
      },
      token,
      refreshToken,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Login error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    return res.status(500).json({
      error: 'Internal server error',
      debug: {
        message: errorMessage,
        stack: errorStack?.split('\n').slice(0, 5),
      },
    });
  }
}
