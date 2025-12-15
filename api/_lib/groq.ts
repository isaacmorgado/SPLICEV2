/**
 * Groq API client for transcription
 * Uses Whisper large-v3 model at ~$0.002/minute (67% cheaper than OpenAI)
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
}

export interface GroqTranscriptionResult {
  text: string;
  words: TranscriptionWord[];
  duration: number;
  language?: string;
}

export interface GroqTranscriptionOptions {
  language?: string;
  responseFormat?: 'json' | 'verbose_json' | 'text' | 'srt' | 'vtt';
}

/**
 * Transcribe audio using Groq's Whisper API
 * @param audioBuffer - Audio data as Buffer
 * @param options - Transcription options
 * @returns Transcription result with word-level timestamps
 */
export async function transcribeWithGroq(
  audioBuffer: Buffer,
  options: GroqTranscriptionOptions = {}
): Promise<GroqTranscriptionResult> {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }

  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer]), 'audio.wav');
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', options.responseFormat || 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');

  if (options.language) {
    formData.append('language', options.language);
  }

  const response = await fetchWithRetry(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Groq Whisper error:', error);
    throw new Error(`Groq transcription failed: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    text: string;
    words?: { word: string; start: number; end: number }[];
    duration?: number;
    language?: string;
  };

  // Extract word-level timestamps
  const words: TranscriptionWord[] = (data.words || []).map((w) => ({
    word: w.word,
    start: w.start,
    end: w.end,
  }));

  return {
    text: data.text,
    words,
    duration: data.duration || 0,
    language: data.language,
  };
}

/**
 * Fetch with exponential backoff retry
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Retry on rate limit or server errors
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = response.headers.get('retry-after');
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, attempt) * 1000;

        console.warn(`Groq API returned ${response.status}, retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Groq API attempt ${attempt + 1} failed:`, lastError.message);

      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Groq API request failed after retries');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
