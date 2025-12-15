import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../_lib/auth';
import { hasEnoughMinutes, trackUsage, estimateMinutes } from '../_lib/usage';
import { transcribeWithGroq } from '../_lib/groq';

// Fallback to OpenAI if user provides their own API key
const OPENAI_WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  text: string;
  words: TranscriptionWord[];
  duration: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate request
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { audioBase64, durationSeconds, language, userApiKey } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    // Estimate usage
    const estimatedMinutes = await estimateMinutes('transcription', durationSeconds || 60);

    // Check usage (skip if user provides their own API key)
    if (!userApiKey) {
      const hasMinutes = await hasEnoughMinutes(payload.userId, estimatedMinutes);
      if (!hasMinutes) {
        return res.status(402).json({
          error: 'Insufficient minutes',
          message: 'Please upgrade your plan or provide your own API key',
        });
      }
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    let result: TranscriptionResult;

    if (userApiKey) {
      // BYOK: Use OpenAI with user's API key
      const formData = new FormData();
      formData.append('file', new Blob([new Uint8Array(audioBuffer)]), 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'word');

      if (language) {
        formData.append('language', language);
      }

      const response = await fetch(OPENAI_WHISPER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userApiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('OpenAI Whisper error:', error);
        return res.status(response.status).json({
          error: 'Transcription failed',
          details: error,
        });
      }

      const data = (await response.json()) as {
        text: string;
        words?: { word: string; start: number; end: number }[];
        duration?: number;
      };

      result = {
        text: data.text,
        words: (data.words || []).map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
        })),
        duration: data.duration || durationSeconds,
      };
    } else {
      // Platform users: Use Groq (67% cheaper than OpenAI)
      const groqResult = await transcribeWithGroq(audioBuffer, { language });

      result = {
        text: groqResult.text,
        words: groqResult.words,
        duration: groqResult.duration || durationSeconds,
      };

      // Track usage after successful transcription
      await trackUsage(payload.userId, 'transcription', estimatedMinutes);
    }

    return res.status(200).json({
      success: true,
      transcription: result,
      minutesUsed: userApiKey ? 0 : estimatedMinutes,
    });
  } catch (error) {
    console.error('Transcription error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
