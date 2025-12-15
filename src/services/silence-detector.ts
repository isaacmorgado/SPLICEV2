import { logger } from '../lib/logger';
import { aiServices } from '../api/ai-services';

/**
 * Represents a detected silent section in the timeline.
 */
export interface SilentSection {
  start: number; // Timeline position in seconds
  end: number; // Timeline position in seconds
  duration: number; // Gap duration in seconds
  isNatural: boolean; // True if LLM determines this is a natural pause
  confidence: number; // 0-1 confidence in the classification
}

interface Gap {
  start: number;
  end: number;
  duration: number;
  precedingText?: string;
  followingText?: string;
}

interface DetectionOptions {
  audioBuffer: ArrayBuffer;
  thresholdDb?: number; // Not used with transcription-based detection
  useVoiceIsolation?: boolean;
  useAIAnalysis?: boolean;
  minGapDuration?: number; // Minimum gap to consider (seconds)
}

/**
 * Detects silence/gaps in audio using transcription and AI analysis.
 *
 * Pipeline:
 * 1. (Optional) Voice isolation for cleaner transcription
 * 2. Transcribe with word-level timestamps
 * 3. Find gaps between words
 * 4. Use LLM to classify gaps as natural vs cuttable
 */
export class SilenceDetector {
  private readonly DEFAULT_MIN_GAP = 0.3; // 300ms minimum
  private readonly MAX_NATURAL_GAP = 1.5; // 1.5s heuristic threshold

  /**
   * Main entry point for silence detection.
   */
  async detectSilence(options: DetectionOptions): Promise<SilentSection[]> {
    const {
      audioBuffer,
      useVoiceIsolation = false,
      useAIAnalysis = true,
      minGapDuration = this.DEFAULT_MIN_GAP,
    } = options;

    logger.info('Starting silence detection', {
      bufferSize: audioBuffer.byteLength,
      useVoiceIsolation,
      useAIAnalysis,
    });

    try {
      // Step 1: Optional voice isolation
      let processedAudio = audioBuffer;
      if (useVoiceIsolation) {
        logger.info('Applying voice isolation...');
        try {
          const isolated = await aiServices.isolateVoice(audioBuffer);
          processedAudio = isolated.vocals;
          logger.info('Voice isolation complete');
        } catch (error) {
          logger.warn('Voice isolation failed, using original audio', error);
        }
      }

      // Step 2: Transcribe with word-level timestamps
      logger.info('Transcribing audio with timestamps...');
      const transcription = await aiServices.transcribeWithTimestamps(processedAudio);

      if (!transcription.words || transcription.words.length === 0) {
        logger.warn('No words in transcription, checking segments');
        // Fall back to segment-based detection
        if (transcription.segments && transcription.segments.length > 0) {
          return this.detectFromSegments(transcription.segments, minGapDuration, useAIAnalysis);
        }
        logger.warn('No transcription data available');
        return [];
      }

      // Step 3: Find gaps between words
      const gaps = this.findGapsFromWords(transcription.words, minGapDuration);
      logger.info(`Found ${gaps.length} gaps above ${minGapDuration}s threshold`);

      if (gaps.length === 0) {
        return [];
      }

      // Step 4: Classify gaps using AI or heuristics
      let sections: SilentSection[];
      if (useAIAnalysis && transcription.segments) {
        logger.info('Using AI to classify gaps...');
        sections = await this.classifyGapsWithAI(gaps, transcription.segments);
      } else {
        logger.info('Using heuristics to classify gaps...');
        sections = this.classifyGapsWithHeuristics(gaps);
      }

      // Filter to only cuttable sections (not natural pauses)
      const cuttableSections = sections.filter((s) => !s.isNatural);
      logger.info(`Identified ${cuttableSections.length} cuttable silent sections`);

      return cuttableSections;
    } catch (error) {
      logger.error('Silence detection failed', error);
      throw error;
    }
  }

  /**
   * Find gaps between words from Whisper transcription.
   */
  private findGapsFromWords(words: WhisperWord[], minDuration: number): Gap[] {
    const gaps: Gap[] = [];

    for (let i = 0; i < words.length - 1; i++) {
      const current = words[i];
      const next = words[i + 1];
      const gapStart = current.end;
      const gapEnd = next.start;
      const duration = gapEnd - gapStart;

      if (duration >= minDuration) {
        gaps.push({
          start: gapStart,
          end: gapEnd,
          duration,
          precedingText: current.word,
          followingText: next.word,
        });
      }
    }

    return gaps;
  }

