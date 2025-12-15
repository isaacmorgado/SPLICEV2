import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../_lib/auth';
import { hasEnoughMinutes, trackUsage, estimateMinutes } from '../_lib/usage';

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

    // Create form data for ElevenLabs
    const formData = new FormData();
    formData.append('audio', new Blob([audioBuffer]), 'audio.wav');

    // Call ElevenLabs API
    const apiKey = userApiKey || process.env.ELEVENLABS_API_KEY;
    const response = await fetch(ELEVENLABS_API_URL, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey!,
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

    // Get isolated audio
    const isolatedAudio = await response.arrayBuffer();
    const isolatedBase64 = Buffer.from(isolatedAudio).toString('base64');

    // Track usage (only if using platform API key)
    if (!userApiKey) {
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
