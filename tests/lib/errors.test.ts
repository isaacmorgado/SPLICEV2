import { describe, it, expect } from 'vitest';
import {
  SpliceError,
  SpliceErrorCode,
  USER_MESSAGES,
  wrapError,
  isSpliceError,
  createErrorFromResult,
} from '../../src/lib/errors';

describe('SpliceError', () => {
  describe('constructor', () => {
    it('creates error with code and technical message', () => {
      const error = new SpliceError(SpliceErrorCode.AME_NOT_AVAILABLE, 'EncoderManager is null');

      expect(error.code).toBe(SpliceErrorCode.AME_NOT_AVAILABLE);
      expect(error.message).toBe('EncoderManager is null');
      expect(error.name).toBe('SpliceError');
    });

    it('includes user-friendly message from USER_MESSAGES', () => {
      const error = new SpliceError(
        SpliceErrorCode.AUDIO_NO_SEQUENCE,
        'Technical: no active sequence'
      );

      expect(error.userMessage).toBe(USER_MESSAGES[SpliceErrorCode.AUDIO_NO_SEQUENCE]);
      expect(error.userMessage).toContain('No sequence is open');
    });

    it('includes context when provided', () => {
      const error = new SpliceError(SpliceErrorCode.AME_EXPORT_TIMEOUT, 'Timeout after 120000ms', {
        outputPath: '/tmp/test.wav',
        timeoutMs: 120000,
      });

      expect(error.context).toEqual({
        outputPath: '/tmp/test.wav',
        timeoutMs: 120000,
      });
    });

    it('includes timestamp', () => {
      const before = new Date().toISOString();
      const error = new SpliceError(SpliceErrorCode.UNKNOWN, 'test');
      const after = new Date().toISOString();

      expect(error.timestamp).toBeDefined();
      expect(error.timestamp >= before).toBe(true);
      expect(error.timestamp <= after).toBe(true);
    });

    it('chains original error stack when provided', () => {
      const originalError = new Error('Original error message');
      const wrappedError = new SpliceError(
        SpliceErrorCode.UNKNOWN,
        'Wrapped error',
        undefined,
        originalError
      );

      expect(wrappedError.stack).toContain('Caused by:');
      expect(wrappedError.stack).toContain('Original error message');
    });
  });

  describe('toLogString', () => {
    it('formats error with code and message', () => {
      const error = new SpliceError(SpliceErrorCode.CHUNK_INVALID_WAV, 'Missing RIFF header');

      const logString = error.toLogString();

      expect(logString).toContain('[CHK_301]');
      expect(logString).toContain('Missing RIFF header');
    });

    it('includes context in log string when present', () => {
      const error = new SpliceError(SpliceErrorCode.CHUNK_INVALID_WAV, 'Bad header', {
        foundHeader: 'XXXX',
        expectedHeader: 'RIFF',
      });

      const logString = error.toLogString();

      expect(logString).toContain('Context:');
      expect(logString).toContain('foundHeader');
      expect(logString).toContain('XXXX');
    });
  });

  describe('toJSON', () => {
    it('serializes error to plain object', () => {
      const error = new SpliceError(SpliceErrorCode.API_ERROR, 'Server returned 500', {
        statusCode: 500,
      });

      const json = error.toJSON();

      expect(json.code).toBe(SpliceErrorCode.API_ERROR);
      expect(json.message).toBe('Server returned 500');
      expect(json.userMessage).toBeDefined();
      expect(json.context).toEqual({ statusCode: 500 });
      expect(json.timestamp).toBeDefined();
      expect(json.stack).toBeDefined();
    });
  });

  describe('toDisplayString', () => {
    it('returns user message with error code', () => {
      const error = new SpliceError(SpliceErrorCode.NETWORK_ERROR, 'fetch failed');

      const display = error.toDisplayString();

      expect(display).toContain(USER_MESSAGES[SpliceErrorCode.NETWORK_ERROR]);
      expect(display).toContain('(NET_801)');
    });
  });
});

