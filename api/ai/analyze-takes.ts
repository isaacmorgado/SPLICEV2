import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../_lib/auth';
import { hasEnoughMinutes, trackUsage, estimateMinutes } from '../_lib/usage';

type LLMProvider = 'openai' | 'gemini';

interface Take {
  phrase: string;
  takeNumber: number;
  startTime: number;
  endTime: number;
  confidence: number;
}

interface TakeGroup {
  phrase: string;
  takes: Take[];
}

const TAKE_ANALYSIS_PROMPT = `Analyze this transcript and identify repeated phrases that indicate multiple "takes" of the same content.

A "take" is when a speaker says the same or very similar phrase multiple times, typically because they're recording and want different versions to choose from.

For each group of takes, provide:
1. The common phrase being repeated
2. Each occurrence with:
   - Take number (1, 2, 3, etc.)
   - Start time (in seconds)
   - End time (in seconds)
   - Confidence score (0-1) that this is indeed a take

Transcript with timestamps:
{transcript}

Return your analysis as JSON in this exact format:
{
  "takeGroups": [
    {
      "phrase": "hey guys welcome back",
      "takes": [
        { "takeNumber": 1, "startTime": 0.5, "endTime": 2.3, "confidence": 0.95 },
        { "takeNumber": 2, "startTime": 5.1, "endTime": 7.2, "confidence": 0.92 }
      ]
    }
  ]
}

Only include phrases that are clearly repeated takes, not just similar words. Be conservative with confidence scores.`;

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

    const {
      transcript,
      durationSeconds,
      provider = 'openai',
      userApiKey,
    } = req.body as {
      transcript: string;
      durationSeconds?: number;
      provider?: LLMProvider;
      userApiKey?: string;
    };

    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    // Estimate usage
    const estimatedMinutes = await estimateMinutes('take_analysis', durationSeconds || 60);

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

    // Prepare prompt
    const prompt = TAKE_ANALYSIS_PROMPT.replace('{transcript}', transcript);

    // Call appropriate LLM
    let takeGroups: TakeGroup[];

    if (provider === 'gemini') {
      takeGroups = await analyzeWithGemini(prompt, userApiKey);
    } else {
      takeGroups = await analyzeWithOpenAI(prompt, userApiKey);
    }

    // Track usage (only if using platform API key)
    if (!userApiKey) {
      await trackUsage(payload.userId, 'take_analysis', estimatedMinutes);
    }

    return res.status(200).json({
      success: true,
      takeGroups,
      totalTakes: takeGroups.reduce((sum, g) => sum + g.takes.length, 0),
      minutesUsed: userApiKey ? 0 : estimatedMinutes,
    });
  } catch (error) {
    console.error('Take analysis error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function analyzeWithOpenAI(prompt: string, userApiKey?: string): Promise<TakeGroup[]> {
  const apiKey = userApiKey || process.env.OPENAI_API_KEY;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are an expert video editor assistant. Analyze transcripts to identify repeated takes. Always respond with valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = data.choices[0]?.message?.content;
  const parsed = JSON.parse(content) as { takeGroups?: TakeGroup[] };

  return parsed.takeGroups || [];
}

async function analyzeWithGemini(prompt: string, userApiKey?: string): Promise<TakeGroup[]> {
  const apiKey = userApiKey || process.env.GEMINI_API_KEY;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.3,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text: string }[] } }[];
  };
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(content || '{}') as { takeGroups?: TakeGroup[] };

  return parsed.takeGroups || [];
}
