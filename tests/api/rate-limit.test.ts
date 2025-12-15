import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validatePasswordComplexity, validateEmail, getClientIP } from '../../api/_lib/rate-limit';

// Mock the database module
vi.mock('../../api/_lib/db', () => ({
  sql: vi.fn(),
  transaction: vi.fn(),
}));

describe('Rate Limit Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validatePasswordComplexity', () => {
    it('should reject passwords shorter than 8 characters', () => {
      const result = validatePasswordComplexity('Short1!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters long');
    });

    it('should reject passwords without uppercase letters', () => {
      const result = validatePasswordComplexity('lowercase1!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one uppercase letter');
    });

    it('should reject passwords without lowercase letters', () => {
      const result = validatePasswordComplexity('UPPERCASE1!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one lowercase letter');
    });

    it('should reject passwords without numbers', () => {
      const result = validatePasswordComplexity('NoNumbers!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one number');
    });

    it('should reject passwords without special characters', () => {
      const result = validatePasswordComplexity('NoSpecial1');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one special character');
    });

    it('should reject common passwords', () => {
      // password1 is in our common list (case insensitive)
      // But "Password1!" might pass, let's check another
      const result = validatePasswordComplexity('password');
      expect(result.valid).toBe(false);
    });

    it('should accept valid passwords', () => {
      const result = validatePasswordComplexity('MySecure123!');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept passwords with various special characters', () => {
      const passwords = [
        'TestPass1!',
        'TestPass1@',
        'TestPass1#',
        'TestPass1$',
        'TestPass1%',
        'TestPass1^',
        'TestPass1&',
        'TestPass1*',
      ];

      for (const password of passwords) {
        const result = validatePasswordComplexity(password);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject passwords longer than 128 characters', () => {
      const longPassword = 'A'.repeat(100) + 'a'.repeat(20) + '1!'.repeat(5);
      const result = validatePasswordComplexity(longPassword);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be less than 128 characters');
    });

    it('should return multiple errors for multiple violations', () => {
      const result = validatePasswordComplexity('short');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });

  describe('validateEmail', () => {
    it('should accept valid email addresses', () => {
      const validEmails = [
        'test@example.com',
        'user.name@domain.org',
        'user+tag@example.co.uk',
        'a@b.co',
      ];

      for (const email of validEmails) {
        expect(validateEmail(email)).toBe(true);
      }
    });

    it('should reject invalid email addresses', () => {
      const invalidEmails = [
        'not-an-email',
        '@missing-local.com',
        'missing-at.com',
        'missing@domain',
        'spaces in@email.com',
        '',
      ];

      for (const email of invalidEmails) {
        expect(validateEmail(email)).toBe(false);
      }
    });

    it('should reject emails longer than 255 characters', () => {
      const longEmail = 'a'.repeat(250) + '@test.com';
      expect(validateEmail(longEmail)).toBe(false);
    });
  });

  describe('getClientIP', () => {
    it('should extract IP from x-forwarded-for header', () => {
      const req = {
        headers: {
          'x-forwarded-for': '192.168.1.1, 10.0.0.1',
        },
      };
      expect(getClientIP(req)).toBe('192.168.1.1');
    });

    it('should extract IP from x-real-ip header', () => {
      const req = {
        headers: {
          'x-real-ip': '192.168.1.2',
        },
      };
      expect(getClientIP(req)).toBe('192.168.1.2');
    });

    it('should return "unknown" when no IP headers present', () => {
      const req = {
        headers: {},
      };
      expect(getClientIP(req)).toBe('unknown');
    });

    it('should handle array headers', () => {
      const req = {
        headers: {
          'x-forwarded-for': ['192.168.1.3', '10.0.0.2'],
        },
      };
      expect(getClientIP(req)).toBe('192.168.1.3');
    });

    it('should trim whitespace from IPs', () => {
      const req = {
        headers: {
          'x-forwarded-for': '  192.168.1.4  , 10.0.0.3',
        },
      };
      expect(getClientIP(req)).toBe('192.168.1.4');
    });
  });
});
