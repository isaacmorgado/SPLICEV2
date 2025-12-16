import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Dynamic imports for Vercel bundling
  const db = await import('../../lib/db.js');
  const auth = await import('../../lib/auth.js');
  const stripe = await import('../../lib/stripe.js');
  const referrals = await import('../../lib/referrals.js');
  const rateLimit = await import('../../lib/rate-limit.js');

  const { createUser, getUserByEmail, createTrialSubscription } = db;
  const { hashPassword, createToken, createRefreshToken, getTokenExpiry } = auth;
  const { createCustomer } = stripe;
  const { validateReferralCode, redeemReferralCode } = referrals;
  const { checkRateLimit, getClientIP, RATE_LIMITS, validatePasswordComplexity, validateEmail } =
    rateLimit;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password, referralCode } = req.body;

    // Validate input presence
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Validate referral code if provided (before creating user)
    let validReferral = false;
    if (referralCode) {
      const referralValidation = await validateReferralCode(referralCode);
      if (!referralValidation.valid) {
        return res.status(400).json({
          error: 'Invalid referral code',
          details: referralValidation.error,
        });
      }
      validReferral = true;
    }

    // Validate email format
    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password complexity
    const passwordValidation = validatePasswordComplexity(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        error: 'Password does not meet requirements',
        details: passwordValidation.errors,
      });
    }

    // Check rate limit by IP
    const clientIP = getClientIP(req);
    const rateLimitResult = await checkRateLimit(clientIP, RATE_LIMITS.register);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', RATE_LIMITS.register.maxRequests);
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);
    res.setHeader('X-RateLimit-Reset', rateLimitResult.resetAt.toISOString());

    if (!rateLimitResult.allowed) {
      res.setHeader('Retry-After', rateLimitResult.retryAfter || 300);
      return res.status(429).json({
        error: 'Too many registration attempts',
        message: `Please try again in ${Math.ceil((rateLimitResult.retryAfter || 300) / 60)} minutes`,
        retryAfter: rateLimitResult.retryAfter,
      });
    }

    // Check if user exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const user = await createUser(email, passwordHash);

    // Create Stripe customer (optional - continues if it fails)
    let stripeCustomer: { id: string } | null = null;
    try {
      stripeCustomer = await createCustomer(email, user.id);
    } catch (stripeError) {
      console.error('Stripe customer creation failed (non-blocking):', stripeError);
      // Continue without Stripe customer - can be linked later
    }

    // Create 30-day trial subscription (Pro features)
    const subscription = await createTrialSubscription(user.id);

    // Apply referral code if provided and valid
    let referralApplied = false;
    if (validReferral && referralCode) {
      const redemptionResult = await redeemReferralCode(referralCode, user.id);
      referralApplied = redemptionResult.success;
      if (!redemptionResult.success) {
        console.warn(
          `Failed to apply referral code for user ${user.id}: ${redemptionResult.error}`
        );
      }
    }

    // Generate JWT tokens
    const tokenPayload = {
      userId: user.id,
      email: user.email,
    };
    const token = await createToken(tokenPayload);
    const refreshToken = await createRefreshToken(tokenPayload);
    const expiresAt = getTokenExpiry();

    return res.status(201).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
      },
      token,
      refreshToken,
      expiresAt: expiresAt.toISOString(),
      stripeCustomerId: stripeCustomer?.id ?? null,
      trial: {
        active: true,
        endsAt: subscription.trial_ends_at,
        tier: 'pro',
        minutesIncluded: 300,
      },
      referral: referralApplied
        ? {
            applied: true,
            discountedMonths: 2,
            discountedPrice: 4500, // $45 in cents
            regularPrice: 6500, // $65 in cents
          }
        : { applied: false },
    });
  } catch (error) {
    console.error('Registration error:', error);
    // Return more details in development to aid debugging
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
