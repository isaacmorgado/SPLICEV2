import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Reset Password Endpoint
 *
 * POST /api/auth/reset-password
 *
 * Resets a user's password using a valid reset token
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Dynamic imports for Vercel bundling
  const passwordReset = await import('../../lib/password-reset.js');
  const rateLimit = await import('../../lib/rate-limit.js');
  const middleware = await import('../../lib/middleware.js');

  const { resetPasswordWithToken } = passwordReset;
  const { validatePasswordComplexity } = rateLimit;
  const { createErrorResponse } = middleware;

  if (req.method !== 'POST') {
    return res
      .status(405)
      .json(createErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed'));
  }

  try {
    const { token, newPassword } = req.body as {
      token?: string;
      newPassword?: string;
    };

    // Validate input
    if (!token || !newPassword) {
      return res
        .status(400)
        .json(createErrorResponse(400, 'VALIDATION_ERROR', 'Token and new password are required'));
    }

    // Validate password complexity
    const passwordValidation = validatePasswordComplexity(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json(
        createErrorResponse(400, 'WEAK_PASSWORD', 'Password does not meet requirements', {
          errors: passwordValidation.errors,
        })
      );
    }

    // Reset password
    const result = await resetPasswordWithToken(token, newPassword);

    if (!result.success) {
      return res
        .status(400)
        .json(
          createErrorResponse(
            400,
            'INVALID_TOKEN',
            result.error || 'Invalid or expired reset token'
          )
        );
    }

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res
      .status(500)
      .json(createErrorResponse(500, 'INTERNAL_ERROR', 'Internal server error'));
  }
}