  /**
   * Fall back to segment-based detection when word timestamps aren't available.
   */
  private async detectFromSegments(
    segments: WhisperSegment[],
    minDuration: number,
    useAIAnalysis: boolean
  ): Promise<SilentSection[]> {
    const gaps: Gap[] = [];

    for (let i = 0; i < segments.length - 1; i++) {
      const current = segments[i];
      const next = segments[i + 1];
      const gapStart = current.end;
      const gapEnd = next.start;
      const duration = gapEnd - gapStart;

      if (duration >= minDuration) {
        gaps.push({
          start: gapStart,
          end: gapEnd,
          duration,
          precedingText: current.text.trim(),
          followingText: next.text.trim(),
        });
      }
    }

    if (gaps.length === 0) {
      return [];
    }

    if (useAIAnalysis) {
      return this.classifyGapsWithAI(gaps, segments);
    }
    return this.classifyGapsWithHeuristics(gaps);
  }

  /**
   * Use LLM to classify gaps as natural pauses vs cuttable silence.
   */
  private async classifyGapsWithAI(
    gaps: Gap[],
    segments: WhisperSegment[]
  ): Promise<SilentSection[]> {
    try {
      // Convert segments for the AI service
      const transcriptionSegments: TranscriptionSegment[] = segments.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        confidence: 1 - s.no_speech_prob,
      }));

      // Get pause analysis from AI
      const analysis = await aiServices.detectNaturalPauses(transcriptionSegments);

      // Map gaps to sections with AI classification
      return gaps.map((gap) => {
        // Find matching pause analysis
        const pauseMatch = analysis.pauses.find(
          (p) => Math.abs(p.start - gap.start) < 0.1 && Math.abs(p.end - gap.end) < 0.1
        );

        if (pauseMatch) {
          return {
            start: gap.start,
            end: gap.end,
            duration: gap.duration,
            isNatural: pauseMatch.isNatural,
            confidence: pauseMatch.confidence,
          };
        }

        // Gap not analyzed by AI, use heuristic
        return {
          start: gap.start,
          end: gap.end,
          duration: gap.duration,
          isNatural: gap.duration < this.MAX_NATURAL_GAP,
          confidence: 0.5,
        };
      });
    } catch (error) {
      logger.warn('AI classification failed, falling back to heuristics', error);
      return this.classifyGapsWithHeuristics(gaps);
    }
  }

  /**
   * Simple heuristic-based classification when AI isn't available.
   */
  private classifyGapsWithHeuristics(gaps: Gap[]): SilentSection[] {
    return gaps.map((gap) => {
      // Simple rule: shorter gaps are more likely natural
      const isNatural = gap.duration < this.MAX_NATURAL_GAP;

      // Confidence decreases as we approach the threshold
      let confidence: number;
      if (isNatural) {
        // Natural: higher confidence for shorter gaps
        confidence = Math.max(0.5, 1 - gap.duration / this.MAX_NATURAL_GAP);
      } else {
        // Cuttable: higher confidence for longer gaps
        confidence = Math.min(0.95, 0.5 + (gap.duration - this.MAX_NATURAL_GAP) / 3);
      }

      return {
        start: gap.start,
        end: gap.end,
        duration: gap.duration,
        isNatural,
        confidence,
      };
    });
  }

  /**
   * Create mock detection results for testing.
   */
  createMockDetection(totalDuration: number): SilentSection[] {
    // Generate some realistic-looking mock data
    const sections: SilentSection[] = [];
    const numSections = Math.floor(Math.random() * 8) + 4; // 4-11 sections

    let currentTime = Math.random() * 5 + 2; // Start 2-7s in

    for (let i = 0; i < numSections && currentTime < totalDuration - 5; i++) {
      const duration = Math.random() * 2 + 0.5; // 0.5-2.5s gaps
      const isNatural = duration < 1.2 && Math.random() > 0.4;

      if (!isNatural) {
        sections.push({
          start: currentTime,
          end: currentTime + duration,
          duration,
          isNatural,
          confidence: Math.random() * 0.3 + 0.7, // 0.7-1.0
        });
      }

      // Move forward
      currentTime += duration + Math.random() * 15 + 5; // 5-20s between gaps
    }

    return sections;
  }
}

// Singleton instance
export const silenceDetector = new SilenceDetector();
