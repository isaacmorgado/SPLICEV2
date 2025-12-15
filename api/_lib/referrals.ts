/**
 * Referral Code System
 *
 * - Each user gets one referral code (generated on demand)
 * - New user with code: $45/month for first 2 months, then $65/month
 * - Referrer: Gets 1 free month added to their subscription
 * - Limit: 10 redemptions per code
 */

import { sql } from './db';
import crypto from 'crypto';

export interface ReferralCode {
  id: string;
  code: string;
  ownerUserId: string;
  usesRemaining: number;
  createdAt: Date;
}

export interface ReferralStats {
  code: string | null;
  totalRedemptions: number;
  usesRemaining: number;
  bonusMonthsEarned: number;
}

/**
 * Generate a unique referral code for a user
 * Returns existing code if user already has one
 */
export async function generateReferralCode(userId: string): Promise<ReferralCode> {
  // Check if user already has a code
  const existing = await sql`
    SELECT id, code, owner_user_id, uses_remaining, created_at
    FROM referral_codes
    WHERE owner_user_id = ${userId}
  `;

  if (existing.length > 0) {
    return {
      id: existing[0].id,
      code: existing[0].code,
      ownerUserId: existing[0].owner_user_id,
      usesRemaining: existing[0].uses_remaining,
      createdAt: existing[0].created_at,
    };
  }

  // Generate new code (8 alphanumeric characters)
  const code = generateUniqueCode();

  const rows = await sql`
    INSERT INTO referral_codes (code, owner_user_id, uses_remaining)
    VALUES (${code}, ${userId}, 10)
    RETURNING id, code, owner_user_id, uses_remaining, created_at
  `;

  return {
    id: rows[0].id,
    code: rows[0].code,
    ownerUserId: rows[0].owner_user_id,
    usesRemaining: rows[0].uses_remaining,
    createdAt: rows[0].created_at,
  };
}

/**
 * Validate a referral code
 * Returns the code details if valid, null if invalid or exhausted
 */
export async function validateReferralCode(
  code: string
): Promise<{ valid: boolean; codeId?: string; ownerUserId?: string; error?: string }> {
  const rows = await sql`
    SELECT id, owner_user_id, uses_remaining
    FROM referral_codes
    WHERE code = ${code.toUpperCase()}
  `;

  if (rows.length === 0) {
    return { valid: false, error: 'Invalid referral code' };
  }

  if (rows[0].uses_remaining <= 0) {
    return { valid: false, error: 'Referral code has been fully used' };
  }

  return {
    valid: true,
    codeId: rows[0].id,
    ownerUserId: rows[0].owner_user_id,
  };
}

/**
 * Redeem a referral code for a new user
 * - Marks new user's subscription for referral pricing
 * - Grants referrer 1 bonus month
 * - Decrements uses remaining
 */
export async function redeemReferralCode(
  code: string,
  newUserId: string
): Promise<{ success: boolean; error?: string }> {
  const validation = await validateReferralCode(code);

  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const { codeId, ownerUserId } = validation;

  // Prevent self-referral
  if (ownerUserId === newUserId) {
    return { success: false, error: 'Cannot use your own referral code' };
  }

  // Check if user already used a referral code
  const existingRedemption = await sql`
    SELECT id FROM referral_redemptions
    WHERE redeemed_by_user_id = ${newUserId}
  `;

  if (existingRedemption.length > 0) {
    return { success: false, error: 'You have already used a referral code' };
  }

  try {
    // Decrement uses remaining
    await sql`
      UPDATE referral_codes
      SET uses_remaining = uses_remaining - 1
      WHERE id = ${codeId} AND uses_remaining > 0
    `;

    // Record the redemption
    await sql`
      INSERT INTO referral_redemptions (code_id, redeemed_by_user_id, rewarded_to_user_id)
      VALUES (${codeId}, ${newUserId}, ${ownerUserId})
    `;

    // Mark new user's subscription for referral pricing (2 months at $45)
    await sql`
      UPDATE subscriptions
      SET referred_by_code = ${code.toUpperCase()}, referral_months_remaining = 2
      WHERE user_id = ${newUserId}
    `;

    // Grant referrer 1 bonus month
    await sql`
      UPDATE subscriptions
      SET bonus_months = bonus_months + 1
      WHERE user_id = ${ownerUserId}
    `;

    return { success: true };
  } catch (error) {
    console.error('Failed to redeem referral code:', error);
    return { success: false, error: 'Failed to apply referral code' };
  }
}

/**
 * Get referral stats for a user
 */
export async function getReferralStats(userId: string): Promise<ReferralStats> {
  // Get user's referral code
  const codeRows = await sql`
    SELECT code, uses_remaining
    FROM referral_codes
    WHERE owner_user_id = ${userId}
  `;

  // Count total redemptions
  const redemptionRows = await sql`
    SELECT COUNT(*) as count
    FROM referral_redemptions
    WHERE rewarded_to_user_id = ${userId}
  `;

  // Get bonus months earned
  const bonusRows = await sql`
    SELECT bonus_months
    FROM subscriptions
    WHERE user_id = ${userId}
  `;

  return {
    code: codeRows.length > 0 ? codeRows[0].code : null,
    totalRedemptions: parseInt(redemptionRows[0]?.count || '0', 10),
    usesRemaining: codeRows.length > 0 ? codeRows[0].uses_remaining : 0,
    bonusMonthsEarned: bonusRows.length > 0 ? bonusRows[0].bonus_months : 0,
  };
}

/**
 * Check if a user has referral months remaining (for Stripe pricing)
 */
export async function hasReferralPricing(userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT referral_months_remaining
    FROM subscriptions
    WHERE user_id = ${userId}
  `;

  return rows.length > 0 && rows[0].referral_months_remaining > 0;
}

/**
 * Decrement referral months (called after successful Stripe invoice.paid)
 * Returns true if user should be upgraded to regular price
 */
export async function decrementReferralMonths(userId: string): Promise<boolean> {
  const rows = await sql`
    UPDATE subscriptions
    SET referral_months_remaining = GREATEST(0, referral_months_remaining - 1)
    WHERE user_id = ${userId}
    RETURNING referral_months_remaining
  `;

  // If now at 0, user should be upgraded to regular price
  return rows.length > 0 && rows[0].referral_months_remaining === 0;
}

/**
 * Generate a unique 8-character alphanumeric code
 */
function generateUniqueCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars: I, O, 0, 1
  let code = '';

  const randomBytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[randomBytes[i] % chars.length];
  }

  return code;
}
