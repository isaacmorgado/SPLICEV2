import { describe, it, expect, beforeEach } from 'vitest';
import { AIServices } from '../../src/api/ai-services';

describe('AIServices', () => {
  let services: AIServices;

  beforeEach(() => {
    // AIServices now uses default backendClient
    services = new AIServices();
  });

  describe('colorMatch', () => {
    it('returns color match result with mock data', async () => {
      // colorMatch no longer takes an apiKey parameter
      const result = await services.colorMatch();

      expect(result.success).toBe(true);
      expect(result.adjustments).toBeDefined();
      expect(Array.isArray(result.adjustments)).toBe(true);
      expect(result.processingTime).toBeGreaterThan(0);
    });

    it('adjustments contain expected properties', async () => {
      const result = await services.colorMatch();
      const adjustment = result.adjustments[0];

      expect(adjustment).toHaveProperty('clipId');
      expect(adjustment).toHaveProperty('temperature');
      expect(adjustment).toHaveProperty('tint');
      expect(adjustment).toHaveProperty('exposure');
      expect(adjustment).toHaveProperty('contrast');
      expect(adjustment).toHaveProperty('saturation');
    });
  });

  describe('suggestEdits', () => {
    it('returns array of suggestions', async () => {
      // suggestEdits now takes timelineData as single parameter
      const result = await services.suggestEdits({});

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(typeof result[0]).toBe('string');
    });
  });

  describe('mode detection', () => {
    it('defaults to proxy mode', () => {
      expect(services.getMode()).toBe('proxy');
    });
  });
});
