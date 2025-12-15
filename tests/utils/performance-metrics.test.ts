import { describe, it, expect, beforeEach } from 'vitest';
import {
  PerformanceMetrics,
  formatBytes,
  formatDuration,
} from '../../src/utils/performance-metrics';

describe('PerformanceMetrics', () => {
  let metrics: PerformanceMetrics;

  beforeEach(() => {
    metrics = new PerformanceMetrics();
  });

  describe('start/end', () => {
    it('tracks operation duration', () => {
      metrics.start('test-op');
      // Simulate some work
      const delay = 10;
      const start = Date.now();
      while (Date.now() - start < delay) {
        // Busy wait
      }
      const duration = metrics.end('test-op');

      expect(duration).toBeGreaterThanOrEqual(delay);
      expect(duration).toBeLessThan(delay + 50); // Allow some margin
    });

    it('returns 0 for operations without start', () => {
      const duration = metrics.end('nonexistent');
      expect(duration).toBe(0);
    });

    it('stores metadata with operations', () => {
      metrics.start('test-op', { foo: 'bar' });
      metrics.end('test-op', { baz: 'qux' });

      const entries = metrics.getEntries('test-op');
      expect(entries[0].metadata).toEqual({ foo: 'bar', baz: 'qux' });
    });
  });

  describe('measure', () => {
    it('measures async operations', async () => {
      const result = await metrics.measure('async-op', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'success';
      });

      expect(result).toBe('success');
      const summary = metrics.getSummary('async-op');
      expect(summary).toBeDefined();
      expect(summary!.count).toBe(1);
      expect(summary!.totalDuration).toBeGreaterThanOrEqual(10);
    });

    it('propagates errors from measured operations', async () => {
      await expect(
        metrics.measure('error-op', async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      // Should still record the attempt with error metadata
      const entries = metrics.getEntries('error-op');
      expect(entries[0].metadata?.error).toBe(true);
    });
  });

  describe('measureSync', () => {
    it('measures synchronous operations', () => {
      const result = metrics.measureSync('sync-op', () => {
        let sum = 0;
        for (let i = 0; i < 1000; i++) {
          sum += i;
        }
        return sum;
      });

      expect(result).toBe(499500);
      const summary = metrics.getSummary('sync-op');
      expect(summary).toBeDefined();
      expect(summary!.count).toBe(1);
    });
  });

  describe('record', () => {
    it('records duration directly', () => {
      metrics.record('manual-op', 100, { source: 'manual' });

      const summary = metrics.getSummary('manual-op');
      expect(summary!.totalDuration).toBe(100);
      expect(summary!.avgDuration).toBe(100);

      const entries = metrics.getEntries('manual-op');
      expect(entries[0].metadata?.source).toBe('manual');
    });
  });

  describe('getSummary', () => {
    it('returns undefined for operations with no data', () => {
      const summary = metrics.getSummary('nonexistent');
      expect(summary).toBeUndefined();
    });

    it('calculates statistics correctly', () => {
      metrics.record('test-op', 100);
      metrics.record('test-op', 200);
      metrics.record('test-op', 300);

      const summary = metrics.getSummary('test-op');

      expect(summary).toBeDefined();
      expect(summary!.count).toBe(3);
      expect(summary!.totalDuration).toBe(600);
      expect(summary!.avgDuration).toBe(200);
      expect(summary!.minDuration).toBe(100);
      expect(summary!.maxDuration).toBe(300);
      expect(summary!.lastDuration).toBe(300);
    });

    it('ignores incomplete operations', () => {
      metrics.start('incomplete-op');
      // Don't end it

      const summary = metrics.getSummary('incomplete-op');
      expect(summary).toBeUndefined();
    });
  });

  describe('getAllSummaries', () => {
    it('returns summaries for all operations', () => {
      metrics.record('op1', 100);
      metrics.record('op2', 200);
      metrics.record('op3', 300);

      const summaries = metrics.getAllSummaries();

      expect(summaries).toHaveLength(3);
      expect(summaries.map((s) => s.name)).toContain('op1');
      expect(summaries.map((s) => s.name)).toContain('op2');
      expect(summaries.map((s) => s.name)).toContain('op3');
    });

    it('sorts by total duration descending', () => {
      metrics.record('slow-op', 500);
      metrics.record('fast-op', 100);
      metrics.record('medium-op', 300);

      const summaries = metrics.getAllSummaries();

      expect(summaries[0].name).toBe('slow-op');
      expect(summaries[1].name).toBe('medium-op');
      expect(summaries[2].name).toBe('fast-op');
    });
  });

  describe('getReport', () => {
    it('generates complete performance report', () => {
      // Wait a moment to ensure session has measurable duration
      const start = Date.now();
      while (Date.now() - start < 5) {
        // Busy wait
      }

      metrics.record('op1', 100);
      metrics.record('op2', 200);

      const report = metrics.getReport();

      expect(report.operations).toHaveLength(2);
      expect(report.timeline).toHaveLength(2);
      expect(report.totalDuration).toBeGreaterThanOrEqual(0); // Session duration since creation
    });

    it('sorts timeline by start time', () => {
      metrics.start('first');
      metrics.end('first');

      // Small delay
      const start = Date.now();
      while (Date.now() - start < 5) {
        // Busy wait
      }

      metrics.start('second');
      metrics.end('second');

      const report = metrics.getReport();

      expect(report.timeline[0].name).toBe('first');
      expect(report.timeline[1].name).toBe('second');
    });
  });

  describe('getTextReport', () => {
    it('generates formatted text report', () => {
      metrics.record('test-op', 100);

      const text = metrics.getTextReport();

      expect(text).toContain('Performance Report');
      expect(text).toContain('test-op');
      expect(text).toContain('100ms');
    });

    it('handles empty metrics', () => {
      const text = metrics.getTextReport();

      expect(text).toContain('Performance Report');
      expect(text).toContain('No operations recorded');
    });
  });

  describe('clear', () => {
    it('removes all metrics', () => {
      metrics.record('op1', 100);
      metrics.record('op2', 200);

      metrics.clear();

      const summaries = metrics.getAllSummaries();
      expect(summaries).toHaveLength(0);
    });

    it('resets session start time', () => {
      // Wait to build up session duration
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait
      }

      const report1 = metrics.getReport();
      const time1 = report1.totalDuration;

      expect(time1).toBeGreaterThanOrEqual(10);

      // Clear and check new session has less duration
      metrics.clear();

      const report2 = metrics.getReport();
      const time2 = report2.totalDuration;

      expect(time2).toBeLessThan(time1);
      expect(time2).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getEntries', () => {
    it('returns raw entries for an operation', () => {
      metrics.start('test-op', { attempt: 1 });
      metrics.end('test-op');

      metrics.start('test-op', { attempt: 2 });
      metrics.end('test-op');

      const entries = metrics.getEntries('test-op');

      expect(entries).toHaveLength(2);
      expect(entries[0].metadata?.attempt).toBe(1);
      expect(entries[1].metadata?.attempt).toBe(2);
    });

    it('returns empty array for unknown operation', () => {
      const entries = metrics.getEntries('nonexistent');
      expect(entries).toEqual([]);
    });
  });

  describe('isActive', () => {
    it('returns true for active operations', () => {
      metrics.start('active-op');

      expect(metrics.isActive('active-op')).toBe(true);
    });

    it('returns false for completed operations', () => {
      metrics.start('completed-op');
      metrics.end('completed-op');

      expect(metrics.isActive('completed-op')).toBe(false);
    });

    it('returns false for non-existent operations', () => {
      expect(metrics.isActive('nonexistent')).toBe(false);
    });
  });

  describe('multiple invocations', () => {
    it('tracks multiple invocations of same operation', () => {
      metrics.record('repeated-op', 100);
      metrics.record('repeated-op', 150);
      metrics.record('repeated-op', 200);

      const summary = metrics.getSummary('repeated-op');

      expect(summary!.count).toBe(3);
      expect(summary!.avgDuration).toBe(150);
    });

    it('allows overlapping operations with different names', () => {
      metrics.start('op1');
      metrics.start('op2');
      metrics.end('op2');
      metrics.end('op1');

      expect(metrics.getSummary('op1')).toBeDefined();
      expect(metrics.getSummary('op2')).toBeDefined();
    });
  });
});

describe('formatBytes', () => {
  it('formats bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512.00 B');
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(1048576)).toBe('1.00 MB');
    expect(formatBytes(1073741824)).toBe('1.00 GB');
  });
});

describe('formatDuration', () => {
  it('formats milliseconds correctly', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(1000)).toBe('1.00s');
    expect(formatDuration(1500)).toBe('1.50s');
    expect(formatDuration(60000)).toBe('1.00m');
    expect(formatDuration(90000)).toBe('1.50m');
    expect(formatDuration(3600000)).toBe('1.00h');
    expect(formatDuration(5400000)).toBe('1.50h');
  });
});
