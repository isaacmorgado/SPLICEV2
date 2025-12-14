import { describe, it, expect, beforeEach } from 'vitest';
import { PremiereAPI } from '../../src/api/premiere';

describe('PremiereAPI', () => {
  let api: PremiereAPI;

  beforeEach(() => {
    api = new PremiereAPI();
  });

  describe('isAvailable', () => {
    it('returns false in test environment', () => {
      expect(api.isAvailable()).toBe(false);
    });
  });

  describe('analyzeTimeline', () => {
    it('returns mock data when Premiere is not available', async () => {
      const result = await api.analyzeTimeline();

      expect(result).toHaveProperty('clipCount');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('tracks');
      expect(typeof result.clipCount).toBe('number');
    });
  });

  describe('autoCutSilence', () => {
    it('returns mock data when Premiere is not available', async () => {
      const result = await api.autoCutSilence();

      expect(result).toHaveProperty('cutsApplied');
      expect(result).toHaveProperty('silentSections');
      expect(result).toHaveProperty('timeRemoved');
    });
  });

  describe('getProjectInfo', () => {
    it('returns mock project info', async () => {
      const result = await api.getProjectInfo();

      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('path');
      expect(result.name).toBe('Mock Project');
    });
  });
});
