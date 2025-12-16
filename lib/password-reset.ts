/**
 * Password Reset System
 * Generates secure reset tokens and validates them
 */

import { getSql } from './db.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export interface PasswordResetToken {
  id: string;
  userId: string;
  expiresAt: Date;
  used: boolean;
}

// Token expiry: 1 hour
const TOKEN_EXPIRY_HOURS = 1;

/**
 * Generate a secure random token
 */
function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a reset token for storage
 */
function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create a password reset token for a user
 * Returns the plain token (only shown once, not stored)
 */
export async function createPasswordResetToken(
  email: string
): Promise<{ token: string; userId: string } | null> {
  const sql = await getSql();

  // Find user by email
  const userRows = await sql`
    SELECT id FROM users WHERE email = ${email.toLowerCase()}
  `;

  if (userRows.length === 0) {
    // Don't reveal if email exists or not (security)
    return null;
  }

  const user = userRows[0] as { id: string };
  const userId = user.id;

  // Generate token
  const plainToken = generateResetToken();
  const tokenHash = hashResetToken(plainToken);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  // Invalidate any existing tokens for this user
  await sql`
    UPDATE password_reset_tokens
    SET used = TRUE
    WHERE user_id = ${userId} AND used = FALSE
  `;

  // Store new token
  await sql`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (${userId}, ${tokenHash}, ${expiresAt})
  `;

  return { token: plainToken, userId };
}

/**
 * Validate a password reset token
 * Returns userId if valid, null if invalid/expired
 */
export async function validatePasswordResetToken(token: string): Promise<string | null> {
  const sql = await getSql();
  const tokenHash = hashResetToken(token);

  const rows = await sql`
    SELECT user_id, expires_at, used
    FROM password_reset_tokens
    WHERE token_hash = ${tokenHash}
  `;

  if (rows.length === 0) {
    return null;
  }

  const resetToken = rows[0] as {
    user_id: string;
    expires_at: Date;
    used: boolean;
  };

  // Check if token is still valid
  if (resetToken.used) {
    return null;
  }

  if (new Date(resetToken.expires_at) < new Date()) {
    return null;
  }

  return resetToken.user_id;
}

/**
 * Reset a user's password using a valid token
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  // Validate token
  const userId = await validatePasswordResetToken(token);
  if (!userId) {
    return { success: false, error: 'Invalid or expired reset token' };
  }

  const sql = await getSql();
  const tokenHash = hashResetToken(token);

  try {
    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update password and mark token as used in a transaction
    await sql`BEGIN`;

    await sql`
      UPDATE users
      SET password_hash = ${passwordHash}
      WHERE id = ${userId}
    `;

    await sql`
      UPDATE password_reset_tokens
      SET used = TRUE
      WHERE token_hash = ${tokenHash}
    `;

    await sql`COMMIT`;

    return { success: true };
  } catch (error) {
    await sql`ROLLBACK`;
    console.error('Password reset error:', error);
    return { success: false, error: 'Failed to reset password' };
  }
}

/**
 * Get reset token info (for display purposes, without revealing the token)
 */
export async function getResetTokenInfo(email: string): Promise<{
  hasActiveToken: boolean;
  expiresAt?: Date;
} | null> {
  const sql = await getSql();

  const rows = await sql`
    SELECT prt.expires_at
    FROM password_reset_tokens prt
    JOIN users u ON u.id = prt.user_id
    WHERE u.email = ${email.toLowerCase()}
      AND prt.used = FALSE
      AND prt.expires_at > NOW()
    ORDER BY prt.created_at DESC
    LIMIT 1
  `;

  if (rows.length === 0) {
    return { hasActiveToken: false };
  }

  const row = rows[0] as { expires_at: Date };

  return {
    hasActiveToken: true,
    expiresAt: row.expires_at,
  };
}

/**
 * Clean up expired tokens (called by cron job)
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const sql = await getSql();

  const rows = await sql`
    DELETE FROM password_reset_tokens
    WHERE expires_at < NOW() OR used = TRUE
    RETURNING id
  `;

  return rows.length;
}
