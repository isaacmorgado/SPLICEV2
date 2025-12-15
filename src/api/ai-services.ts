import { logger } from '../lib/logger';
import { BackendClient, backendClient } from './backend-client';
import { WhisperClient } from './whisper';
import { ElevenLabsClient } from './elevenlabs';
import { LLMProvider } from './llm-provider';

interface ColorMatchResult {
  success: boolean;
  adjustments: ColorAdjustment[];
  processingTime: number;
}

interface ColorAdjustment {
  clipId: string;
  temperature: number;
  tint: number;
  exposure: number;
  contrast: number;
  saturation: number;
}

type AIServicesMode = 'proxy' | 'byok';

interface AIServicesOptions {
  whisperClient?: WhisperClient;
  elevenLabsClient?: ElevenLabsClient;
  llmProvider?: LLMProvider;
}

/**
 * AI Services integration for Splice
 * Supports two modes:
 * - Proxy mode (default): Routes all AI calls through backend (secure, metered)
 * - BYOK mode: Uses direct API calls when user provides their own keys
 */
export class AIServices {
  private backend: BackendClient;
  private whisperClient?: WhisperClient;
  private elevenLabsClient?: ElevenLabsClient;
  private llmProvider?: LLMProvider;
  private mode: AIServicesMode;

  constructor(backend: BackendClient = backendClient, options: AIServicesOptions = {}) {
    this.backend = backend;
    this.whisperClient = options.whisperClient;
    this.elevenLabsClient = options.elevenLabsClient;
    this.llmProvider = options.llmProvider;

    // Auto-detect mode based on available clients
    this.mode = this.detectMode();
    logger.info(`AIServices initialized in ${this.mode} mode`);
  }

  // ============================================
  // Mode Detection & Configuration
  // ============================================

  private detectMode(): AIServicesMode {
    // If any direct client is provided, assume BYOK mode
    if (this.whisperClient || this.elevenLabsClient || this.llmProvider) {
      return 'byok';
    }
    return 'proxy';
  }

  getMode(): AIServicesMode {
    return this.mode;
  }

  setMode(mode: AIServicesMode): void {
    this.mode = mode;
    logger.info(`AIServices mode changed to ${mode}`);
  }

  /**
   * Update BYOK clients (e.g., when user adds/removes API keys)
   */
  setClients(options: AIServicesOptions): void {
    this.whisperClient = options.whisperClient ?? this.whisperClient;
    this.elevenLabsClient = options.elevenLabsClient ?? this.elevenLabsClient;
    this.llmProvider = options.llmProvider ?? this.llmProvider;
    this.mode = this.detectMode();
  }

  // ============================================
  // Transcription
  // ============================================

  /**
   * Transcribe audio using AI speech-to-text
   * Routes to Whisper BYOK client or backend proxy based on mode
   */
  async transcribe(
    audioBuffer: ArrayBuffer,
    options: WhisperOptions = {}
  ): Promise<TranscriptionResult> {
    logger.info(`Starting transcription (${this.mode} mode)`);

    if (this.mode === 'byok' && this.whisperClient) {
      return this.whisperClient.transcribe(audioBuffer, options);
    }

    // Proxy mode - use backend
    return this.backend.transcribe(audioBuffer);
  }

  /**
   * Transcribe with word-level timestamps for precise silence detection
   * Only available in BYOK mode (backend doesn't return word timestamps yet)
   */
  async transcribeWithTimestamps(
    audioBuffer: ArrayBuffer,
    options: Omit<WhisperOptions, 'responseFormat'> = {}
  ): Promise<WhisperTranscriptionResult> {
    logger.info(`Starting transcription with timestamps (${this.mode} mode)`);

    if (this.mode === 'byok' && this.whisperClient) {
      return this.whisperClient.transcribeWithTimestamps(audioBuffer, options);
    }

    // Proxy mode - backend transcription (may not have word-level timestamps)
    const result = await this.backend.transcribe(audioBuffer);

    // Convert to WhisperTranscriptionResult format
    return {
      task: 'transcribe',
      language: 'en',
      duration: 0,
      text: result.text,
      segments: result.segments.map((seg, idx) => ({
        id: idx,
        seek: 0,
        start: seg.start,
        end: seg.end,
        text: seg.text,
        tokens: [],
        temperature: 0,
        avg_logprob: 0,
        compression_ratio: 0,
        no_speech_prob: 1 - seg.confidence,
      })),
    };
  }

