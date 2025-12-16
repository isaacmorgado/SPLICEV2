import type { VercelRequest, VercelResponse } from '@vercel/node';

// Type for user returned from database
interface UserRecord {
  id: string;
  email: string;
  created_at: Date;
}

/**
 * User Profile Management Endpoint
 *
 * GET  /api/user/profile - Get user profile
 * PUT  /api/user/profile - Update user profile
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Dynamic imports for Vercel bundling
  const auth = await import('../../lib/auth.js');
  const db = await import('../../lib/db.js');
  const middleware = await import('../../lib/middleware.js');

  const { authenticateRequest, hashPassword } = auth;
  const { getUserById, getSql } = db;
  const { createErrorResponse } = middleware;

  try {
    // Authenticate request
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res
        .status(401)
        .json(createErrorResponse(401, 'UNAUTHORIZED', 'Authentication required'));
    }

    const userId = payload.userId;

    switch (req.method) {
      case 'GET':
        return handleGetProfile(userId, res);

      case 'PUT':
        return handleUpdateProfile(userId, req, res);

      default:
        return res
          .status(405)
          .json(createErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed'));
    }
  } catch (error) {
    console.error('Profile endpoint error:', error);
    return res
      .status(500)
      .json(createErrorResponse(500, 'INTERNAL_ERROR', 'Internal server error'));
  }

  /**
   * Get user profile with subscription info
   */
  async function handleGetProfile(userId: string, res: VercelResponse) {
    const user = (await getUserById(userId)) as UserRecord | null;
    if (!user) {
      return res.status(404).json(createErrorResponse(404, 'NOT_FOUND', 'User not found'));
    }

    const sql = await getSql();

    // Get subscription details
    const subRows = await sql`
      SELECT tier, status, minutes_used, period_end, is_trial, trial_ends_at, created_at
      FROM subscriptions
      WHERE user_id = ${userId}
    `;

    const subscription = subRows[0] as
      | {
          tier: string;
          status: string;
          minutes_used: number;
          period_end: Date | null;
          is_trial: boolean;
          trial_ends_at: Date | null;
          created_at: Date;
        }
      | undefined;

    // Get referral stats
    const refRows = await sql`
      SELECT code, uses_remaining
      FROM referral_codes
      WHERE owner_user_id = ${userId}
    `;

    const referralCode = refRows[0] as { code: string; uses_remaining: number } | undefined;

    // Get total referral redemptions
    const redemptionRows = await sql`
      SELECT COUNT(*) as count
      FROM referral_redemptions
      WHERE rewarded_to_user_id = ${userId}
    `;

    const redemptionCount = parseInt((redemptionRows[0] as { count: string }).count || '0', 10);

    return res.status(200).json({
      success: true,
      profile: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
        subscription: subscription
          ? {
              tier: subscription.tier,
              status: subscription.status,
              minutesUsed: subscription.minutes_used,
              periodEnd: subscription.period_end?.toISOString(),
              isTrial: subscription.is_trial,
              trialEndsAt: subscription.trial_ends_at?.toISOString(),
              memberSince: subscription.created_at.toISOString(),
            }
          : null,
        referral: referralCode
          ? {
              code: referralCode.code,
              usesRemaining: referralCode.uses_remaining,
              totalRedemptions: redemptionCount,
            }
          : null,
      },
    });
  }

  /**
   * Update user profile (email or password)
   */
  async function handleUpdateProfile(userId: string, req: VercelRequest, res: VercelResponse) {
    const { email, currentPassword, newPassword } = req.body as {
      email?: string;
      currentPassword?: string;
      newPassword?: string;
    };

    const sql = await getSql();

    // Get current user data
    const userRows = await sql`
      SELECT email, password_hash
      FROM users
      WHERE id = ${userId}
    `;

    if (userRows.length === 0) {
      return res.status(404).json(createErrorResponse(404, 'NOT_FOUND', 'User not found'));
    }

    const currentUser = userRows[0] as { email: string; password_hash: string };

    // Update email if provided
    if (email && email !== currentUser.email) {
      // Check if email is already taken
      const emailCheckRows = await sql`
        SELECT id FROM users WHERE email = ${email.toLowerCase()} AND id != ${userId}
      `;

      if (emailCheckRows.length > 0) {
        return res
          .status(400)
          .json(createErrorResponse(400, 'EMAIL_TAKEN', 'Email address is already in use'));
      }

      await sql`
        UPDATE users
        SET email = ${email.toLowerCase()}
        WHERE id = ${userId}
      `;
    }

    // Update password if provided
    if (newPassword) {
      if (!currentPassword) {
        return res
          .status(400)
          .json(
            createErrorResponse(
              400,
              'VALIDATION_ERROR',
              'Current password is required to change password'
            )
          );
      }

      // Verify current password
      const bcrypt = await import('bcryptjs');
      const isValid = await bcrypt.compare(currentPassword, currentUser.password_hash);

      if (!isValid) {
        return res
          .status(401)
          .json(createErrorResponse(401, 'INVALID_PASSWORD', 'Current password is incorrect'));
      }

      // Validate new password
      const rateLimit = await import('../../lib/rate-limit.js');
      const { validatePasswordComplexity } = rateLimit;
      const validation = validatePasswordComplexity(newPassword);

      if (!validation.valid) {
        return res.status(400).json(
          createErrorResponse(400, 'WEAK_PASSWORD', 'New password does not meet requirements', {
            errors: validation.errors,
          })
        );
      }

      // Hash and update
      const newPasswordHash = await hashPassword(newPassword);
      await sql`
        UPDATE users
        SET password_hash = ${newPasswordHash}
        WHERE id = ${userId}
      `;
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
    });
  }
}
