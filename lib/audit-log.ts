/**
 * Audit Logging System
 * Tracks important security and business events
 */

import { getSql } from './db.js';
import type { VercelRequest } from '@vercel/node';

export type AuditEventType =
  | 'user.login'
  | 'user.logout'
  | 'user.register'
  | 'user.password_changed'
  | 'user.password_reset_requested'
  | 'user.password_reset_completed'
  | 'user.email_changed'
  | 'user.api_key_created'
  | 'user.api_key_deleted'
  | 'subscription.created'
  | 'subscription.upgraded'
  | 'subscription.downgraded'
  | 'subscription.canceled'
  | 'subscription.trial_started'
  | 'subscription.trial_expired'
  | 'referral.code_generated'
  | 'referral.code_redeemed'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'admin.user_accessed'
  | 'admin.user_modified'
  | 'security.account_locked'
  | 'security.suspicious_activity';

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  eventType: AuditEventType;
  eventData: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

/**
 * Get client IP and user agent from request
 */
function getRequestMetadata(req?: VercelRequest): { ip: string; userAgent: string } {
  if (!req) {
    return { ip: 'system', userAgent: 'system' };
  }

  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]).trim()
    : 'unknown';

  const userAgent = req.headers['user-agent'] || 'unknown';

  return { ip, userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent };
}

/**
 * Log an audit event
 */
export async function logAuditEvent(
  eventType: AuditEventType,
  userId: string | null,
  eventData?: Record<string, unknown>,
  req?: VercelRequest
): Promise<void> {
  try {
    const sql = await getSql();
    const { ip, userAgent } = getRequestMetadata(req);

    await sql`
      INSERT INTO audit_logs (user_id, event_type, event_data, ip_address, user_agent)
      VALUES (
        ${userId},
        ${eventType},
        ${eventData ? JSON.stringify(eventData) : null},
        ${ip},
        ${userAgent}
      )
    `;
  } catch (error) {
    // Don't fail the main operation if audit logging fails
    console.error('Failed to log audit event:', error);
  }
}

/**
 * Get audit logs for a user
 */
export async function getUserAuditLogs(
  userId: string,
  limit = 50,
  offset = 0
): Promise<AuditLogEntry[]> {
  const sql = await getSql();

  const rows = await sql`
    SELECT id, user_id, event_type, event_data, ip_address, user_agent, created_at
    FROM audit_logs
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return rows.map((row) => {
    const typedRow = row as {
      id: string;
      user_id: string | null;
      event_type: string;
      event_data: Record<string, unknown> | null;
      ip_address: string | null;
      user_agent: string | null;
      created_at: Date;
    };

    return {
      id: typedRow.id,
      userId: typedRow.user_id,
      eventType: typedRow.event_type as AuditEventType,
      eventData: typedRow.event_data,
      ipAddress: typedRow.ip_address,
      userAgent: typedRow.user_agent,
      createdAt: typedRow.created_at,
    };
  });
}

/**
 * Get recent security events (for monitoring)
 */
export async function getRecentSecurityEvents(limit = 100): Promise<AuditLogEntry[]> {
  const sql = await getSql();

  const rows = await sql`
    SELECT id, user_id, event_type, event_data, ip_address, user_agent, created_at
    FROM audit_logs
    WHERE event_type LIKE 'security.%'
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => {
    const typedRow = row as {
      id: string;
      user_id: string | null;
      event_type: string;
      event_data: Record<string, unknown> | null;
      ip_address: string | null;
      user_agent: string | null;
      created_at: Date;
    };

    return {
      id: typedRow.id,
      userId: typedRow.user_id,
      eventType: typedRow.event_type as AuditEventType,
      eventData: typedRow.event_data,
      ipAddress: typedRow.ip_address,
      userAgent: typedRow.user_agent,
      createdAt: typedRow.created_at,
    };
  });
}

/**
 * Clean up old audit logs (keep last 90 days)
 */
export async function cleanupOldAuditLogs(daysToKeep = 90): Promise<number> {
  const sql = await getSql();

  const rows = await sql`
    DELETE FROM audit_logs
    WHERE created_at < NOW() - INTERVAL '${daysToKeep} days'
    RETURNING id
  `;

  return rows.length;
}
