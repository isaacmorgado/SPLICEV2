/**
 * Referral Code System
 *
 * - Each user gets one referral code (generated on demand)
 * - New user with code: $45/month for first 2 months, then $65/month
 * - Referrer: Gets 1 free month added to their subscription
 * - Limit: 10 redemptions per code
 */

import { getSql } from './db';
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

interface ReferralCodeRow {
  id: string;
  code: string;
  owner_user_id: string;
  uses_remaining: number;
  created_at: Date;
}

/**
 * Generate a unique referral code for a user
 * Returns existing code if user already has one
 */
export async function generateReferralCode(userId: string): Promise<ReferralCode> {
  const sql = await getSql();

  // Check if user already has a code
  const existing = await sql`
    SELECT id, code, owner_user_id, uses_remaining, created_at
    FROM referral_codes
    WHERE owner_user_id = ${userId}
  `;

  if (existing.length > 0) {
    const row = existing[0] as ReferralCodeRow;
    return {
      id: row.id,
      code: row.code,
      ownerUserId: row.owner_user_id,
      usesRemaining: row.uses_remaining,
      createdAt: row.created_at,
    };
  }

  // Generate new code (8 alphanumeric characters)
  const code = generateUniqueCode();

  const rows = await sql`
    INSERT INTO referral_codes (code, owner_user_id, uses_remaining)
    VALUES (${code}, ${userId}, 10)
    RETURNING id, code, owner_user_id, uses_remaining, created_at
  `;

  const row = rows[0] as ReferralCodeRow;
  return {
    id: row.id,
    code: row.code,
    ownerUserId: row.owner_user_id,
    usesRemaining: row.uses_remaining,
    createdAt: row.created_at,
  };
}

/**
 * Validate a referral code
 * Returns the code details if valid, null if invalid or exhausted
 */
export async function validateReferralCode(
  code: string
): Promise<{ valid: boolean; codeId?: string; ownerUserId?: string; error?: string }> {
  const sql = await getSql();
  const rows = await sql`
    SELECT id, owner_user_id, uses_remaining
    FROM referral_codes
    WHERE code = ${code.toUpperCase()}
  `;

  if (rows.length === 0) {
    return { valid: false, error: 'Invalid referral code' };
  }

  const row = rows[0] as { id: string; owner_user_id: string; uses_remaining: number };

  if (row.uses_remaining <= 0) {
    return { valid: false, error: 'Referral code has been fully used' };
  }

  return {
    valid: true,
    codeId: row.id,
    ownerUserId: row.owner_user_id,
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

  const sql = await getSql();

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
  const sql = await getSql();

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

  const codeRow = codeRows[0] as { code: string; uses_remaining: number } | undefined;
  const redemptionRow = redemptionRows[0] as { count: string } | undefined;
  const bonusRow = bonusRows[0] as { bonus_months: number } | undefined;

  return {
    code: codeRow?.code ?? null,
    totalRedemptions: parseInt(redemptionRow?.count || '0', 10),
    usesRemaining: codeRow?.uses_remaining ?? 0,
    bonusMonthsEarned: bonusRow?.bonus_months ?? 0,
  };
}

/**
 * Check if a user has referral months remaining (for Stripe pricing)
 */
export async function hasReferralPricing(userId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql`
    SELECT referral_months_remaining
    FROM subscriptions
    WHERE user_id = ${userId}
  `;

  const row = rows[0] as { referral_months_remaining: number } | undefined;
  return row !== undefined && row.referral_months_remaining > 0;
}

/**
 * Decrement referral months (called after successful Stripe invoice.paid)
 * Returns true if user should be upgraded to regular price
 */
export async function decrementReferralMonths(userId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql`
    UPDATE subscriptions
    SET referral_months_remaining = GREATEST(0, referral_months_remaining - 1)
    WHERE user_id = ${userId}
    RETURNING referral_months_remaining
  `;

  const row = rows[0] as { referral_months_remaining: number } | undefined;
  // If now at 0, user should be upgraded to regular price
  return row !== undefined && row.referral_months_remaining === 0;
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
