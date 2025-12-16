import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Request Password Reset Endpoint
 *
 * POST /api/auth/request-reset
 *
 * Generates a password reset token and returns it.
 * In production, this should send an email instead of returning the token.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Dynamic imports for Vercel bundling
  const passwordReset = await import('../../lib/password-reset.js');
  const rateLimit = await import('../../lib/rate-limit.js');
  const middleware = await import('../../lib/middleware.js');
  const emailService = await import('../../lib/email.js');

  const { createPasswordResetToken, getResetTokenInfo } = passwordReset;
  const { checkRateLimit, getClientIP, RATE_LIMITS, validateEmail } = rateLimit;
  const { createErrorResponse } = middleware;
  const { sendPasswordResetEmail } = emailService;

  if (req.method !== 'POST') {
    return res
      .status(405)
      .json(createErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed'));
  }

  try {
    const { email } = req.body as { email?: string };

    // Validate input
    if (!email) {
      return res
        .status(400)
        .json(createErrorResponse(400, 'VALIDATION_ERROR', 'Email is required'));
    }

    if (!validateEmail(email)) {
      return res
        .status(400)
        .json(createErrorResponse(400, 'VALIDATION_ERROR', 'Invalid email format'));
    }

    // Rate limiting
    const clientIP = getClientIP(req);
    const rateLimitResult = await checkRateLimit(clientIP, RATE_LIMITS.passwordReset);

    res.setHeader('X-RateLimit-Limit', RATE_LIMITS.passwordReset.maxRequests);
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);
    res.setHeader('X-RateLimit-Reset', rateLimitResult.resetAt.toISOString());

    if (!rateLimitResult.allowed) {
      res.setHeader('Retry-After', rateLimitResult.retryAfter || 600);
      return res
        .status(429)
        .json(
          createErrorResponse(
            429,
            'RATE_LIMIT_EXCEEDED',
            `Too many password reset requests. Please try again in ${rateLimitResult.retryAfter} seconds`,
            { retryAfter: rateLimitResult.retryAfter }
          )
        );
    }

    // Check if user already has an active token
    const tokenInfo = await getResetTokenInfo(email);
    if (tokenInfo?.hasActiveToken) {
      return res.status(200).json({
        success: true,
        message: 'A password reset link has already been sent to this email address',
        expiresAt: tokenInfo.expiresAt?.toISOString(),
      });
    }

    // Generate reset token
    const result = await createPasswordResetToken(email);

    // Always return success (don't reveal if email exists)
    // In production, send email here instead of returning token
    if (!result) {
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, a password reset link will be sent',
      });
    }

    // Send password reset email
    const emailResult = await sendPasswordResetEmail(email, result.token, result.userId);

    if (!emailResult.success) {
      console.error('Failed to send password reset email:', emailResult.error);
      // Don't reveal failure to user (security), but log it
    }

    // DEVELOPMENT ONLY: Return token in response
    if (process.env.NODE_ENV === 'development') {
      return res.status(200).json({
        success: true,
        message: 'Password reset token generated',
        token: result.token,
        userId: result.userId,
        emailSent: emailResult.success,
        warning: 'Token should only be sent via email in production',
      });
    }

    // PRODUCTION: Return generic success message
    return res.status(200).json({
      success: true,
      message: 'If an account exists with this email, a password reset link will be sent',
    });
  } catch (error) {
    console.error('Request password reset error:', error);
    return res
      .status(500)
      .json(createErrorResponse(500, 'INTERNAL_ERROR', 'Internal server error'));
  }
}
