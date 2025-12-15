import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TakeDetector } from '../../src/services/take-detector';
import { aiServices } from '../../src/api/ai-services';

// Mock AI services
vi.mock('../../src/api/ai-services', () => ({
  aiServices: {
    analyzeTakes: vi.fn(),
  },
}));

describe('TakeDetector', () => {
  let detector: TakeDetector;

  beforeEach(() => {
    detector = new TakeDetector();
    vi.clearAllMocks();
  });

  describe('selection strategies', () => {
    it('defaults to best_only strategy', () => {
      expect(detector.getSelectionStrategy()).toBe('best_only');
    });

    it('allows changing selection strategy', () => {
      detector.setSelectionStrategy('all_takes');
      expect(detector.getSelectionStrategy()).toBe('all_takes');

      detector.setSelectionStrategy('manual');
      expect(detector.getSelectionStrategy()).toBe('manual');
    });
  });

  describe('detectTakes', () => {
    it('detects and groups takes with confidence scores', async () => {
      const mockAnalysis = {
        takes: [
          {
            start: 0,
            end: 5,
            text: 'Hello world',
            isBest: false,
            score: 0.8,
          },
          {
            start: 10,
            end: 15,
            text: 'Hello world',
            isBest: true,
            score: 0.95,
          },
        ],
      };

      vi.mocked(aiServices.analyzeTakes).mockResolvedValue(mockAnalysis);

      const groups = await detector.detectTakes('Hello world. Hello world.');

      expect(groups.length).toBe(1);
      expect(groups[0].takes.length).toBe(2);

      // Check that takes have confidence scores
      groups[0].takes.forEach((take) => {
        expect(take.confidence).toBeDefined();
        expect(take.confidence.boundaryAccuracy).toBeGreaterThanOrEqual(0);
        expect(take.confidence.boundaryAccuracy).toBeLessThanOrEqual(1);
        expect(take.confidence.textMatch).toBeGreaterThanOrEqual(0);
        expect(take.confidence.textMatch).toBeLessThanOrEqual(1);
        expect(take.confidence.audioQuality).toBeGreaterThanOrEqual(0);
        expect(take.confidence.audioQuality).toBeLessThanOrEqual(1);
        expect(take.confidence.overall).toBeGreaterThanOrEqual(0);
        expect(take.confidence.overall).toBeLessThanOrEqual(1);
      });
    });

    it('selects best take with best_only strategy', async () => {
      const mockAnalysis = {
        takes: [
          {
            start: 0,
            end: 5,
            text: 'Test phrase',
            isBest: false,
            score: 0.7,
          },
          {
            start: 10,
            end: 15,
            text: 'Test phrase',
            isBest: true,
            score: 0.95,
          },
          {
            start: 20,
            end: 25,
            text: 'Test phrase',
            isBest: false,
            score: 0.8,
          },
        ],
      };

      vi.mocked(aiServices.analyzeTakes).mockResolvedValue(mockAnalysis);
      detector.setSelectionStrategy('best_only');

      const groups = await detector.detectTakes('Test phrase');

      expect(groups[0].takes[0].selected).toBe(false);
      expect(groups[0].takes[1].selected).toBe(true); // Best take
      expect(groups[0].takes[2].selected).toBe(false);
    });

    it('selects all takes with all_takes strategy', async () => {
      const mockAnalysis = {
        takes: [
          {
            start: 0,
            end: 5,
            text: 'Test phrase',
            isBest: false,
            score: 0.7,
          },
          {
            start: 10,
            end: 15,
            text: 'Test phrase',
            isBest: true,
            score: 0.95,
          },
        ],
      };

      vi.mocked(aiServices.analyzeTakes).mockResolvedValue(mockAnalysis);
      detector.setSelectionStrategy('all_takes');

      const groups = await detector.detectTakes('Test phrase');

      expect(groups[0].takes[0].selected).toBe(true);
      expect(groups[0].takes[1].selected).toBe(true);
    });

    it('selects no takes with manual strategy', async () => {
      const mockAnalysis = {
        takes: [
          {
            start: 0,
            end: 5,
            text: 'Test phrase',
            isBest: false,
            score: 0.7,
          },
          {
            start: 10,
            end: 15,
            text: 'Test phrase',
            isBest: true,
            score: 0.95,
          },
        ],
      };

      vi.mocked(aiServices.analyzeTakes).mockResolvedValue(mockAnalysis);
      detector.setSelectionStrategy('manual');

      const groups = await detector.detectTakes('Test phrase');

      expect(groups[0].takes[0].selected).toBe(false);
      expect(groups[0].takes[1].selected).toBe(false);
    });

    it('handles empty transcript', async () => {
      vi.mocked(aiServices.analyzeTakes).mockResolvedValue({ takes: [] });

      const groups = await detector.detectTakes('');

      expect(groups.length).toBe(0);
    });
  });

  describe('generatePreview', () => {
    it('generates accurate preview data', () => {
      const mockGroups: TakeGroup[] = [
        {
          id: 'group1',
          phrase: 'Test phrase',
          bestTakeIndex: 1,
          takes: [
            {
              groupId: 'group1',
              phrase: 'Test phrase',
              takeNumber: 1,
              start: 0,
              end: 5,
              text: 'Test phrase',
              isBest: false,
              score: 0.8,
              colorIndex: 1,
              clipName: 'Take 1',
              confidence: {
                boundaryAccuracy: 0.9,
                textMatch: 0.95,
                audioQuality: 0.8,
                overall: 0.88,
              },
              selected: false,
            },
            {
              groupId: 'group1',
              phrase: 'Test phrase',
              takeNumber: 2,
              start: 10,
              end: 15,
              text: 'Test phrase',
              isBest: true,
              score: 0.95,
              colorIndex: 3,
              clipName: 'Take 2',
              confidence: {
                boundaryAccuracy: 0.95,
                textMatch: 0.95,
                audioQuality: 0.95,
                overall: 0.95,
              },
              selected: true,
            },
          ],
        },
      ];

      const preview = detector.generatePreview(mockGroups);

      expect(preview.totalDuration).toBe(10); // 5s + 5s
      expect(preview.keepDuration).toBe(5); // Only take 2 selected
      expect(preview.removeDuration).toBe(5); // Take 1 not selected
      expect(preview.takeGroups.length).toBe(1);
      expect(preview.takeGroups[0].selectedTakes).toEqual([1]);
      expect(preview.takeGroups[0].removedTakes).toEqual([0]);
    });

    it('handles all takes selected', () => {
      const mockGroups: TakeGroup[] = [
        {
          id: 'group1',
          phrase: 'Test',
          bestTakeIndex: 0,
          takes: [
            {
              groupId: 'group1',
              phrase: 'Test',
              takeNumber: 1,
              start: 0,
              end: 10,
              text: 'Test',
              isBest: true,
              score: 0.9,
              colorIndex: 1,
              clipName: 'Take 1',
              confidence: {
                boundaryAccuracy: 0.9,
                textMatch: 0.9,
                audioQuality: 0.9,
                overall: 0.9,
              },
              selected: true,
            },
            {
              groupId: 'group1',
              phrase: 'Test',
              takeNumber: 2,
              start: 15,
              end: 25,
              text: 'Test',
              isBest: false,
              score: 0.85,
              colorIndex: 3,
              clipName: 'Take 2',
              confidence: {
                boundaryAccuracy: 0.85,
                textMatch: 0.9,
                audioQuality: 0.85,
                overall: 0.87,
              },
              selected: true,
            },
          ],
        },
      ];

      const preview = detector.generatePreview(mockGroups);

      expect(preview.totalDuration).toBe(20);
      expect(preview.keepDuration).toBe(20);
      expect(preview.removeDuration).toBe(0);
    });
  });

  describe('manual selection', () => {
    it('toggles take selection in manual mode', () => {
      detector.setSelectionStrategy('manual');

      const mockGroups: TakeGroup[] = [
        {
          id: 'group1',
          phrase: 'Test',
          bestTakeIndex: 0,
          takes: [
            {
              groupId: 'group1',
              phrase: 'Test',
              takeNumber: 1,
              start: 0,
              end: 5,
              text: 'Test',
              isBest: true,
              score: 0.9,
              colorIndex: 1,
              clipName: 'Take 1',
              confidence: {
                boundaryAccuracy: 0.9,
                textMatch: 0.9,
                audioQuality: 0.9,
                overall: 0.9,
              },
              selected: false,
            },
          ],
        },
      ];

      const updated = detector.toggleTakeSelection(mockGroups, 0, 0);

      expect(updated[0].takes[0].selected).toBe(true);

      const toggledAgain = detector.toggleTakeSelection(updated, 0, 0);
      expect(toggledAgain[0].takes[0].selected).toBe(false);
    });

    it('prevents toggle when not in manual mode', () => {
      detector.setSelectionStrategy('best_only');

      const mockGroups: TakeGroup[] = [
        {
          id: 'group1',
          phrase: 'Test',
          bestTakeIndex: 0,
          takes: [
            {
              groupId: 'group1',
              phrase: 'Test',
              takeNumber: 1,
              start: 0,
              end: 5,
              text: 'Test',
              isBest: true,
              score: 0.9,
              colorIndex: 1,
              clipName: 'Take 1',
              confidence: {
                boundaryAccuracy: 0.9,
                textMatch: 0.9,
                audioQuality: 0.9,
                overall: 0.9,
              },
              selected: true,
            },
          ],
        },
      ];

      const result = detector.toggleTakeSelection(mockGroups, 0, 0);

      // Should return original groups unchanged
      expect(result[0].takes[0].selected).toBe(true);
    });

    it('selects a specific take', () => {
      const mockGroups: TakeGroup[] = [
        {
          id: 'group1',
          phrase: 'Test',
          bestTakeIndex: 0,
          takes: [
            {
              groupId: 'group1',
              phrase: 'Test',
              takeNumber: 1,
              start: 0,
              end: 5,
              text: 'Test',
              isBest: true,
              score: 0.9,
              colorIndex: 1,
              clipName: 'Take 1',
              confidence: {
                boundaryAccuracy: 0.9,
                textMatch: 0.9,
                audioQuality: 0.9,
                overall: 0.9,
              },
              selected: false,
            },
          ],
        },
      ];

      const updated = detector.selectTake(mockGroups, 0, 0);

      expect(updated[0].takes[0].selected).toBe(true);
    });

    it('deselects a specific take', () => {
      const mockGroups: TakeGroup[] = [
        {
          id: 'group1',
          phrase: 'Test',
          bestTakeIndex: 0,
          takes: [
            {
              groupId: 'group1',
              phrase: 'Test',
              takeNumber: 1,
              start: 0,
              end: 5,
              text: 'Test',
              isBest: true,
              score: 0.9,
              colorIndex: 1,
              clipName: 'Take 1',
              confidence: {
                boundaryAccuracy: 0.9,
                textMatch: 0.9,
                audioQuality: 0.9,
                overall: 0.9,
              },
              selected: true,
            },
          ],
        },
      ];

      const updated = detector.deselectTake(mockGroups, 0, 0);

      expect(updated[0].takes[0].selected).toBe(false);
    });
  });

  describe('color assignment', () => {
    it('assigns colors from rotation', () => {
      const colorCSS = detector.getColorCSS(1);
      expect(colorCSS).toBe('#8dc63f'); // Green

      const colorName = detector.getColorName(1);
      expect(colorName).toBe('Green');
    });

    it('handles unknown color indices', () => {
      const colorCSS = detector.getColorCSS(999);
      expect(colorCSS).toBe('#888888'); // Default gray

      const colorName = detector.getColorName(999);
      expect(colorName).toBe('Color 999');
    });
  });
});
