import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module - using inline functions to avoid hoisting issues
vi.mock('../../lib/db', () => ({
  sql: vi.fn(),
  transaction: vi.fn(),
  getSubscriptionByUserId: vi.fn(),
}));

vi.mock('../../lib/stripe', () => ({
  TIERS: {
    free: { monthlyMinutes: 30 },
    pro: { monthlyMinutes: 300 },
    studio: { monthlyMinutes: 1000 },
  },
}));

// Import after mocking
import { getSubscriptionByUserId, transaction } from '../../lib/db';
import { checkUsage, hasEnoughMinutes, estimateMinutes, trackUsage } from '../../lib/usage';

describe('Usage Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkUsage', () => {
    it('should return allowed=false when no subscription exists', async () => {
      vi.mocked(getSubscriptionByUserId).mockResolvedValue(null as any);

      const result = await checkUsage('user-123');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.limit).toBe(0);
      expect(result.tier).toBe('none');
    });

    it('should calculate remaining minutes for free tier', async () => {
      vi.mocked(getSubscriptionByUserId).mockResolvedValue({
        tier: 'free',
        minutes_used: 10,
      });

      const result = await checkUsage('user-123');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(20); // 30 - 10
      expect(result.limit).toBe(30);
      expect(result.used).toBe(10);
      expect(result.tier).toBe('free');
    });

    it('should calculate remaining minutes for pro tier', async () => {
      vi.mocked(getSubscriptionByUserId).mockResolvedValue({
        tier: 'pro',
        minutes_used: 50,
      });

      const result = await checkUsage('user-123');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(250); // 300 - 50
      expect(result.limit).toBe(300);
      expect(result.tier).toBe('pro');
    });

    it('should return allowed=false when minutes are exhausted', async () => {
      vi.mocked(getSubscriptionByUserId).mockResolvedValue({
        tier: 'free',
        minutes_used: 35, // over limit
      });

      const result = await checkUsage('user-123');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should handle missing minutes_used gracefully', async () => {
      vi.mocked(getSubscriptionByUserId).mockResolvedValue({
        tier: 'pro',
        minutes_used: null,
      });

      const result = await checkUsage('user-123');

      expect(result.used).toBe(0);
      expect(result.remaining).toBe(300);
    });
  });

  describe('hasEnoughMinutes', () => {
    it('should return true when user has enough minutes', async () => {
      vi.mocked(getSubscriptionByUserId).mockResolvedValue({
        tier: 'pro',
        minutes_used: 100,
      });

      const result = await hasEnoughMinutes('user-123', 50);

      expect(result).toBe(true);
    });

    it('should return false when user does not have enough minutes', async () => {
      vi.mocked(getSubscriptionByUserId).mockResolvedValue({
        tier: 'free',
        minutes_used: 25,
      });

      const result = await hasEnoughMinutes('user-123', 10);

      expect(result).toBe(false); // Only 5 remaining, need 10
    });

    it('should return false when exactly at limit', async () => {
      vi.mocked(getSubscriptionByUserId).mockResolvedValue({
        tier: 'free',
        minutes_used: 30,
      });

      const result = await hasEnoughMinutes('user-123', 1);

      expect(result).toBe(false);
    });
  });

  describe('estimateMinutes', () => {
    it('should estimate voice isolation at 1:1 ratio', async () => {
      const result = await estimateMinutes('voice_isolation', 120); // 2 minutes
      expect(result).toBe(2);
    });

    it('should estimate transcription at 0.5:1 ratio', async () => {
      const result = await estimateMinutes('transcription', 120); // 2 minutes
      expect(result).toBe(1); // ceil(2 * 0.5)
    });

    it('should estimate take_analysis at 0.1:1 ratio', async () => {
      const result = await estimateMinutes('take_analysis', 600); // 10 minutes
      expect(result).toBe(1); // ceil(10 * 0.1)
    });

    it('should round up partial minutes', async () => {
      const result = await estimateMinutes('voice_isolation', 90); // 1.5 minutes
      expect(result).toBe(2); // ceil(1.5)
    });

    it('should handle default feature type', async () => {
      // @ts-expect-error - testing unknown feature
      const result = await estimateMinutes('unknown_feature', 120);
      expect(result).toBe(2);
    });
  });

  describe('trackUsage (transactional)', () => {
    it('should execute both operations in a transaction', async () => {
      vi.mocked(getSubscriptionByUserId).mockResolvedValue({
        tier: 'pro',
        minutes_used: 100,
      } as any);

      let transactionCalled = false;
      vi.mocked(transaction).mockImplementation(async (callback: any) => {
        transactionCalled = true;
        const mockTxSql = vi.fn().mockResolvedValue([]);
        await callback(mockTxSql as any);
        return undefined;
      });

      await trackUsage('user-123', 'transcription', 5);

      expect(transactionCalled).toBe(true);
    });

    it('should return current usage after successful transaction', async () => {
      // The function will call getSubscriptionByUserId after the transaction completes
      vi.mocked(getSubscriptionByUserId).mockResolvedValue({
        tier: 'pro',
        minutes_used: 105, // Updated after transaction
      } as any);

      vi.mocked(transaction).mockImplementation(async (callback: any) => {
        const mockTxSql = vi.fn().mockResolvedValue([]);
        await callback(mockTxSql as any);
        return undefined;
      });

      const result = await trackUsage('user-123', 'transcription', 5);

      // Transaction should have been called
      expect(transaction).toHaveBeenCalled();
      // Result reflects the updated usage
      expect(result.used).toBe(105);
    });
  });
});

describe('Usage Estimation', () => {
  describe('Feature-specific rates', () => {
    it('should use different rates for different features', async () => {
      const durationSeconds = 300; // 5 minutes

      const voiceIsolation = await estimateMinutes('voice_isolation', durationSeconds);
      const transcription = await estimateMinutes('transcription', durationSeconds);
      const takeAnalysis = await estimateMinutes('take_analysis', durationSeconds);

      // Voice isolation is 1:1
      expect(voiceIsolation).toBe(5);

      // Transcription is 0.5:1
      expect(transcription).toBe(3); // ceil(5 * 0.5) = ceil(2.5) = 3

      // Take analysis is 0.1:1
      expect(takeAnalysis).toBe(1); // ceil(5 * 0.1) = ceil(0.5) = 1
    });
  });

  describe('Edge cases', () => {
    it('should handle very short durations', async () => {
      const result = await estimateMinutes('transcription', 1); // 1 second
      expect(result).toBe(1); // Minimum of 1 minute
    });

    it('should handle very long durations', async () => {
      const result = await estimateMinutes('voice_isolation', 36000); // 10 hours = 600 minutes
      expect(result).toBe(600);
    });
  });
});
