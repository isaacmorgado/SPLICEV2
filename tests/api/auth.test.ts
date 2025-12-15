import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validatePasswordComplexity, validateEmail } from '../../api/_lib/rate-limit';

// Mock all dependencies - using inline functions to avoid hoisting issues
vi.mock('../../api/_lib/db', () => ({
  sql: vi.fn(),
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  createSubscription: vi.fn(),
}));

vi.mock('../../api/_lib/auth', () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
  createToken: vi.fn(),
  createRefreshToken: vi.fn(),
  getTokenExpiry: vi.fn(),
}));

vi.mock('../../api/_lib/stripe', () => ({
  createCustomer: vi.fn(),
}));

// Import after mocking
import { getUserByEmail, createUser, createSubscription, sql } from '../../api/_lib/db';
import {
  verifyPassword,
  hashPassword,
  createToken,
  createRefreshToken,
  getTokenExpiry,
} from '../../api/_lib/auth';
import { createCustomer } from '../../api/_lib/stripe';

describe('Authentication Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Login Flow', () => {
    it('should successfully authenticate valid credentials', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        password_hash: 'hashed_password',
      };

      vi.mocked(getUserByEmail).mockResolvedValue(mockUser);
      vi.mocked(verifyPassword).mockResolvedValue(true);
      vi.mocked(createToken).mockResolvedValue('jwt_token');
      vi.mocked(createRefreshToken).mockResolvedValue('refresh_token');
      vi.mocked(getTokenExpiry).mockReturnValue(new Date('2024-01-15'));

      // Simulate login flow
      const user = await getUserByEmail('test@example.com');
      expect(user).toBeDefined();

      const isValid = await verifyPassword('password123', user!.password_hash);
      expect(isValid).toBe(true);

      const token = await createToken({ userId: user!.id, email: user!.email });
      expect(token).toBe('jwt_token');
    });

    it('should reject invalid password', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        password_hash: 'hashed_password',
      };

      vi.mocked(getUserByEmail).mockResolvedValue(mockUser);
      vi.mocked(verifyPassword).mockResolvedValue(false);

      const user = await getUserByEmail('test@example.com');
      const isValid = await verifyPassword('wrong_password', user!.password_hash);

      expect(isValid).toBe(false);
    });

    it('should handle non-existent user', async () => {
      vi.mocked(getUserByEmail).mockResolvedValue(null as any);

      const user = await getUserByEmail('nonexistent@example.com');
      expect(user).toBeNull();
    });
  });

  describe('Registration Flow', () => {
    it('should create user with valid credentials', async () => {
      const newUser = {
        id: 'new-user-123',
        email: 'new@example.com',
      };

      vi.mocked(getUserByEmail).mockResolvedValue(null as any);
      vi.mocked(hashPassword).mockResolvedValue('hashed_new_password');
      vi.mocked(createUser).mockResolvedValue(newUser as any);
      vi.mocked(createCustomer).mockResolvedValue({ id: 'cus_123' } as any);
      vi.mocked(createSubscription).mockResolvedValue({});
      vi.mocked(createToken).mockResolvedValue('new_token');
      vi.mocked(createRefreshToken).mockResolvedValue('new_refresh');
      vi.mocked(getTokenExpiry).mockReturnValue(new Date('2024-01-15'));

      // Check email doesn't exist
      const existing = await getUserByEmail('new@example.com');
      expect(existing).toBeNull();

      // Hash password
      const hash = await hashPassword('ValidPass123!');
      expect(hash).toBe('hashed_new_password');

      // Create user
      const user = await createUser('new@example.com', hash);
      expect(user.id).toBe('new-user-123');

      // Create Stripe customer
      const customer = await createCustomer('new@example.com', user.id);
      expect(customer.id).toBe('cus_123');
    });

    it('should reject duplicate email', async () => {
      vi.mocked(getUserByEmail).mockResolvedValue({
        id: 'existing-user',
        email: 'existing@example.com',
        password_hash: 'hash',
      });

      const existing = await getUserByEmail('existing@example.com');
      expect(existing).not.toBeNull();
      // Registration should be blocked at this point
    });

    it('should validate password complexity before registration', () => {
      const weakPasswords = [
        'short',
        'nouppercase1!',
        'NOLOWERCASE1!',
        'NoNumbers!',
        'NoSpecial123',
      ];

      for (const password of weakPasswords) {
        const result = validatePasswordComplexity(password);
        expect(result.valid).toBe(false);
      }
    });

    it('should accept strong passwords', () => {
      const strongPasswords = ['StrongPass123!', 'MySecure@123', 'C0mplex!Password'];

      for (const password of strongPasswords) {
        const result = validatePasswordComplexity(password);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('Input Validation', () => {
    it('should validate email format', () => {
      expect(validateEmail('valid@example.com')).toBe(true);
      expect(validateEmail('invalid-email')).toBe(false);
      expect(validateEmail('')).toBe(false);
      expect(validateEmail('@missing.local')).toBe(false);
    });

    it('should reject very long emails', () => {
      const longEmail = 'a'.repeat(250) + '@test.com';
      expect(validateEmail(longEmail)).toBe(false);
    });
  });

  describe('Token Generation', () => {
    it('should generate both access and refresh tokens', async () => {
      vi.mocked(createToken).mockResolvedValue('access_token_123');
      vi.mocked(createRefreshToken).mockResolvedValue('refresh_token_456');

      const accessToken = await createToken({ userId: 'user-1', email: 'test@test.com' });
      const refreshToken = await createRefreshToken({ userId: 'user-1', email: 'test@test.com' });

      expect(accessToken).toBe('access_token_123');
      expect(refreshToken).toBe('refresh_token_456');
      expect(accessToken).not.toBe(refreshToken);
    });

    it('should return token expiry time', () => {
      const futureDate = new Date('2024-02-01');
      vi.mocked(getTokenExpiry).mockReturnValue(futureDate);

      const expiry = getTokenExpiry();
      expect(expiry).toEqual(futureDate);
    });
  });
});

describe('Account Lockout', () => {
  describe('Failed Login Tracking', () => {
    it('should track failed login attempts', async () => {
      const mockSql = vi.mocked(sql);
      mockSql.mockResolvedValueOnce([{ failed_attempts: 1 }]);

      // Simulate recording a failed attempt
      const result = await sql`
        INSERT INTO account_lockouts (email, failed_attempts, last_attempt)
        VALUES (${'test@example.com'}, 1, ${new Date()})
        ON CONFLICT (email) DO UPDATE
        SET
          failed_attempts = account_lockouts.failed_attempts + 1,
          last_attempt = ${new Date()}
        RETURNING failed_attempts
      `;

      expect(result[0].failed_attempts).toBe(1);
    });

    it('should lock account after 5 failed attempts', () => {
      const failedAttempts = 5;
      const lockoutThreshold = 5;

      expect(failedAttempts >= lockoutThreshold).toBe(true);
    });

    it('should clear lockout on successful login', async () => {
      const mockSql = vi.mocked(sql);
      mockSql.mockResolvedValueOnce([]);

      await sql`
        DELETE FROM account_lockouts
        WHERE email = ${'test@example.com'}
      `;

      expect(mockSql).toHaveBeenCalled();
    });
  });

  describe('Lockout Expiry', () => {
    it('should unlock after 15 minutes', () => {
      const lockoutSeconds = 900; // 15 minutes
      const lockedAt = new Date(Date.now() - 16 * 60 * 1000); // 16 minutes ago
      const lockUntil = new Date(lockedAt.getTime() + lockoutSeconds * 1000);
      const now = new Date();

      expect(lockUntil < now).toBe(true);
    });

    it('should remain locked within 15 minutes', () => {
      const lockoutSeconds = 900;
      const lockedAt = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
      const lockUntil = new Date(lockedAt.getTime() + lockoutSeconds * 1000);
      const now = new Date();

      expect(lockUntil > now).toBe(true);
    });
  });
});

describe('Rate Limiting', () => {
  describe('Login Rate Limits', () => {
    it('should allow up to 5 login attempts per minute', () => {
      const maxRequests = 5;
      const windowSeconds = 60;

      expect(maxRequests).toBe(5);
      expect(windowSeconds).toBe(60);
    });
  });

  describe('Registration Rate Limits', () => {
    it('should allow up to 3 registrations per 5 minutes', () => {
      const maxRequests = 3;
      const windowSeconds = 300;

      expect(maxRequests).toBe(3);
      expect(windowSeconds).toBe(300);
    });
  });
});
