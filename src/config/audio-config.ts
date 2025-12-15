/**
 * Audio Processing Configuration
 *
 * Centralized configuration for audio extraction, chunking, and export settings.
 * These values can be adjusted based on performance requirements or API limits.
 *
 * Performance features:
 * - Caching configuration for transcription and voice isolation
 * - Memory limits to prevent exhaustion in long sessions
 * - TTL settings for cache entries
 */

export const AUDIO_CONFIG = {
  /**
   * Chunk duration in seconds for splitting large audio files.
   * 10 minutes (600s) is a safe default that stays well under Whisper's 25MB limit
   * for typical audio formats (48kHz stereo 16-bit = ~11.5MB per 10 min).
   */
  CHUNK_DURATION_SECONDS: 600,

  /**
   * Maximum file size in bytes for Whisper API.
   * Files larger than this will be chunked.
   */
  MAX_CHUNK_SIZE_BYTES: 25 * 1024 * 1024, // 25MB

  /**
   * Base timeout in milliseconds for AME export to complete.
   * This is the minimum timeout regardless of sequence length.
   */
  EXPORT_TIMEOUT_BASE_MS: 120000, // 2 minutes base

  /**
   * Additional timeout per minute of sequence duration.
   * Longer sequences need more export time.
   */
  EXPORT_TIMEOUT_PER_MINUTE_MS: 30000, // +30s per minute

  /**
   * Maximum timeout in milliseconds for AME export.
   * Cap to prevent indefinite waiting.
   */
  EXPORT_TIMEOUT_MAX_MS: 600000, // 10 minutes max

  /**
   * Default/legacy timeout (for backward compatibility).
   * Use calculateExportTimeout() for dynamic calculation.
   */
  EXPORT_TIMEOUT_MS: 120000, // 2 minutes

  /**
   * Maximum timeline duration in seconds that can be processed.
   * Prevents memory issues and excessive API costs.
   */
  MAX_TIMELINE_DURATION_SECONDS: 7200, // 2 hours

  /**
   * Warning threshold for timeline duration in seconds.
   * User will be warned that processing may take longer.
   */
  WARN_TIMELINE_DURATION_SECONDS: 3600, // 1 hour

  /**
   * Initial delay in milliseconds before polling for export completion.
   * Gives AME time to start writing the file.
   */
  EXPORT_INITIAL_DELAY_MS: 1000, // 1 second

  /**
   * Interval in milliseconds between file size stability checks.
   */
  EXPORT_POLL_INTERVAL_MS: 500,

  /**
   * Number of consecutive stable size checks required to consider export complete.
   */
  EXPORT_STABILITY_CHECKS: 3,

  /**
   * Default sample rate for Premiere Pro exports (Hz).
   * Standard professional audio sample rate.
   */
  DEFAULT_SAMPLE_RATE: 48000,

  /**
   * Default channel count for audio exports.
   * Stereo is standard for most productions.
   */
  DEFAULT_CHANNELS: 2,

  /**
   * Default bits per sample for audio exports.
   * 16-bit is CD quality and widely compatible.
   */
  DEFAULT_BITS_PER_SAMPLE: 16,

  /**
   * Maximum supported sample rate (Hz).
   * Used for validation.
   */
  MAX_SAMPLE_RATE: 192000,

  /**
   * Maximum supported channel count.
   * Used for validation.
   */
  MAX_CHANNELS: 8,

  // ============================================
  // Cache Configuration
  // ============================================

  /**
   * Maximum number of transcription results to cache.
   * Each entry contains text and segment data.
   */
  CACHE_TRANSCRIPTION_MAX_ENTRIES: 30,

  /**
   * Maximum memory for transcription cache in bytes.
   * Approximately 50MB to store ~30 medium-length transcriptions.
   */
  CACHE_TRANSCRIPTION_MAX_SIZE: 50 * 1024 * 1024,

  /**
   * TTL for transcription cache entries in milliseconds.
   * 2 hours - transcriptions rarely change for same audio.
   */
  CACHE_TRANSCRIPTION_TTL: 7200000,

  /**
   * Maximum number of voice isolation results to cache.
   * Fewer entries because isolated audio buffers are large.
   */
  CACHE_VOICE_ISOLATION_MAX_ENTRIES: 10,

  /**
   * Maximum memory for voice isolation cache in bytes.
   * 200MB to store ~10 isolated audio results.
   */
  CACHE_VOICE_ISOLATION_MAX_SIZE: 200 * 1024 * 1024,

  /**
   * TTL for voice isolation cache entries in milliseconds.
   * 1 hour - these are CPU/API intensive so cache longer.
   */
  CACHE_VOICE_ISOLATION_TTL: 3600000,

  /**
   * Enable automatic cache pruning.
   * Removes expired entries periodically.
   */
  CACHE_AUTO_PRUNE: true,

  /**
   * Interval for automatic cache pruning in milliseconds.
   * Every 5 minutes.
   */
  CACHE_PRUNE_INTERVAL: 300000,

  // ============================================
  // Performance Metrics
  // ============================================

  /**
   * Enable performance metrics tracking.
   * Set to false in production if overhead is a concern.
   */
  METRICS_ENABLED: true,

  /**
   * Log performance reports automatically.
   * Useful for debugging slow operations.
   */
  METRICS_AUTO_LOG: false,

  /**
   * Interval for auto-logging metrics in milliseconds.
   * Every 10 minutes.
   */
  METRICS_LOG_INTERVAL: 600000,
} as const;

// Type for the config values
export type AudioConfig = typeof AUDIO_CONFIG;

/**
 * Calculate dynamic export timeout based on sequence duration.
 * Longer sequences get more time to export.
 *
 * @param sequenceDurationSeconds - Duration of the sequence in seconds
 * @returns Timeout in milliseconds
 */
export function calculateExportTimeout(sequenceDurationSeconds: number): number {
  const durationMinutes = sequenceDurationSeconds / 60;
  const dynamicTimeout =
    AUDIO_CONFIG.EXPORT_TIMEOUT_BASE_MS +
    durationMinutes * AUDIO_CONFIG.EXPORT_TIMEOUT_PER_MINUTE_MS;

  return Math.min(dynamicTimeout, AUDIO_CONFIG.EXPORT_TIMEOUT_MAX_MS);
}

/**
 * Validate timeline duration and return validation result.
 *
 * @param durationSeconds - Duration to validate
 * @returns Validation result with status and optional warning/error message
 */
export function validateTimelineDuration(durationSeconds: number): {
  valid: boolean;
  warning?: string;
  error?: string;
} {
  if (durationSeconds > AUDIO_CONFIG.MAX_TIMELINE_DURATION_SECONDS) {
    return {
      valid: false,
      error: `Timeline is too long (${Math.round(durationSeconds / 60)} minutes). Maximum supported duration is ${Math.round(AUDIO_CONFIG.MAX_TIMELINE_DURATION_SECONDS / 60)} minutes.`,
    };
  }

  if (durationSeconds > AUDIO_CONFIG.WARN_TIMELINE_DURATION_SECONDS) {
    return {
      valid: true,
      warning: `Timeline is ${Math.round(durationSeconds / 60)} minutes long. Processing may take several minutes.`,
    };
  }

  return { valid: true };
}
