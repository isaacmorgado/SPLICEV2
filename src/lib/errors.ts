/**
 * Splice Plugin Error System
 *
 * Provides typed errors with error codes for tracking, support, and user-facing messages.
 * All errors have a technical message (for logging) and a user-friendly message (for UI).
 */

/**
 * Error codes grouped by category.
 * Format: CATEGORY_CODE (e.g., AME_101)
 */
export enum SpliceErrorCode {
  // AME Export Errors (1xx)
  AME_NOT_AVAILABLE = 'AME_101',
  AME_PRESET_NOT_FOUND = 'AME_102',
  AME_EXPORT_FAILED = 'AME_103',
  AME_EXPORT_TIMEOUT = 'AME_104',
  AME_JOB_CREATION_FAILED = 'AME_105',
  AME_EXPORT_CANCELLED = 'AME_106',

  // Audio Extraction Errors (2xx)
  AUDIO_NO_SEQUENCE = 'AUD_201',
  AUDIO_INVALID_DURATION = 'AUD_202',
  AUDIO_EXTRACTION_FAILED = 'AUD_203',
  AUDIO_FILE_READ_FAILED = 'AUD_204',
  AUDIO_NO_CLIPS = 'AUD_205',
  AUDIO_TIMELINE_TOO_LONG = 'AUD_206',

  // Audio Chunking/WAV Errors (3xx)
  CHUNK_INVALID_WAV = 'CHK_301',
  CHUNK_MISSING_HEADER = 'CHK_302',
  CHUNK_INVALID_FORMAT = 'CHK_303',
  CHUNK_BOUNDS_ERROR = 'CHK_304',
  CHUNK_MISSING_DATA = 'CHK_305',

  // Premiere API Errors (4xx)
  PREMIERE_NOT_AVAILABLE = 'PPR_401',
  PREMIERE_NO_PROJECT = 'PPR_402',
  PREMIERE_TIMELINE_ERROR = 'PPR_403',
  PREMIERE_OPERATION_LOCKED = 'PPR_404',

  // Transcription Errors (5xx)
  TRANSCRIPTION_FAILED = 'TRS_501',
  TRANSCRIPTION_NO_AUDIO = 'TRS_502',
  TRANSCRIPTION_API_ERROR = 'TRS_503',

  // Silence Detection Errors (6xx)
  SILENCE_DETECTION_FAILED = 'SIL_601',
  SILENCE_NO_TRANSCRIPT = 'SIL_602',

  // Take Detection Errors (7xx)
  TAKE_DETECTION_FAILED = 'TKE_701',
  TAKE_NO_TRANSCRIPT = 'TKE_702',
  TAKE_APPLICATION_FAILED = 'TKE_703',

  // Network/API Errors (8xx)
  NETWORK_ERROR = 'NET_801',
  API_ERROR = 'API_802',
  AUTH_ERROR = 'AUTH_803',
  BACKEND_UNAVAILABLE = 'NET_804',

  // Unknown/Generic
  UNKNOWN = 'UNK_999',
}

/**
 * User-facing error messages mapped to error codes.
 * These are actionable and help users understand what went wrong.
 */
