import { logger } from '../lib/logger';
import { aiServices } from '../api/ai-services';

/**
 * Default configuration for take detection
 */
const DEFAULT_CONFIG: TakeDetectorConfig = {
  // Green (1), Yellow (3), Orange (5), Purple (9), Blue (7), Cyan (11)
  colorRotation: [1, 3, 5, 9, 7, 11],
  clipNameFormat: "Take {takeNumber} - '{phrase}'",
  phrasePreviewLength: 30,
};

/**
 * Service for detecting and managing takes in video content.
 *
 * Pipeline:
 * 1. Transcribe audio from timeline
 * 2. Send transcript to AI for take analysis
 * 3. Normalize and enhance take data
 * 4. Provide methods to apply takes to timeline
 */
export class TakeDetector {
  private config: TakeDetectorConfig;

  constructor(config: Partial<TakeDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze transcript and detect takes
   * Returns normalized take groups with colors and clip names assigned
   */
  async detectTakes(transcript: string): Promise<TakeGroup[]> {
    logger.info('Starting take detection...');

    try {
      // Call AI service to analyze takes
      const analysis = await aiServices.analyzeTakes(transcript);

      if (!analysis.takes || analysis.takes.length === 0) {
        logger.info('No takes detected in transcript');
        return [];
      }

      // Group takes by phrase and normalize
      const groups = this.groupAndNormalizeTakes(analysis.takes);

      logger.info(
        `Detected ${groups.length} take groups with ${analysis.takes.length} total takes`
      );
      return groups;
    } catch (error) {
      logger.error('Take detection failed', error);
      throw error;
    }
  }

  /**
   * Group raw takes by phrase and normalize them
   */
  private groupAndNormalizeTakes(
    rawTakes: Array<{
      start: number;
      end: number;
      text: string;
      isBest: boolean;
      score: number;
    }>
  ): TakeGroup[] {
    // Group by similar phrases (using simple text similarity for now)
    const groups = new Map<string, NormalizedTake[]>();
    let globalTakeCounter = 0;

    for (const take of rawTakes) {
      // Find or create group for this phrase
      const phraseKey = this.normalizePhrase(take.text);

      if (!groups.has(phraseKey)) {
        groups.set(phraseKey, []);
      }

      const groupTakes = groups.get(phraseKey)!;
      const takeNumber = groupTakes.length + 1;
      const colorIndex =
        this.config.colorRotation[globalTakeCounter % this.config.colorRotation.length];

      // Generate clip name
      const phrasePreview = take.text.slice(0, this.config.phrasePreviewLength);
      const clipName = this.config.clipNameFormat
        .replace('{takeNumber}', String(takeNumber))
        .replace('{phrase}', phrasePreview);

      groupTakes.push({
        groupId: phraseKey,
        phrase: take.text,
        takeNumber,
        start: take.start,
        end: take.end,
        text: take.text,
        isBest: take.isBest,
        score: take.score,
        colorIndex,
        clipName,
      });

      globalTakeCounter++;
    }

    // Convert to TakeGroup array
    const result: TakeGroup[] = [];

    groups.forEach((takes, _phrase) => {
      // Find best take in group
      const bestIndex = takes.findIndex((t) => t.isBest);
      const bestTakeIndex =
        bestIndex >= 0
          ? bestIndex
          : takes.reduce((best, t, i) => (t.score > takes[best].score ? i : best), 0);

      result.push({
        id: takes[0].groupId,
        phrase: takes[0].text.slice(0, 50),
        takes,
        bestTakeIndex,
      });
    });

    return result;
  }

  /**
   * Normalize phrase for grouping (basic implementation)
   */
  private normalizePhrase(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50);
  }

  /**
   * Get a flat list of all takes from groups
   */
  flattenTakeGroups(groups: TakeGroup[]): NormalizedTake[] {
    return groups.flatMap((g) => g.takes);
  }

  /**
   * Get color name for display in UI
   */
  getColorName(colorIndex: number): string {
    const colorNames: Record<number, string> = {
      1: 'Green',
      3: 'Yellow',
      5: 'Orange',
      7: 'Blue',
      9: 'Purple',
      11: 'Cyan',
    };
    return colorNames[colorIndex] || `Color ${colorIndex}`;
  }

  /**
   * Get CSS color for UI preview
   */
  getColorCSS(colorIndex: number): string {
    const colorCSS: Record<number, string> = {
      1: '#8dc63f', // Green
      3: '#f7df1e', // Yellow
      5: '#ff9900', // Orange
      7: '#0066cc', // Blue
      9: '#9b59b6', // Purple
      11: '#00bcd4', // Cyan
    };
    return colorCSS[colorIndex] || '#888888';
  }

  /**
   * Create mock take groups for development/testing
   */
  createMockTakeGroups(): TakeGroup[] {
    const mockTakes: Array<{
      start: number;
      end: number;
      text: string;
      isBest: boolean;
      score: number;
    }> = [
      {
        start: 5.2,
        end: 12.4,
        text: 'Hey guys, welcome back to the channel',
        isBest: false,
        score: 0.72,
      },
      {
        start: 15.1,
        end: 22.8,
        text: 'Hey guys, welcome back to the channel',
        isBest: true,
        score: 0.94,
      },
      {
        start: 25.5,
        end: 32.1,
        text: 'Hey guys, welcome back to the channel',
        isBest: false,
        score: 0.81,
      },
      {
        start: 45.0,
        end: 58.2,
        text: "Today we're going to talk about editing",
        isBest: true,
        score: 0.88,
      },
      {
        start: 62.3,
        end: 74.1,
        text: "Today we're going to talk about editing",
        isBest: false,
        score: 0.76,
      },
    ];

    return this.groupAndNormalizeTakes(mockTakes);
  }
}

// Singleton instance
export const takeDetector = new TakeDetector();
