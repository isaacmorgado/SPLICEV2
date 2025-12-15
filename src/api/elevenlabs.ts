import { logger } from '../lib/logger';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

/**
 * ElevenLabs API client for direct BYOK integration
 * Used when user provides their own ElevenLabs API key
 */
export class ElevenLabsClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = ELEVENLABS_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  // ============================================
  // Voice Isolation
  // ============================================

  /**
   * Isolate voice from background audio using ElevenLabs API
   * @param audioBuffer - Raw audio data (WAV format recommended)
   * @returns Separated vocals and background audio
   */
  async isolateVoice(audioBuffer: ArrayBuffer): Promise<IsolatedAudio> {
    logger.info('Starting voice isolation via ElevenLabs');

    try {
      const formData = new FormData();
      formData.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');

      const response = await fetch(`${this.baseUrl}/audio-isolation`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await this.handleError(response);
        throw error;
      }

      // The API returns the isolated vocals as audio
      // We need to handle the response format
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('audio')) {
        // Direct audio response
        const vocals = await response.arrayBuffer();
        return {
          vocals,
          background: new ArrayBuffer(0), // Background not returned by this endpoint
        };
      }

      // JSON response with base64 encoded audio
      const data = await response.json();
      return {
        vocals: this.base64ToArrayBuffer(data.audio || data.vocals),
        background: data.background
          ? this.base64ToArrayBuffer(data.background)
          : new ArrayBuffer(0),
      };
    } catch (error) {
      logger.error('Voice isolation failed', error);
      throw error;
    }
  }

  // ============================================
  // API Key Validation
  // ============================================

  /**
   * Check if the API key is valid by making a simple API call
   */
  async checkApiKey(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/user`, {
        method: 'GET',
        headers: {
          'xi-api-key': this.apiKey,
        },
      });

      if (response.ok) {
        logger.debug('ElevenLabs API key is valid');
        return true;
      }

      if (response.status === 401) {
        logger.warn('ElevenLabs API key is invalid');
        return false;
      }

      // Other errors might be transient
      logger.warn(`ElevenLabs API check returned status ${response.status}`);
      return false;
    } catch (error) {
      logger.error('Failed to validate ElevenLabs API key', error);
      return false;
    }
  }

  /**
   * Get user information and remaining credits
   */
  async getUserInfo(): Promise<{
    tier: string;
    characterCount: number;
    characterLimit: number;
    canExtendCharacterLimit: boolean;
  } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/user`, {
        method: 'GET',
        headers: {
          'xi-api-key': this.apiKey,
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return {
        tier: data.subscription?.tier || 'free',
        characterCount: data.subscription?.character_count || 0,
        characterLimit: data.subscription?.character_limit || 0,
        canExtendCharacterLimit: data.subscription?.can_extend_character_limit || false,
      };
    } catch (error) {
      logger.error('Failed to get ElevenLabs user info', error);
      return null;
    }
  }

  // ============================================
  // Utility Methods
  // ============================================

  private async handleError(response: Response): Promise<Error> {
    let message = `ElevenLabs API error: ${response.status} ${response.statusText}`;

    try {
      const data = await response.json();
      if (data.detail?.message) {
        message = data.detail.message;
      } else if (data.message) {
        message = data.message;
      } else if (typeof data.detail === 'string') {
        message = data.detail;
      }
    } catch {
      // Response is not JSON
    }

    // Add specific handling for common errors
    if (response.status === 401) {
      message = 'Invalid ElevenLabs API key. Please check your API key in settings.';
    } else if (response.status === 429) {
      message = 'ElevenLabs rate limit exceeded. Please try again later.';
    } else if (response.status === 402) {
      message = 'ElevenLabs quota exceeded. Please check your subscription.';
    }

    return new Error(message);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Update the API key (e.g., when user changes it in settings)
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }
}

/**
 * Create an ElevenLabs client with the given API key
 */
export function createElevenLabsClient(apiKey: string): ElevenLabsClient {
  return new ElevenLabsClient(apiKey);
}