export const USER_MESSAGES: Record<SpliceErrorCode, string> = {
  // AME Export
  [SpliceErrorCode.AME_NOT_AVAILABLE]:
    'Adobe Media Encoder is not available. Please ensure it is installed and Premiere Pro is up to date.',
  [SpliceErrorCode.AME_PRESET_NOT_FOUND]:
    'Audio export preset not found. Please install Adobe Media Encoder or contact support.',
  [SpliceErrorCode.AME_EXPORT_FAILED]:
    'Audio export failed. Try restarting Premiere Pro and running again.',
  [SpliceErrorCode.AME_EXPORT_TIMEOUT]:
    'Audio export timed out. Your sequence may be too long. Try selecting a smaller portion.',
  [SpliceErrorCode.AME_JOB_CREATION_FAILED]:
    'Could not start export job. Ensure Media Encoder is not busy with other exports.',
  [SpliceErrorCode.AME_EXPORT_CANCELLED]: 'Export was cancelled.',

  // Audio Extraction
  [SpliceErrorCode.AUDIO_NO_SEQUENCE]:
    'No sequence is open. Please open a sequence in Premiere Pro.',
  [SpliceErrorCode.AUDIO_INVALID_DURATION]:
    'Sequence appears empty or has invalid duration. Add content to your timeline.',
  [SpliceErrorCode.AUDIO_EXTRACTION_FAILED]:
    'Could not extract audio from timeline. Ensure your sequence has audio tracks.',
  [SpliceErrorCode.AUDIO_FILE_READ_FAILED]:
    'Could not read the exported audio file. Check disk space and permissions.',
  [SpliceErrorCode.AUDIO_NO_CLIPS]: 'No audio clips found on timeline. Add audio to your sequence.',
  [SpliceErrorCode.AUDIO_TIMELINE_TOO_LONG]:
    'Timeline is too long to process. Maximum supported duration is 2 hours.',

  // Audio Chunking/WAV
  [SpliceErrorCode.CHUNK_INVALID_WAV]:
    'Invalid audio format. The file does not appear to be a valid WAV file.',
  [SpliceErrorCode.CHUNK_MISSING_HEADER]:
    'Audio file is corrupted or incomplete. Try exporting again.',
  [SpliceErrorCode.CHUNK_INVALID_FORMAT]:
    'Unsupported audio format. Splice requires standard WAV files (8/16/24/32-bit).',
  [SpliceErrorCode.CHUNK_BOUNDS_ERROR]:
    'Audio processing error. Please report this issue with your sequence details.',
  [SpliceErrorCode.CHUNK_MISSING_DATA]:
    'Audio file has no data. Ensure your timeline has audio content.',

  // Premiere API
  [SpliceErrorCode.PREMIERE_NOT_AVAILABLE]:
    'Premiere Pro connection lost. Please restart the plugin.',
  [SpliceErrorCode.PREMIERE_NO_PROJECT]: 'No project is open. Please open a Premiere Pro project.',
  [SpliceErrorCode.PREMIERE_TIMELINE_ERROR]:
    'Timeline operation failed. Try saving your project and restarting.',
  [SpliceErrorCode.PREMIERE_OPERATION_LOCKED]:
    'Another operation is in progress. Please wait for it to complete.',

  // Transcription
  [SpliceErrorCode.TRANSCRIPTION_FAILED]:
    'Transcription failed. Check your internet connection and try again.',
  [SpliceErrorCode.TRANSCRIPTION_NO_AUDIO]:
    'No audio to transcribe. Ensure your timeline has audio content.',
  [SpliceErrorCode.TRANSCRIPTION_API_ERROR]:
    'Transcription service error. Please try again in a moment.',

  // Silence Detection
  [SpliceErrorCode.SILENCE_DETECTION_FAILED]:
    'Silence detection failed. Try adjusting the threshold or using a different method.',
  [SpliceErrorCode.SILENCE_NO_TRANSCRIPT]:
    'Could not analyze audio. Ensure transcription completed successfully.',

  // Take Detection
  [SpliceErrorCode.TAKE_DETECTION_FAILED]:
    'Take analysis failed. Ensure you have a valid transcript.',
  [SpliceErrorCode.TAKE_NO_TRANSCRIPT]:
    'Please transcribe the timeline first before analyzing takes.',
  [SpliceErrorCode.TAKE_APPLICATION_FAILED]:
    'Failed to apply some takes to the timeline. Check the error details.',

  // Network/API
  [SpliceErrorCode.NETWORK_ERROR]:
    'Network connection failed. Check your internet connection and try again.',
  [SpliceErrorCode.API_ERROR]: 'Service temporarily unavailable. Please try again in a moment.',
  [SpliceErrorCode.AUTH_ERROR]: 'Authentication failed. Please sign in again.',
  [SpliceErrorCode.BACKEND_UNAVAILABLE]:
    'Splice service is currently unavailable. Please try again later.',

  // Unknown
  [SpliceErrorCode.UNKNOWN]: 'An unexpected error occurred. Please try again or contact support.',
};

/**
 * Base error class for all Splice errors.
 * Provides error code, user-friendly message, and context for debugging.
 */
export class SpliceError extends Error {
  public readonly code: SpliceErrorCode;
  public readonly userMessage: string;
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: string;

  constructor(
    code: SpliceErrorCode,
    technicalMessage: string,
    context?: Record<string, unknown>,
    originalError?: Error
  ) {
    super(technicalMessage);
    this.name = 'SpliceError';
    this.code = code;
    this.userMessage = USER_MESSAGES[code];
    this.context = context;
    this.timestamp = new Date().toISOString();

    // Capture stack trace, chain with original error if provided
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SpliceError);
    }

    // Chain original error stack if provided
    if (originalError?.stack && this.stack) {
      this.stack = `${this.stack}\nCaused by: ${originalError.stack}`;
    }
  }

  /**
   * Get a formatted string for logging (includes code and context).
   */
  toLogString(): string {
    const contextStr = this.context ? ` | Context: ${JSON.stringify(this.context)}` : '';
    return `[${this.code}] ${this.message}${contextStr}`;
  }

  /**
   * Get the error as a serializable object for API responses or storage.
   */
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }

  /**
   * Get a display string for the UI (code + user message).
   */
  toDisplayString(): string {
    return `${this.userMessage} (${this.code})`;
  }
}

/**
 * Helper to wrap unknown errors in SpliceError.
 * Useful in catch blocks where the error type is unknown.
 *
 * @param error - The caught error (could be Error, string, or unknown)
 * @param defaultCode - The error code to use if the error is not already a SpliceError
 * @returns A SpliceError instance
 */
export function wrapError(
  error: unknown,
  defaultCode: SpliceErrorCode = SpliceErrorCode.UNKNOWN
): SpliceError {
  // Already a SpliceError - return as-is
  if (error instanceof SpliceError) {
    return error;
  }

  // Standard Error - wrap with context
  if (error instanceof Error) {
    return new SpliceError(defaultCode, error.message, undefined, error);
  }

  // String error
  if (typeof error === 'string') {
    return new SpliceError(defaultCode, error);
  }

  // Unknown error type
  return new SpliceError(defaultCode, String(error));
}

/**
 * Type guard for SpliceError.
 *
 * @param error - The value to check
 * @returns True if the value is a SpliceError instance
 */
export function isSpliceError(error: unknown): error is SpliceError {
  return error instanceof SpliceError;
}

/**
 * Create a SpliceError from a failed result pattern.
 * Useful for converting services that use { success: false, error: string } patterns.
 *
 * @param errorMessage - The error message from the result
 * @param defaultCode - The error code to use
 * @param context - Optional context for debugging
 * @returns A SpliceError instance
 */
export function createErrorFromResult(
  errorMessage: string,
  defaultCode: SpliceErrorCode,
  context?: Record<string, unknown>
): SpliceError {
  return new SpliceError(defaultCode, errorMessage, context);
}
