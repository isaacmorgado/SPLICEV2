import { describe, it, expect } from 'vitest';
import {
  AUDIO_CONFIG,
  calculateExportTimeout,
  validateTimelineDuration,
} from '../../src/config/audio-config';

describe('calculateExportTimeout', () => {
  it('returns base timeout for short sequences', () => {
    const timeout = calculateExportTimeout(60); // 1 minute

    // Base (120000) + 1 minute * 30000 = 150000
    expect(timeout).toBe(150000);
  });

  it('scales timeout with sequence duration', () => {
    const timeout1min = calculateExportTimeout(60);
    const timeout5min = calculateExportTimeout(300);
    const timeout10min = calculateExportTimeout(600);

    expect(timeout5min).toBeGreaterThan(timeout1min);
    expect(timeout10min).toBeGreaterThan(timeout5min);
  });

  it('caps at maximum timeout', () => {
    const timeout = calculateExportTimeout(3600); // 1 hour sequence

    expect(timeout).toBe(AUDIO_CONFIG.EXPORT_TIMEOUT_MAX_MS);
    expect(timeout).toBe(600000); // 10 minutes max
  });

  it('returns base timeout for zero duration', () => {
    const timeout = calculateExportTimeout(0);

    expect(timeout).toBe(AUDIO_CONFIG.EXPORT_TIMEOUT_BASE_MS);
  });

  it('handles fractional durations', () => {
    const timeout = calculateExportTimeout(90); // 1.5 minutes

    // Base (120000) + 1.5 * 30000 = 165000
    expect(timeout).toBe(165000);
  });
});

describe('validateTimelineDuration', () => {
  it('returns valid for short timelines', () => {
    const result = validateTimelineDuration(300); // 5 minutes

    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it('returns valid with warning for long timelines', () => {
    const result = validateTimelineDuration(4000); // ~67 minutes

    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('67');
    expect(result.error).toBeUndefined();
  });

  it('returns invalid for timelines exceeding max', () => {
    const result = validateTimelineDuration(8000); // ~133 minutes

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('too long');
  });

  it('returns valid at warning threshold boundary', () => {
    const result = validateTimelineDuration(AUDIO_CONFIG.WARN_TIMELINE_DURATION_SECONDS);

    // At exactly the threshold, should not warn
    expect(result.valid).toBe(true);
  });

  it('warns just over warning threshold', () => {
    const result = validateTimelineDuration(AUDIO_CONFIG.WARN_TIMELINE_DURATION_SECONDS + 1);

    expect(result.valid).toBe(true);
    expect(result.warning).toBeDefined();
  });

  it('returns invalid at max threshold boundary', () => {
    const result = validateTimelineDuration(AUDIO_CONFIG.MAX_TIMELINE_DURATION_SECONDS + 1);

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('AUDIO_CONFIG constants', () => {
  it('has sensible chunk duration', () => {
    expect(AUDIO_CONFIG.CHUNK_DURATION_SECONDS).toBe(600); // 10 minutes
    expect(AUDIO_CONFIG.CHUNK_DURATION_SECONDS).toBeLessThanOrEqual(600);
  });

  it('has 25MB max chunk size for Whisper', () => {
    expect(AUDIO_CONFIG.MAX_CHUNK_SIZE_BYTES).toBe(25 * 1024 * 1024);
  });

  it('has timeout values in correct order', () => {
    expect(AUDIO_CONFIG.EXPORT_TIMEOUT_BASE_MS).toBeLessThan(AUDIO_CONFIG.EXPORT_TIMEOUT_MAX_MS);
    expect(AUDIO_CONFIG.EXPORT_TIMEOUT_PER_MINUTE_MS).toBeGreaterThan(0);
  });

  it('has timeline limits in correct order', () => {
    expect(AUDIO_CONFIG.WARN_TIMELINE_DURATION_SECONDS).toBeLessThan(
      AUDIO_CONFIG.MAX_TIMELINE_DURATION_SECONDS
    );
  });

  it('has valid audio format defaults', () => {
    expect(AUDIO_CONFIG.DEFAULT_SAMPLE_RATE).toBe(48000);
    expect(AUDIO_CONFIG.DEFAULT_CHANNELS).toBe(2);
    expect(AUDIO_CONFIG.DEFAULT_BITS_PER_SAMPLE).toBe(16);
  });
});
