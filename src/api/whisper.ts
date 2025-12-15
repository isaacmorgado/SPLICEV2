import { logger } from '../lib/logger';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const WHISPER_MODEL = 'whisper-1';

// Supported audio formats for Whisper API
const SUPPORTED_FORMATS = [
  'audio/wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/m4a',
  'audio/mp4',
  'audio/webm',
  'audio/ogg',
  'audio/flac',
];

/**
 * OpenAI Whisper API client for direct BYOK transcription
 * Used when user provides their own OpenAI API key
 */
export class WhisperClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = OPENAI_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  // ============================================
  // Basic Transcription
  // ============================================

  /**
   * Transcribe audio using OpenAI Whisper API
   * @param audioBuffer - Audio data (supports wav, mp3, m4a, webm, etc.)
   * @param options - Transcription options
   */
  async transcribe(
    audioBuffer: ArrayBuffer,
    options: WhisperOptions = {}
  ): Promise<TranscriptionResult> {
    logger.info('Starting Whisper transcription');

    try {
      const formData = this.createFormData(audioBuffer, {
        ...options,
        responseFormat: options.responseFormat || 'verbose_json',
      });

      const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw await this.handleError(response);
      }

      const data = await response.json();

      // Convert to standard TranscriptionResult format
      return {
        success: true,
        text: data.text,
        segments: (data.segments || []).map((seg: WhisperSegment) => ({
          start: seg.start,
          end: seg.end,
          text: seg.text.trim(),
          confidence: 1 - seg.no_speech_prob, // Convert no_speech_prob to confidence
        })),
      };
    } catch (error) {
      logger.error('Whisper transcription failed', error);
      throw error;
    }
  }

  // ============================================
  // Word-Level Timestamps (for precise cutting)
  // ============================================

  /**
   * Transcribe with word-level timestamps for precise silence detection
   * Uses timestamp_granularities parameter for word-level timing
   */
  async transcribeWithTimestamps(
    audioBuffer: ArrayBuffer,
    options: Omit<WhisperOptions, 'responseFormat'> = {}
  ): Promise<WhisperTranscriptionResult> {
    logger.info('Starting Whisper transcription with word timestamps');

    try {
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: 'audio/wav' });
      formData.append('file', blob, 'audio.wav');
      formData.append('model', WHISPER_MODEL);
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'word');
      formData.append('timestamp_granularities[]', 'segment');

      if (options.language) {
        formData.append('language', options.language);
      }
      if (options.prompt) {
        formData.append('prompt', options.prompt);
      }
      if (options.temperature !== undefined) {
        formData.append('temperature', options.temperature.toString());
      }

      const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw await this.handleError(response);
      }

      const data: WhisperTranscriptionResult = await response.json();
      logger.debug(`Transcribed ${data.words?.length || 0} words`);

      return data;
    } catch (error) {
      logger.error('Whisper transcription with timestamps failed', error);
      throw error;
    }
  }

  // ============================================
  // Transcribe Speech Segments Only
  // ============================================

  /**
   * Transcribe only the speech segments (skip silences)
   * Used after silence detection to save API costs
   * @param audioBuffer - Full audio buffer
   * @param speechRegions - Array of {start, end} for speech segments
   */
  async transcribeSpeechSegments(
    audioBuffer: ArrayBuffer,
    speechRegions: Array<{ start: number; end: number }>,
    options: WhisperOptions = {}
  ): Promise<{
    fullText: string;
    segments: Array<{
      regionIndex: number;
      start: number;
      end: number;
      text: string;
      words?: WhisperWord[];
    }>;
  }> {
    logger.info(`Transcribing ${speechRegions.length} speech segments`);

    // For now, transcribe the full audio and filter results
    // In the future, we could slice audio to each segment for cost savings
    const result = await this.transcribeWithTimestamps(audioBuffer, options);

    // Map words/segments to speech regions
    const segments = speechRegions.map((region, index) => {
      const regionWords = (result.words || []).filter(
        (word) => word.start >= region.start && word.end <= region.end
      );

      const regionText = regionWords
        .map((w) => w.word)
        .join(' ')
        .trim();

      return {
        regionIndex: index,
        start: region.start,
        end: region.end,
        text: regionText || '',
        words: regionWords,
      };
    });

    return {
      fullText: result.text,
      segments,
    };
  }

  // ============================================
  // API Key Validation
  // ============================================

  /**
   * Check if the API key is valid by making a simple API call
   */
  async checkApiKey(): Promise<boolean> {
    try {
      // Use the models endpoint to verify key
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (response.ok) {
        logger.debug('OpenAI API key is valid');
        return true;
      }

      if (response.status === 401) {
        logger.warn('OpenAI API key is invalid');
        return false;
      }

      logger.warn(`OpenAI API check returned status ${response.status}`);
      return false;
    } catch (error) {
      logger.error('Failed to validate OpenAI API key', error);
      return false;
    }
  }

  // ============================================
  // Utility Methods
  // ============================================

  private createFormData(audioBuffer: ArrayBuffer, options: WhisperOptions): FormData {
    const formData = new FormData();

    // Determine audio type from buffer or default to wav
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');
    formData.append('model', WHISPER_MODEL);

    if (options.responseFormat) {
      formData.append('response_format', options.responseFormat);
    }
    if (options.language) {
      formData.append('language', options.language);
    }
    if (options.prompt) {
      formData.append('prompt', options.prompt);
    }
    if (options.temperature !== undefined) {
      formData.append('temperature', options.temperature.toString());
    }

    return formData;
  }

  private async handleError(response: Response): Promise<Error> {
    let message = `Whisper API error: ${response.status} ${response.statusText}`;

    try {
      const data = await response.json();
      if (data.error?.message) {
        message = data.error.message;
      }
    } catch {
      // Response is not JSON
    }

    // Add specific handling for common errors
    if (response.status === 401) {
      message = 'Invalid OpenAI API key. Please check your API key in settings.';
    } else if (response.status === 429) {
      message = 'OpenAI rate limit exceeded. Please try again later.';
    } else if (response.status === 413) {
      message = 'Audio file too large. Maximum size is 25MB.';
    } else if (response.status === 400) {
      message = 'Invalid audio format or corrupted file.';
    }

    return new Error(message);
  }

  /**
   * Update the API key (e.g., when user changes it in settings)
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Get estimated transcription cost based on audio duration
   * Whisper pricing: $0.006 per minute
   */
  static estimateCost(durationSeconds: number): number {
    const minutes = durationSeconds / 60;
    return minutes * 0.006;
  }

  /**
   * Check if audio format is supported
   */
  static isSupportedFormat(mimeType: string): boolean {
    return SUPPORTED_FORMATS.includes(mimeType);
  }
}

/**
 * Create a Whisper client with the given API key
 */
export function createWhisperClient(apiKey: string): WhisperClient {
  return new WhisperClient(apiKey);
}
