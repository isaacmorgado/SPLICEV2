import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExportPresetsService } from '../../src/services/export-presets';
import { storage } from '../../src/lib/storage';

// Mock storage
vi.mock('../../src/lib/storage', () => ({
  storage: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

describe('ExportPresetsService', () => {
  let service: ExportPresetsService;

  beforeEach(() => {
    service = new ExportPresetsService();
    vi.clearAllMocks();
  });

  describe('loadPresets', () => {
    it('loads default and user presets', async () => {
      vi.mocked(storage.get).mockResolvedValue([
        {
          id: 'user-1',
          name: 'My Custom Preset',
          threshold: -45,
          minSilenceDuration: 0.7,
          padding: 0.2,
          useVoiceIsolation: true,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ]);

      const result = await service.loadPresets();

      expect(result.success).toBe(true);
      expect(result.presets.length).toBeGreaterThan(3); // At least 3 defaults + 1 user
      expect(result.presets.some((p) => p.id === 'default-aggressive')).toBe(true);
      expect(result.presets.some((p) => p.id === 'user-1')).toBe(true);
    });

    it('handles storage errors gracefully', async () => {
      vi.mocked(storage.get).mockRejectedValue(new Error('Storage error'));

      const result = await service.loadPresets();

      // Error is caught in loadUserPresets, so loadPresets still succeeds
      expect(result.success).toBe(true);
      expect(result.presets.length).toBe(3); // Returns defaults when user presets fail
    });
  });

  describe('savePreset', () => {
    it('saves a new preset', async () => {
      vi.mocked(storage.get).mockResolvedValue([]);
      vi.mocked(storage.set).mockResolvedValue(undefined);

      const result = await service.savePreset({
        name: 'Test Preset',
        description: 'Test description',
        threshold: -35,
        minSilenceDuration: 0.5,
        padding: 0.1,
        useVoiceIsolation: true,
      });

      expect(result.success).toBe(true);
      expect(result.preset).toBeDefined();
      expect(result.preset?.name).toBe('Test Preset');
      expect(result.preset?.id).toMatch(/^user-/);
      expect(storage.set).toHaveBeenCalled();
    });

    it('validates preset name', async () => {
      const result = await service.savePreset({
        name: '',
        threshold: -40,
        minSilenceDuration: 0.5,
        padding: 0.1,
        useVoiceIsolation: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('name is required');
    });

    it('validates threshold range', async () => {
      const result = await service.savePreset({
        name: 'Invalid Threshold',
        threshold: -70, // Too low
        minSilenceDuration: 0.5,
        padding: 0.1,
        useVoiceIsolation: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Threshold');
    });

    it('validates min silence duration', async () => {
      const result = await service.savePreset({
        name: 'Invalid Duration',
        threshold: -40,
        minSilenceDuration: 15, // Too high
        padding: 0.1,
        useVoiceIsolation: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Min silence duration');
    });

    it('validates padding', async () => {
      const result = await service.savePreset({
        name: 'Invalid Padding',
        threshold: -40,
        minSilenceDuration: 0.5,
        padding: 5, // Too high
        useVoiceIsolation: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Padding');
    });
  });

  describe('updatePreset', () => {
    it('updates an existing user preset', async () => {
      const existingPreset = {
        id: 'user-1',
        name: 'Original Name',
        threshold: -40,
        minSilenceDuration: 0.5,
        padding: 0.1,
        useVoiceIsolation: false,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      vi.mocked(storage.get).mockResolvedValue([existingPreset]);
      vi.mocked(storage.set).mockResolvedValue(undefined);

      const result = await service.updatePreset('user-1', {
        name: 'Updated Name',
        threshold: -35,
      });

      expect(result.success).toBe(true);
      expect(result.preset?.name).toBe('Updated Name');
      expect(result.preset?.threshold).toBe(-35);
      expect(storage.set).toHaveBeenCalled();
    });

    it('prevents updating default presets', async () => {
      const result = await service.updatePreset('default-aggressive', {
        name: 'Modified Default',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot update default presets');
    });

    it('handles non-existent preset', async () => {
      vi.mocked(storage.get).mockResolvedValue([]);

      const result = await service.updatePreset('user-999', {
        name: 'Updated',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('deletePreset', () => {
    it('deletes a user preset', async () => {
      const presets = [
        {
          id: 'user-1',
          name: 'Preset 1',
          threshold: -40,
          minSilenceDuration: 0.5,
          padding: 0.1,
          useVoiceIsolation: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'user-2',
          name: 'Preset 2',
          threshold: -45,
          minSilenceDuration: 0.5,
          padding: 0.1,
          useVoiceIsolation: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.mocked(storage.get).mockResolvedValue(presets);
      vi.mocked(storage.set).mockResolvedValue(undefined);

      const result = await service.deletePreset('user-1');

      expect(result.success).toBe(true);
      expect(storage.set).toHaveBeenCalledWith(
        'silence_detection_presets',
        expect.arrayContaining([expect.objectContaining({ id: 'user-2' })])
      );
    });

    it('prevents deleting default presets', async () => {
      const result = await service.deletePreset('default-balanced');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot delete default presets');
    });

    it('handles non-existent preset', async () => {
      vi.mocked(storage.get).mockResolvedValue([]);

      const result = await service.deletePreset('user-999');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('getPreset', () => {
    it('retrieves a preset by ID', async () => {
      const preset = await service.getPreset('default-aggressive');

      expect(preset).toBeDefined();
      expect(preset?.id).toBe('default-aggressive');
      expect(preset?.name).toBe('Aggressive');
    });

    it('returns null for non-existent preset', async () => {
      vi.mocked(storage.get).mockResolvedValue([]);

      const preset = await service.getPreset('non-existent');

      expect(preset).toBeNull();
    });
  });

  describe('getDefaultPresets', () => {
    it('returns all default presets', () => {
      const defaults = service.getDefaultPresets();

      expect(defaults.length).toBe(3);
      expect(defaults.every((p) => p.id.startsWith('default-'))).toBe(true);
    });
  });

  describe('importFromJSON', () => {
    it('imports presets from JSON', async () => {
      const json = JSON.stringify([
        {
          name: 'Imported Preset',
          threshold: -42,
          minSilenceDuration: 0.6,
          padding: 0.12,
          useVoiceIsolation: true,
        },
      ]);

      vi.mocked(storage.get).mockResolvedValue([]);
      vi.mocked(storage.set).mockResolvedValue(undefined);

      const result = await service.importFromJSON(json);

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);
    });

    it('handles invalid JSON', async () => {
      const result = await service.importFromJSON('not valid json');

      expect(result.success).toBe(false);
      expect(result.imported).toBe(0);
      expect(result.error).toBeDefined();
    });

    it('skips invalid presets', async () => {
      const json = JSON.stringify([
        {
          name: 'Valid Preset',
          threshold: -40,
          minSilenceDuration: 0.5,
          padding: 0.1,
          useVoiceIsolation: false,
        },
        {
          name: '', // Invalid: empty name
          threshold: -40,
          minSilenceDuration: 0.5,
          padding: 0.1,
          useVoiceIsolation: false,
        },
      ]);

      vi.mocked(storage.get).mockResolvedValue([]);
      vi.mocked(storage.set).mockResolvedValue(undefined);

      const result = await service.importFromJSON(json);

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1); // Only valid preset imported
    });
  });

  describe('exportToJSON', () => {
    it('exports user presets to JSON', async () => {
      const userPresets = [
        {
          id: 'user-1',
          name: 'User Preset',
          threshold: -40,
          minSilenceDuration: 0.5,
          padding: 0.1,
          useVoiceIsolation: false,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];

      vi.mocked(storage.get).mockResolvedValue(userPresets);

      const json = await service.exportToJSON();
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].name).toBe('User Preset');
    });
  });
});
