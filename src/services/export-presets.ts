import { storage } from '../lib/storage';
import { logger } from '../lib/logger';

const PRESETS_STORAGE_KEY = 'silence_detection_presets';

/**
 * Default presets shipped with the plugin
 */
const DEFAULT_PRESETS: SilenceDetectionPreset[] = [
  {
    id: 'default-aggressive',
    name: 'Aggressive',
    description: 'Remove most silences, good for interviews',
    threshold: -35,
    minSilenceDuration: 0.3,
    padding: 0.1,
    useVoiceIsolation: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'default-balanced',
    name: 'Balanced',
    description: 'Standard silence removal',
    threshold: -40,
    minSilenceDuration: 0.5,
    padding: 0.15,
    useVoiceIsolation: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 'default-conservative',
    name: 'Conservative',
    description: 'Keep natural pauses, minimal cutting',
    threshold: -50,
    minSilenceDuration: 1.0,
    padding: 0.25,
    useVoiceIsolation: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
];

/**
 * Service for managing silence detection presets.
 * Stores user presets and provides access to default presets.
 */
export class ExportPresetsService {
  /**
   * Load all presets (default + user-created)
   */
  async loadPresets(): Promise<LoadPresetsResult> {
    try {
      const userPresets = await this.loadUserPresets();
      const allPresets = [...DEFAULT_PRESETS, ...userPresets];

      logger.info(
        `Loaded ${allPresets.length} presets (${DEFAULT_PRESETS.length} default, ${userPresets.length} user)`
      );

      return {
        success: true,
        presets: allPresets,
      };
    } catch (error) {
      logger.error('Failed to load presets', error);
      return {
        success: false,
        presets: DEFAULT_PRESETS,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Load only user-created presets from storage
   */
  private async loadUserPresets(): Promise<SilenceDetectionPreset[]> {
    try {
      const stored = await storage.get<SilenceDetectionPreset[]>(PRESETS_STORAGE_KEY);

      if (!stored || !Array.isArray(stored)) {
        return [];
      }

      // Convert date strings back to Date objects
      return stored.map((preset) => ({
        ...preset,
        createdAt: new Date(preset.createdAt),
        updatedAt: new Date(preset.updatedAt),
      }));
    } catch (error) {
      logger.error('Failed to load user presets', error);
      return [];
    }
  }

  /**
   * Save a new preset or update an existing one
   */
  async savePreset(
    preset: Omit<SilenceDetectionPreset, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<SavePresetResult> {
    try {
      // Validate preset
      const validationError = this.validatePreset(preset);
      if (validationError) {
        return {
          success: false,
          error: validationError,
        };
      }

      const userPresets = await this.loadUserPresets();

      // Generate ID and timestamps
      const now = new Date();
      const newPreset: SilenceDetectionPreset = {
        ...preset,
        id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        createdAt: now,
        updatedAt: now,
      };

      // Add to list
      userPresets.push(newPreset);

      // Save to storage
      await storage.set(PRESETS_STORAGE_KEY, userPresets);

      logger.info(`Saved preset: ${newPreset.name}`);

      return {
        success: true,
        preset: newPreset,
      };
    } catch (error) {
      logger.error('Failed to save preset', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update an existing user preset
   */
  async updatePreset(
    id: string,
    updates: Partial<Omit<SilenceDetectionPreset, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<SavePresetResult> {
    try {
      // Cannot update default presets
      if (id.startsWith('default-')) {
        return {
          success: false,
          error: 'Cannot update default presets',
        };
      }

      const userPresets = await this.loadUserPresets();
      const index = userPresets.findIndex((p) => p.id === id);

      if (index === -1) {
        return {
          success: false,
          error: 'Preset not found',
        };
      }

      // Update preset
      const updatedPreset: SilenceDetectionPreset = {
        ...userPresets[index],
        ...updates,
        updatedAt: new Date(),
      };

      // Validate
      const validationError = this.validatePreset(updatedPreset);
      if (validationError) {
        return {
          success: false,
          error: validationError,
        };
      }

      userPresets[index] = updatedPreset;

      // Save to storage
      await storage.set(PRESETS_STORAGE_KEY, userPresets);

      logger.info(`Updated preset: ${updatedPreset.name}`);

      return {
        success: true,
        preset: updatedPreset,
      };
    } catch (error) {
      logger.error('Failed to update preset', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Delete a user preset
   */
  async deletePreset(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Cannot delete default presets
      if (id.startsWith('default-')) {
        return {
          success: false,
          error: 'Cannot delete default presets',
        };
      }

      const userPresets = await this.loadUserPresets();
      const filtered = userPresets.filter((p) => p.id !== id);

      if (filtered.length === userPresets.length) {
        return {
          success: false,
          error: 'Preset not found',
        };
      }

      await storage.set(PRESETS_STORAGE_KEY, filtered);

      logger.info(`Deleted preset: ${id}`);

      return { success: true };
    } catch (error) {
      logger.error('Failed to delete preset', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get a specific preset by ID
   */
  async getPreset(id: string): Promise<SilenceDetectionPreset | null> {
    const { presets } = await this.loadPresets();
    return presets.find((p) => p.id === id) || null;
  }

  /**
   * Get default presets
   */
  getDefaultPresets(): SilenceDetectionPreset[] {
    return DEFAULT_PRESETS;
  }

  /**
   * Validate preset values
   */
  private validatePreset(preset: Partial<SilenceDetectionPreset>): string | null {
    if (!preset.name || preset.name.trim().length === 0) {
      return 'Preset name is required';
    }

    if (preset.name.trim().length > 50) {
      return 'Preset name must be 50 characters or less';
    }

    if (preset.threshold !== undefined && (preset.threshold < -60 || preset.threshold > -20)) {
      return 'Threshold must be between -60 and -20 dB';
    }

    if (
      preset.minSilenceDuration !== undefined &&
      (preset.minSilenceDuration < 0 || preset.minSilenceDuration > 10)
    ) {
      return 'Min silence duration must be between 0 and 10 seconds';
    }

    if (preset.padding !== undefined && (preset.padding < 0 || preset.padding > 2)) {
      return 'Padding must be between 0 and 2 seconds';
    }

    return null;
  }

  /**
   * Export presets to JSON string for backup
   */
  async exportToJSON(): Promise<string> {
    const userPresets = await this.loadUserPresets();
    return JSON.stringify(userPresets, null, 2);
  }

  /**
   * Import presets from JSON string
   */
  async importFromJSON(
    json: string
  ): Promise<{ success: boolean; imported: number; error?: string }> {
    try {
      const imported = JSON.parse(json);

      if (!Array.isArray(imported)) {
        return {
          success: false,
          imported: 0,
          error: 'Invalid JSON format',
        };
      }

      const userPresets = await this.loadUserPresets();
      let importedCount = 0;

      for (const preset of imported) {
        // Validate
        const validationError = this.validatePreset(preset);
        if (validationError) {
          logger.warn(`Skipping invalid preset: ${validationError}`);
          continue;
        }

        // Generate new ID and timestamps
        const newPreset: SilenceDetectionPreset = {
          ...preset,
          id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        userPresets.push(newPreset);
        importedCount++;
      }

      await storage.set(PRESETS_STORAGE_KEY, userPresets);

      logger.info(`Imported ${importedCount} presets`);

      return {
        success: true,
        imported: importedCount,
      };
    } catch (error) {
      logger.error('Failed to import presets', error);
      return {
        success: false,
        imported: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Singleton instance
export const exportPresetsService = new ExportPresetsService();