  /**
   * Generate captions/subtitles from audio
   */
  async generateCaptions(audioBuffer: ArrayBuffer): Promise<TranscriptionSegment[]> {
    const result = await this.transcribe(audioBuffer);
    return result.segments;
  }

  // ============================================
  // Voice Isolation
  // ============================================

  /**
   * Isolate voice from background audio
   * Routes to ElevenLabs BYOK client or backend proxy based on mode
   */
  async isolateVoice(audioBuffer: ArrayBuffer): Promise<IsolatedAudio> {
    logger.info(`Starting voice isolation (${this.mode} mode)`);

    if (this.mode === 'byok' && this.elevenLabsClient) {
      return this.elevenLabsClient.isolateVoice(audioBuffer);
    }

    // Proxy mode - use backend
    return this.backend.isolateVoice(audioBuffer);
  }

  // ============================================
  // LLM Analysis
  // ============================================

  /**
   * Analyze transcript text with a custom prompt
   * Routes to LLM BYOK provider or backend proxy based on mode
   */
  async analyzeTranscript(transcript: string, prompt: string): Promise<string> {
    logger.info(`Starting transcript analysis (${this.mode} mode)`);

    if (this.mode === 'byok' && this.llmProvider) {
      return this.llmProvider.analyzeTranscript(transcript, prompt);
    }

    // Proxy mode - use backend's analyze endpoint
    const result = await this.backend.analyzeTakes(transcript);
    // Convert take analysis to text format
    return result.takes
      .map((t) => `[${t.start.toFixed(2)}-${t.end.toFixed(2)}] ${t.text} (score: ${t.score})`)
      .join('\n');
  }

  /**
   * Detect natural pauses in transcription segments
   * Used to distinguish intentional pauses from cuttable silence
   */
  async detectNaturalPauses(segments: TranscriptionSegment[]): Promise<PauseAnalysis> {
    logger.info(`Detecting natural pauses (${this.mode} mode)`);

    if (this.mode === 'byok' && this.llmProvider) {
      return this.llmProvider.detectNaturalPauses(segments);
    }

    // Proxy mode - derive pauses from take analysis
    // Since backend doesn't have a dedicated pause endpoint,
    // we'll analyze gaps between segments
    const pauses: PauseAnalysis['pauses'] = [];

    for (let i = 0; i < segments.length - 1; i++) {
      const current = segments[i];
      const next = segments[i + 1];
      const gapStart = current.end;
      const gapEnd = next.start;
      const gapDuration = gapEnd - gapStart;

      // Only consider gaps > 0.3 seconds
      if (gapDuration > 0.3) {
        // Heuristic: shorter gaps with high confidence are more likely natural
        const isNatural = gapDuration < 1.5 && current.confidence > 0.8;
        pauses.push({
          start: gapStart,
          end: gapEnd,
          isNatural,
          confidence: current.confidence,
        });
      }
    }

    return { pauses };
  }

