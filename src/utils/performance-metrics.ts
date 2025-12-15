/**
 * Performance Metrics Utility
 *
 * Tracks timing and performance of audio processing operations.
 * Helps identify bottlenecks and optimize processing pipeline.
 *
 * Usage:
 *   const metrics = new PerformanceMetrics();
 *   metrics.start('transcription');
 *   await doTranscription();
 *   metrics.end('transcription');
 *   console.log(metrics.getReport());
 */

import { logger } from '../lib/logger';

export interface MetricEntry {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

export interface MetricSummary {
  name: string;
  count: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  lastDuration: number;
}

export interface PerformanceReport {
  totalDuration: number;
  operations: MetricSummary[];
  timeline: MetricEntry[];
}

/**
 * Performance metrics tracker for audio processing operations.
 */
export class PerformanceMetrics {
  private metrics: Map<string, MetricEntry[]>;
  private activeTimers: Map<string, number>;
  private sessionStart: number;

  constructor() {
    this.metrics = new Map();
    this.activeTimers = new Map();
    this.sessionStart = Date.now();
  }

  /**
   * Start timing an operation.
   */
  start(operationName: string, metadata?: Record<string, any>): void {
    const startTime = Date.now();
    this.activeTimers.set(operationName, startTime);

    const entry: MetricEntry = {
      name: operationName,
      startTime,
      metadata,
    };

    if (!this.metrics.has(operationName)) {
      this.metrics.set(operationName, []);
    }

    this.metrics.get(operationName)!.push(entry);

    logger.debug(`Performance: Started ${operationName}`, metadata);
  }

  /**
   * End timing an operation.
   */
  end(operationName: string, metadata?: Record<string, any>): number {
    const endTime = Date.now();
    const startTime = this.activeTimers.get(operationName);

    if (!startTime) {
      logger.warn(`Performance: No start time found for ${operationName}`);
      return 0;
    }

    const duration = endTime - startTime;
    this.activeTimers.delete(operationName);

    // Update the last entry for this operation
    const entries = this.metrics.get(operationName);
    if (entries && entries.length > 0) {
      const lastEntry = entries[entries.length - 1];
      lastEntry.endTime = endTime;
      lastEntry.duration = duration;
      if (metadata) {
        lastEntry.metadata = { ...lastEntry.metadata, ...metadata };
      }
    }

    logger.debug(`Performance: ${operationName} completed in ${duration}ms`, metadata);
    return duration;
  }

  /**
   * Measure an async operation with automatic start/end.
   */
  async measure<T>(
    operationName: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    this.start(operationName, metadata);
    try {
      const result = await fn();
      this.end(operationName);
      return result;
    } catch (error) {
      this.end(operationName, { error: true });
      throw error;
    }
  }

  /**
   * Measure a synchronous operation with automatic start/end.
   */
  measureSync<T>(operationName: string, fn: () => T, metadata?: Record<string, any>): T {
    this.start(operationName, metadata);
    try {
      const result = fn();
      this.end(operationName);
      return result;
    } catch (error) {
      this.end(operationName, { error: true });
      throw error;
    }
  }

  /**
   * Record a duration directly without start/end calls.
   */
  record(operationName: string, duration: number, metadata?: Record<string, any>): void {
    const now = Date.now();
    const entry: MetricEntry = {
      name: operationName,
      startTime: now - duration,
      endTime: now,
      duration,
      metadata,
    };

    if (!this.metrics.has(operationName)) {
      this.metrics.set(operationName, []);
    }

    this.metrics.get(operationName)!.push(entry);
  }

  /**
   * Get summary for a specific operation.
   */
  getSummary(operationName: string): MetricSummary | undefined {
    const entries = this.metrics.get(operationName);
    if (!entries || entries.length === 0) {
      return undefined;
    }

    const durations = entries.filter((e) => e.duration !== undefined).map((e) => e.duration!);

    if (durations.length === 0) {
      return undefined;
    }

    return {
      name: operationName,
      count: durations.length,
      totalDuration: durations.reduce((sum, d) => sum + d, 0),
      avgDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      lastDuration: durations[durations.length - 1],
    };
  }

  /**
   * Get all summaries.
   */
  getAllSummaries(): MetricSummary[] {
    const summaries: MetricSummary[] = [];

    // Convert to array to avoid iterator issues
    const operationNames = Array.from(this.metrics.keys());
    for (const operationName of operationNames) {
      const summary = this.getSummary(operationName);
      if (summary) {
        summaries.push(summary);
      }
    }

    return summaries.sort((a, b) => b.totalDuration - a.totalDuration);
  }

  /**
   * Get a complete performance report.
   */
  getReport(): PerformanceReport {
    const timeline: MetricEntry[] = [];

    // Flatten all entries into a timeline
    // Convert to array to avoid iterator issues
    const allEntries = Array.from(this.metrics.values());
    for (const entries of allEntries) {
      timeline.push(...entries);
    }

    // Sort by start time
    timeline.sort((a, b) => a.startTime - b.startTime);

    const totalDuration = Date.now() - this.sessionStart;

    return {
      totalDuration,
      operations: this.getAllSummaries(),
      timeline,
    };
  }

  /**
   * Generate a formatted text report.
   */
  getTextReport(): string {
    const report = this.getReport();
    const lines: string[] = [];

    lines.push('=== Performance Report ===');
    lines.push(`Total Session Duration: ${report.totalDuration}ms`);
    lines.push('');

    if (report.operations.length === 0) {
      lines.push('No operations recorded.');
      return lines.join('\n');
    }

    lines.push('Operations (sorted by total duration):');
    lines.push('');

    for (const op of report.operations) {
      lines.push(`${op.name}:`);
      lines.push(`  Count: ${op.count}`);
      lines.push(`  Total: ${op.totalDuration}ms`);
      lines.push(`  Avg: ${op.avgDuration.toFixed(2)}ms`);
      lines.push(`  Min: ${op.minDuration}ms`);
      lines.push(`  Max: ${op.maxDuration}ms`);
      lines.push(`  Last: ${op.lastDuration}ms`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Log the performance report.
   */
  logReport(): void {
    const report = this.getTextReport();
    logger.info('Performance Report:\n' + report);
  }

  /**
   * Clear all metrics.
   */
  clear(): void {
    this.metrics.clear();
    this.activeTimers.clear();
    this.sessionStart = Date.now();
  }

  /**
   * Get raw metric entries for a specific operation.
   */
  getEntries(operationName: string): MetricEntry[] {
    return this.metrics.get(operationName) || [];
  }

  /**
   * Check if an operation is currently being timed.
   */
  isActive(operationName: string): boolean {
    return this.activeTimers.has(operationName);
  }
}

/**
 * Decorator for measuring method performance.
 * Usage:
 *   class MyService {
 *     @measured('myOperation')
 *     async doSomething() { ... }
 *   }
 */
export function measured(operationName: string, metricsInstance?: PerformanceMetrics) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const metrics = metricsInstance || new PerformanceMetrics();
      return metrics.measure(operationName, () => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}

/**
 * Helper to format bytes to human-readable size.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Helper to format milliseconds to human-readable duration.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }

  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${minutes.toFixed(2)}m`;
  }

  const hours = minutes / 60;
  return `${hours.toFixed(2)}h`;
}

// Global singleton for convenience
export const globalMetrics = new PerformanceMetrics();
