import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../_lib/auth';
import { hasEnoughMinutes, trackUsage, estimateMinutes } from '../_lib/usage';
import { isolateVoiceWithDemucs } from '../_lib/voice-isolation';

// Use global fetch types for Node.js 18+
declare const fetch: typeof globalThis.fetch;

// Fallback to ElevenLabs if user provides their own API key
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/audio-isolation';

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

    const { audioBase64, durationSeconds, userApiKey } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    // Estimate usage
    const estimatedMinutes = await estimateMinutes('voice_isolation', durationSeconds || 60);

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

    let isolatedBase64: string;

    if (userApiKey) {
      // BYOK: Use ElevenLabs with user's API key
      const formData = new FormData();
      formData.append('audio', new Blob([new Uint8Array(audioBuffer)]), 'audio.wav');

      const response = await fetch(ELEVENLABS_API_URL, {
        method: 'POST',
        headers: {
          'xi-api-key': userApiKey,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('ElevenLabs error:', error);
        return res.status(response.status).json({
          error: 'Voice isolation failed',
          details: error,
        });
      }

      const isolatedAudio = await response.arrayBuffer();
      isolatedBase64 = Buffer.from(isolatedAudio).toString('base64');
    } else {
      // Platform users: Use Demucs on Modal (97% cheaper than ElevenLabs)
      const result = await isolateVoiceWithDemucs(audioBuffer);
      isolatedBase64 = result.vocalsBase64;

      // Track usage after successful isolation
      await trackUsage(payload.userId, 'voice_isolation', estimatedMinutes);
    }

    return res.status(200).json({
      success: true,
      isolatedAudioBase64: isolatedBase64,
      minutesUsed: userApiKey ? 0 : estimatedMinutes,
    });
  } catch (error) {
    console.error('Voice isolation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