  /**
   * Analyze takes (multiple recordings of same content)
   * Returns best take recommendations
   */
  async analyzeTakes(transcript: string): Promise<TakeAnalysis> {
    logger.info(`Analyzing takes (${this.mode} mode)`);

    if (this.mode === 'byok' && this.llmProvider) {
      // Use LLM to analyze takes
      const prompt = `Analyze this transcript and identify different takes or attempts at saying the same content. For each take, rate its quality (0-1) based on clarity, confidence, and completeness. Mark the best take.

Return JSON in this format:
{
  "takes": [
    {"start": number, "end": number, "text": string, "isBest": boolean, "score": number}
  ]
}`;

      const response = await this.llmProvider.analyzeTranscript(transcript, prompt);
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch {
        logger.error('Failed to parse take analysis response');
      }
      return { takes: [] };
    }

    // Proxy mode - use backend
    // Backend returns { takeGroups: [...] }, need to normalize to { takes: [...] }
    const response = await this.backend.analyzeTakes(transcript);

    // Check if response has takeGroups format (from backend)
    if ('takeGroups' in response && Array.isArray((response as any).takeGroups)) {
      const takeGroups = (response as any).takeGroups as Array<{
        phrase: string;
        takes: Array<{
          takeNumber: number;
          startTime: number;
          endTime: number;
          confidence: number;
        }>;
      }>;

      // Flatten and normalize to TakeAnalysis format
      const takes: TakeAnalysis['takes'] = [];
      let bestScore = 0;
      let bestIndex = 0;

      for (const group of takeGroups) {
        for (const take of group.takes) {
          const takeData = {
            start: take.startTime,
            end: take.endTime,
            text: group.phrase,
            isBest: false,
            score: take.confidence,
          };

          if (take.confidence > bestScore) {
            bestScore = take.confidence;
            bestIndex = takes.length;
          }

          takes.push(takeData);
        }
      }

      // Mark best take
      if (takes.length > 0) {
        takes[bestIndex].isBest = true;
      }

      logger.info(`Normalized ${takeGroups.length} take groups into ${takes.length} takes`);
      return { takes };
    }

    return response;
  }

  // ============================================
  // Color Matching (Mock for now - future Vision API)
  // ============================================

  /**
   * AI-powered color matching across clips
   * Analyzes reference frames and suggests color grading adjustments
   */
  async colorMatch(): Promise<ColorMatchResult> {
    logger.info('Starting AI color match');

    try {
      // In production, this would:
      // 1. Extract reference frames from timeline
      // 2. Send to AI vision API for analysis
      // 3. Return color adjustment recommendations

      // Mock implementation for now
      await this.simulateProcessing(2000);

      return {
        success: true,
        adjustments: [
          {
            clipId: 'clip_001',
            temperature: 5200,
            tint: 0,
            exposure: 0.1,
            contrast: 10,
            saturation: 5,
          },
        ],
        processingTime: 2.1,
      };
    } catch (error) {
      logger.error('Color match failed', error);
      throw error;
    }
  }

  /**
   * AI content suggestions based on timeline analysis
   */
  async suggestEdits(timelineData: unknown): Promise<string[]> {
    logger.info('Getting AI edit suggestions');

    if (this.mode === 'byok' && this.llmProvider) {
      const prompt = `Based on this timeline data, suggest edits:
${JSON.stringify(timelineData, null, 2)}

Provide 3-5 specific, actionable suggestions.`;

      const response = await this.llmProvider.analyzeTranscript(
        JSON.stringify(timelineData),
        prompt
      );
      return response.split('\n').filter((line) => line.trim());
    }

    // Mock implementation
    await this.simulateProcessing(1500);

    return [
      'Consider adding B-roll at 00:45 to cover jump cut',
      'Audio levels vary significantly between clips 3-7',
      'Scene at 02:15 could benefit from color grading',
      'End credits could use motion graphics',
    ];
  }

  // ============================================
  // Utility Methods
  // ============================================

  private simulateProcessing(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if all required services are available
   */
  async checkServiceAvailability(): Promise<{
    transcription: boolean;
    voiceIsolation: boolean;
    llmAnalysis: boolean;
  }> {
    if (this.mode === 'byok') {
      const transcription = this.whisperClient ? await this.whisperClient.checkApiKey() : false;
      const voiceIsolation = this.elevenLabsClient
        ? await this.elevenLabsClient.checkApiKey()
        : false;
      const llmAnalysis = this.llmProvider ? await this.llmProvider.checkApiKey() : false;

      return { transcription, voiceIsolation, llmAnalysis };
    }

    // Proxy mode - check if authenticated with backend
    const isAuth = await this.backend.isAuthenticated();
    return {
      transcription: isAuth,
      voiceIsolation: isAuth,
      llmAnalysis: isAuth,
    };
  }
}

// Default singleton instance using proxy mode
export const aiServices = new AIServices();
