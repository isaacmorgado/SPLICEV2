/**
 * Voice Isolation Client for Modal/Demucs
 * Uses htdemucs_ft model for state-of-the-art voice isolation
 * Cost: ~$0.01 per minute of audio (97% cheaper than ElevenLabs)
 */

export interface VoiceIsolationResult {
  vocalsBase64: string;
  accompanimentBase64?: string;
  durationSeconds: number;
}

export interface VoiceIsolationOptions {
  returnAccompaniment?: boolean;
  timeout?: number;
}

/**
 * Isolate vocals from audio using Demucs on Modal
 * @param audioBuffer - Audio data as Buffer
 * @param options - Isolation options
 * @returns Isolated vocals and optionally accompaniment
 */
export async function isolateVoiceWithDemucs(
  audioBuffer: Buffer,
  options: VoiceIsolationOptions = {}
): Promise<VoiceIsolationResult> {
  const modalUrl = process.env.MODAL_VOICE_ISOLATION_URL;

  if (!modalUrl) {
    throw new Error('MODAL_VOICE_ISOLATION_URL environment variable is not set');
  }

  const audioBase64 = audioBuffer.toString('base64');

  const response = await fetchWithRetry(
    modalUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_base64: audioBase64,
        return_accompaniment: options.returnAccompaniment || false,
      }),
    },
    options.timeout || 300000 // 5 minute default timeout
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('Modal voice isolation error:', error);
    throw new Error(`Voice isolation failed: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    success: boolean;
    error?: string;
    vocals_base64: string;
    accompaniment_base64?: string;
    duration_seconds: number;
  };

  if (!data.success) {
    throw new Error(`Voice isolation failed: ${data.error}`);
  }

  return {
    vocalsBase64: data.vocals_base64,
    accompanimentBase64: data.accompaniment_base64,
    durationSeconds: data.duration_seconds,
  };
}

/**
 * Fetch with timeout and retry
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  maxRetries = 2
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Retry on server errors (Modal cold start can sometimes fail)
      if (response.status >= 500) {
        console.warn(`Modal returned ${response.status}, retrying...`);
        await sleep(2000);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (lastError.name === 'AbortError') {
        throw new Error('Voice isolation timed out');
      }

      console.error(`Modal attempt ${attempt + 1} failed:`, lastError.message);

      if (attempt < maxRetries - 1) {
        await sleep(2000);
      }
    }
  }

  throw lastError || new Error('Voice isolation failed after retries');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
