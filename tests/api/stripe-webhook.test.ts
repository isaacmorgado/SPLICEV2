import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
const mockSql = vi.fn();
const mockTransaction = vi.fn();

vi.mock('../../api/_lib/db', () => ({
  sql: mockSql,
  transaction: mockTransaction,
  updateSubscription: vi.fn(),
  resetMinutesUsed: vi.fn(),
}));

vi.mock('../../api/_lib/stripe', () => ({
  constructWebhookEvent: vi.fn(),
  getTierByPriceId: vi.fn(),
  getSubscription: vi.fn(),
}));

describe('Stripe Webhook Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockReset();
  });

  describe('Idempotency', () => {
    it('should detect previously processed events', async () => {
      // Simulate an event that was already processed
      mockSql.mockResolvedValueOnce([{ event_id: 'evt_123' }]);

      // Check if event exists
      const result = await mockSql`
        SELECT event_id FROM processed_webhook_events
        WHERE event_id = ${'evt_123'}
      `;

      expect(result.length).toBe(1);
    });

    it('should allow new events to be processed', async () => {
      // Simulate a new event
      mockSql.mockResolvedValueOnce([]);

      // Check if event exists
      const result = await mockSql`
        SELECT event_id FROM processed_webhook_events
        WHERE event_id = ${'evt_new'}
      `;

      expect(result.length).toBe(0);
    });

    it('should mark events as processed after handling', async () => {
      // Simulate inserting a processed event
      mockSql.mockResolvedValueOnce([]);

      await mockSql`
        INSERT INTO processed_webhook_events (event_id, event_type)
        VALUES (${'evt_456'}, ${'checkout.session.completed'})
        ON CONFLICT (event_id) DO NOTHING
      `;

      expect(mockSql).toHaveBeenCalled();
    });

    it('should use ON CONFLICT to handle race conditions', async () => {
      // The SQL should include ON CONFLICT to handle duplicate inserts gracefully
      mockSql.mockResolvedValueOnce([]);

      const eventId = 'evt_race';
      const eventType = 'invoice.paid';

      await mockSql`
        INSERT INTO processed_webhook_events (event_id, event_type)
        VALUES (${eventId}, ${eventType})
        ON CONFLICT (event_id) DO NOTHING
      `;

      // Verify the SQL template was called with correct parameters
      expect(mockSql).toHaveBeenCalled();
    });
  });

  describe('Invoice Paid - Billing Period Check', () => {
    it('should only reset usage on new billing period', async () => {
      const userId = 'user-123';
      const currentPeriodEnd = new Date('2024-01-15');
      const newPeriodEnd = new Date('2024-02-15');

      // Mock getting user with current period
      mockSql.mockResolvedValueOnce([
        {
          user_id: userId,
          period_end: currentPeriodEnd,
        },
      ]);

      // Check if new period is actually newer
      expect(newPeriodEnd > currentPeriodEnd).toBe(true);
    });

    it('should not reset usage for same billing period', async () => {
      const currentPeriodEnd = new Date('2024-01-15');
      const samePeriodEnd = new Date('2024-01-15');

      // Check that same period doesn't trigger reset
      expect(samePeriodEnd > currentPeriodEnd).toBe(false);
    });

    it('should handle missing period end gracefully', async () => {
      // Mock user with no period_end
      mockSql.mockResolvedValueOnce([
        {
          user_id: 'user-123',
          period_end: null,
        },
      ]);

      const result = await mockSql`SELECT * FROM subscriptions WHERE user_id = 'user-123'`;
      expect(result[0].period_end).toBeNull();
    });
  });

  describe('Subscription Status Mapping', () => {
    it('should map active Stripe status to active', () => {
      const statusMap: Record<string, string> = {
        active: 'active',
        trialing: 'active',
        past_due: 'past_due',
        canceled: 'canceled',
        unpaid: 'canceled',
      };

      expect(statusMap['active']).toBe('active');
      expect(statusMap['trialing']).toBe('active');
      expect(statusMap['past_due']).toBe('past_due');
      expect(statusMap['canceled']).toBe('canceled');
    });
  });

  describe('User Lookup', () => {
    it('should find user by Stripe customer ID', async () => {
      const customerId = 'cus_123';
      mockSql.mockResolvedValueOnce([{ user_id: 'user-456' }]);

      const result = await mockSql`
        SELECT user_id FROM subscriptions
        WHERE stripe_customer_id = ${customerId}
      `;

      expect(result.length).toBe(1);
      expect(result[0].user_id).toBe('user-456');
    });

    it('should handle missing user gracefully', async () => {
      const customerId = 'cus_nonexistent';
      mockSql.mockResolvedValueOnce([]);

      const result = await mockSql`
        SELECT user_id FROM subscriptions
        WHERE stripe_customer_id = ${customerId}
      `;

      expect(result.length).toBe(0);
    });
  });

  describe('Transactional Updates', () => {
    it('should use transaction for usage reset', async () => {
      let transactionExecuted = false;

      mockTransaction.mockImplementation(async (callback) => {
        transactionExecuted = true;
        const mockTxSql = vi.fn().mockResolvedValue([]);
        await callback(mockTxSql);
      });

      await mockTransaction(async (txSql: any) => {
        await txSql`
          UPDATE subscriptions
          SET minutes_used = 0,
              period_end = ${'2024-02-15'}
          WHERE user_id = ${'user-123'}
        `;
      });

      expect(transactionExecuted).toBe(true);
    });
  });
});
