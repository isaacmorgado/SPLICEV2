/**
 * API Key Management System
 * Allows users to securely store and manage their own API keys (BYOK)
 * Uses encryption at rest for security
 */

import { getSql } from './db.js';
import crypto from 'crypto';

export type ApiKeyService = 'openai' | 'elevenlabs' | 'gemini' | 'groq';

export interface UserApiKey {
  id: string;
  userId: string;
  service: ApiKeyService;
  keyName?: string;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
}

export interface StoredApiKey extends UserApiKey {
  maskedKey: string; // Last 4 characters for display
}

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
// AUTH_TAG_LENGTH is 16 bytes as per AES-GCM standard (used internally by crypto)

/**
 * Get encryption key from environment
 * In production, this should be a secure, randomly generated key
 */
function getEncryptionKey(): Buffer {
  const key = process.env.API_KEY_ENCRYPTION_SECRET || process.env.JWT_SECRET;
  if (!key) {
    throw new Error('Encryption key not configured');
  }
  // Derive a 256-bit key from the secret
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt an API key for storage
 */
export function encryptApiKey(apiKey: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an API key from storage
 */
export function decryptApiKey(encryptedData: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

  if (!ivHex || !authTagHex || !encrypted) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Mask API key for safe display (show only last 4 chars)
 */
function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) {
    return '****';
  }
  return '***' + apiKey.slice(-4);
}

/**
 * Store a user's API key (encrypted)
 */
export async function storeUserApiKey(
  userId: string,
  service: ApiKeyService,
  apiKey: string,
  keyName?: string
): Promise<StoredApiKey> {
  const sql = await getSql();
  const encrypted = encryptApiKey(apiKey);

  const rows = await sql`
    INSERT INTO user_api_keys (user_id, service, encrypted_key, key_name)
    VALUES (${userId}, ${service}, ${encrypted}, ${keyName ?? null})
    ON CONFLICT (user_id, service)
    DO UPDATE SET
      encrypted_key = EXCLUDED.encrypted_key,
      key_name = EXCLUDED.key_name,
      updated_at = NOW()
    RETURNING id, user_id, service, key_name, created_at, updated_at, last_used_at
  `;

  const row = rows[0] as {
    id: string;
    user_id: string;
    service: string;
    key_name: string | null;
    created_at: Date;
    updated_at: Date;
    last_used_at: Date | null;
  };

  return {
    id: row.id,
    userId: row.user_id,
    service: row.service as ApiKeyService,
    keyName: row.key_name ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
    maskedKey: maskApiKey(apiKey),
  };
}

/**
 * Get a user's API key (decrypted)
 */
export async function getUserApiKey(
  userId: string,
  service: ApiKeyService
): Promise<string | null> {
  const sql = await getSql();
  const rows = await sql`
    SELECT encrypted_key
    FROM user_api_keys
    WHERE user_id = ${userId} AND service = ${service}
  `;

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0] as { encrypted_key: string };

  try {
    return decryptApiKey(row.encrypted_key);
  } catch (error) {
    console.error('Failed to decrypt API key:', error);
    return null;
  }
}

/**
 * List all API keys for a user (masked, not decrypted)
 */
export async function listUserApiKeys(userId: string): Promise<StoredApiKey[]> {
  const sql = await getSql();
  const rows = await sql`
    SELECT id, user_id, service, encrypted_key, key_name, created_at, updated_at, last_used_at
    FROM user_api_keys
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;

  return rows.map((row) => {
    const typedRow = row as {
      id: string;
      user_id: string;
      service: string;
      encrypted_key: string;
      key_name: string | null;
      created_at: Date;
      updated_at: Date;
      last_used_at: Date | null;
    };

    // Decrypt just to get last 4 chars for masking
    let maskedKey = '****';
    try {
      const decrypted = decryptApiKey(typedRow.encrypted_key);
      maskedKey = maskApiKey(decrypted);
    } catch {
      // Ignore decryption errors for listing
    }

    return {
      id: typedRow.id,
      userId: typedRow.user_id,
      service: typedRow.service as ApiKeyService,
      keyName: typedRow.key_name ?? undefined,
      createdAt: typedRow.created_at,
      updatedAt: typedRow.updated_at,
      lastUsedAt: typedRow.last_used_at ?? undefined,
      maskedKey,
    };
  });
}

/**
 * Delete a user's API key
 */
export async function deleteUserApiKey(userId: string, service: ApiKeyService): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql`
    DELETE FROM user_api_keys
    WHERE user_id = ${userId} AND service = ${service}
    RETURNING id
  `;

  return rows.length > 0;
}

/**
 * Update last used timestamp for tracking
 */
export async function updateApiKeyLastUsed(userId: string, service: ApiKeyService): Promise<void> {
  const sql = await getSql();
  await sql`
    UPDATE user_api_keys
    SET last_used_at = NOW()
    WHERE user_id = ${userId} AND service = ${service}
  `;
}

/**
 * Validate API key format before storage
 */
export function validateApiKeyFormat(
  service: ApiKeyService,
  apiKey: string
): { valid: boolean; error?: string } {
  if (!apiKey || apiKey.trim().length === 0) {
    return { valid: false, error: 'API key cannot be empty' };
  }

  // Service-specific validation
  switch (service) {
    case 'openai':
      if (!apiKey.startsWith('sk-')) {
        return { valid: false, error: 'OpenAI API keys must start with "sk-"' };
      }
      if (apiKey.length < 20) {
        return { valid: false, error: 'OpenAI API key appears too short' };
      }
      break;

    case 'elevenlabs':
      if (apiKey.length < 20) {
        return { valid: false, error: 'ElevenLabs API key appears too short' };
      }
      break;

    case 'gemini':
      if (apiKey.length < 20) {
        return { valid: false, error: 'Gemini API key appears too short' };
      }
      break;

    case 'groq':
      if (!apiKey.startsWith('gsk_')) {
        return { valid: false, error: 'Groq API keys must start with "gsk_"' };
      }
      if (apiKey.length < 20) {
        return { valid: false, error: 'Groq API key appears too short' };
      }
      break;

    default:
      return { valid: false, error: 'Unknown service type' };
  }

  return { valid: true };
}