describe('wrapError', () => {
  it('returns SpliceError unchanged', () => {
    const original = new SpliceError(SpliceErrorCode.TRANSCRIPTION_FAILED, 'API error');

    const wrapped = wrapError(original);

    expect(wrapped).toBe(original);
  });

  it('wraps standard Error with default code', () => {
    const original = new Error('Something went wrong');

    const wrapped = wrapError(original);

    expect(wrapped).toBeInstanceOf(SpliceError);
    expect(wrapped.code).toBe(SpliceErrorCode.UNKNOWN);
    expect(wrapped.message).toBe('Something went wrong');
  });

  it('wraps standard Error with specified code', () => {
    const original = new Error('Network timeout');

    const wrapped = wrapError(original, SpliceErrorCode.NETWORK_ERROR);

    expect(wrapped.code).toBe(SpliceErrorCode.NETWORK_ERROR);
    expect(wrapped.message).toBe('Network timeout');
  });

  it('wraps string error', () => {
    const wrapped = wrapError('String error message');

    expect(wrapped).toBeInstanceOf(SpliceError);
    expect(wrapped.code).toBe(SpliceErrorCode.UNKNOWN);
    expect(wrapped.message).toBe('String error message');
  });

  it('wraps unknown error types', () => {
    const wrapped = wrapError({ weird: 'object' });

    expect(wrapped).toBeInstanceOf(SpliceError);
    expect(wrapped.code).toBe(SpliceErrorCode.UNKNOWN);
  });

  it('wraps null/undefined', () => {
    expect(wrapError(null).code).toBe(SpliceErrorCode.UNKNOWN);
    expect(wrapError(undefined).code).toBe(SpliceErrorCode.UNKNOWN);
  });
});

describe('isSpliceError', () => {
  it('returns true for SpliceError instances', () => {
    const error = new SpliceError(SpliceErrorCode.UNKNOWN, 'test');

    expect(isSpliceError(error)).toBe(true);
  });

  it('returns false for standard Error', () => {
    const error = new Error('test');

    expect(isSpliceError(error)).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isSpliceError(null)).toBe(false);
    expect(isSpliceError(undefined)).toBe(false);
    expect(isSpliceError('string')).toBe(false);
    expect(isSpliceError(123)).toBe(false);
    expect(isSpliceError({})).toBe(false);
  });
});

describe('createErrorFromResult', () => {
  it('creates SpliceError from error message', () => {
    const error = createErrorFromResult(
      'Export failed: timeout',
      SpliceErrorCode.AME_EXPORT_FAILED
    );

    expect(error).toBeInstanceOf(SpliceError);
    expect(error.code).toBe(SpliceErrorCode.AME_EXPORT_FAILED);
    expect(error.message).toBe('Export failed: timeout');
  });

  it('includes context when provided', () => {
    const error = createErrorFromResult('Preset not found', SpliceErrorCode.AME_PRESET_NOT_FOUND, {
      searchedPaths: ['/path/a', '/path/b'],
    });

    expect(error.context).toEqual({ searchedPaths: ['/path/a', '/path/b'] });
  });
});

describe('USER_MESSAGES', () => {
  it('has a message for every error code', () => {
    const codes = Object.values(SpliceErrorCode);

    for (const code of codes) {
      expect(USER_MESSAGES[code]).toBeDefined();
      expect(typeof USER_MESSAGES[code]).toBe('string');
      expect(USER_MESSAGES[code].length).toBeGreaterThan(10);
    }
  });

  it('messages are user-friendly (no technical jargon)', () => {
    const technicalTerms = ['null', 'undefined', 'TypeError', 'NaN', 'exception'];

    for (const message of Object.values(USER_MESSAGES)) {
      const lowerMessage = message.toLowerCase();
      for (const term of technicalTerms) {
        expect(lowerMessage).not.toContain(term);
      }
    }
  });

  it('messages end with punctuation', () => {
    for (const message of Object.values(USER_MESSAGES)) {
      const lastChar = message[message.length - 1];
      expect(['.', '!', '?']).toContain(lastChar);
    }
  });
});

describe('SpliceErrorCode', () => {
  it('has unique codes', () => {
    const codes = Object.values(SpliceErrorCode);
    const uniqueCodes = new Set(codes);

    expect(uniqueCodes.size).toBe(codes.length);
  });

  it('codes follow naming convention', () => {
    const codes = Object.values(SpliceErrorCode);

    for (const code of codes) {
      // Codes should be uppercase with underscore separating category from number
      expect(code).toMatch(/^[A-Z]+_\d{3}$/);
    }
  });
});
