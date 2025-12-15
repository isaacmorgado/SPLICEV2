import { logger } from '../lib/logger';

/**
 * LLM Provider interface for pluggable AI backends
 */
export interface LLMProvider {
  name: string;

  /**
   * Analyze transcript text with a custom prompt
   */
  analyzeTranscript(transcript: string, prompt: string): Promise<string>;

  /**
   * Detect natural pauses in transcription segments
   * Used to distinguish intentional pauses from silence that should be cut
   */
  detectNaturalPauses(segments: TranscriptionSegment[]): Promise<PauseAnalysis>;

  /**
   * Validate the API key
   */
  checkApiKey(): Promise<boolean>;
}

// ============================================
// OpenAI Provider
// ============================================

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

export class OpenAIProvider implements LLMProvider {
  name = 'OpenAI';
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, model: string = DEFAULT_OPENAI_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = OPENAI_BASE_URL;
  }

  async analyzeTranscript(transcript: string, prompt: string): Promise<string> {
    logger.info(`Analyzing transcript with OpenAI ${this.model}`);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert video editor assistant. Analyze transcripts and provide precise, actionable insights for editing.',
          },
          {
            role: 'user',
            content: `${prompt}\n\nTranscript:\n${transcript}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  async detectNaturalPauses(segments: TranscriptionSegment[]): Promise<PauseAnalysis> {
    logger.info('Detecting natural pauses with OpenAI');

    const segmentsJson = JSON.stringify(
      segments.map((s) => ({
        start: s.start.toFixed(2),
        end: s.end.toFixed(2),
        text: s.text,
      }))
    );

    const prompt = `Analyze these transcription segments and identify which pauses between segments are natural (intentional speech pauses, rhetorical pauses, thinking pauses) vs which are silence that could be cut (false starts, unintentional gaps, dead air).

For each gap between segments, determine:
1. Is it a natural pause (should be kept) or cuttable silence?
2. Confidence level (0-1)

Respond in JSON format:
{
  "pauses": [
    {"start": number, "end": number, "isNatural": boolean, "confidence": number}
  ]
}

Segments:
${segmentsJson}`;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert audio editor. Analyze speech patterns to identify natural vs unnatural pauses. Respond only with valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{"pauses": []}';

    try {
      return JSON.parse(content);
    } catch {
      logger.error('Failed to parse pause analysis response');
      return { pauses: [] };
    }
  }

  async checkApiKey(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async handleError(response: Response): Promise<Error> {
    let message = `OpenAI API error: ${response.status}`;
    try {
      const data = await response.json();
      message = data.error?.message || message;
    } catch {
      // Not JSON
    }

    if (response.status === 401) {
      message = 'Invalid OpenAI API key. Please check your API key in settings.';
    } else if (response.status === 429) {
      message = 'OpenAI rate limit exceeded. Please try again later.';
    } else if (response.status === 402) {
      message = 'OpenAI quota exceeded. Please check your account.';
    }

    return new Error(message);
  }
}

// ============================================
// Gemini Provider
// ============================================

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';

export class GeminiProvider implements LLMProvider {
  name = 'Gemini';
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, model: string = DEFAULT_GEMINI_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = GEMINI_BASE_URL;
  }

  async analyzeTranscript(transcript: string, prompt: string): Promise<string> {
    logger.info(`Analyzing transcript with Gemini ${this.model}`);

    const response = await fetch(
      `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `You are an expert video editor assistant. Analyze transcripts and provide precise, actionable insights for editing.\n\n${prompt}\n\nTranscript:\n${transcript}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2000,
          },
        }),
      }
    );

    if (!response.ok) {
      throw await this.handleError(response);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  async detectNaturalPauses(segments: TranscriptionSegment[]): Promise<PauseAnalysis> {
    logger.info('Detecting natural pauses with Gemini');

    const segmentsJson = JSON.stringify(
      segments.map((s) => ({
        start: s.start.toFixed(2),
        end: s.end.toFixed(2),
        text: s.text,
      }))
    );

    const prompt = `Analyze these transcription segments and identify which pauses between segments are natural (intentional speech pauses, rhetorical pauses, thinking pauses) vs which are silence that could be cut (false starts, unintentional gaps, dead air).

For each gap between segments, determine:
1. Is it a natural pause (should be kept) or cuttable silence?
2. Confidence level (0-1)

Respond ONLY with valid JSON in this exact format:
{
  "pauses": [
    {"start": number, "end": number, "isNatural": boolean, "confidence": number}
  ]
}

Segments:
${segmentsJson}`;

    const response = await fetch(
      `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2000,
          },
        }),
      }
    );

    if (!response.ok) {
      throw await this.handleError(response);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '{"pauses": []}';

    try {
      // Extract JSON from response (Gemini might include markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return { pauses: [] };
    } catch {
      logger.error('Failed to parse Gemini pause analysis response');
      return { pauses: [] };
    }
  }

  async checkApiKey(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models?key=${this.apiKey}`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async handleError(response: Response): Promise<Error> {
    let message = `Gemini API error: ${response.status}`;
    try {
      const data = await response.json();
      message = data.error?.message || message;
    } catch {
      // Not JSON
    }

    if (response.status === 400 || response.status === 403) {
      message = 'Invalid Gemini API key. Please check your API key in settings.';
    } else if (response.status === 429) {
      message = 'Gemini rate limit exceeded. Please try again later.';
    }

    return new Error(message);
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create an LLM provider instance
 * @param type - 'openai' or 'gemini'
 * @param apiKey - API key for the provider
 * @param model - Optional model override
 */
export function createLLMProvider(
  type: LLMProviderType,
  apiKey: string,
  model?: string
): LLMProvider {
  switch (type) {
    case 'openai':
      return new OpenAIProvider(apiKey, model || DEFAULT_OPENAI_MODEL);
    case 'gemini':
      return new GeminiProvider(apiKey, model || DEFAULT_GEMINI_MODEL);
    default:
      throw new Error(`Unknown LLM provider type: ${type}`);
  }
}

/**
 * Get the default model for a provider type
 */
export function getDefaultModel(type: LLMProviderType): string {
  switch (type) {
    case 'openai':
      return DEFAULT_OPENAI_MODEL;
    case 'gemini':
      return DEFAULT_GEMINI_MODEL;
    default:
      return DEFAULT_OPENAI_MODEL;
  }
}
