import { logger } from './logger';

// UXP provides secure storage API
declare const require: (module: string) => any;

/**
 * Secure storage wrapper for UXP plugins
 * Uses localStorage in development, UXP secureStorage in production
 */
class Storage {
  private storage: any;
  private namespace: string = 'splice';

  constructor() {
    this.initializeStorage();
  }

  private initializeStorage(): void {
    try {
      // Try to use UXP's secure storage
      const uxp = require('uxp');
      this.storage = uxp.storage.secureStorage;
      logger.info('Using UXP secure storage');
    } catch {
      // Fall back to localStorage for development
      this.storage = null;
      logger.warn('Using localStorage fallback (development mode)');
    }
  }

  private getKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  async get<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    try {
      const fullKey = this.getKey(key);

      if (this.storage) {
        const value = await this.storage.getItem(fullKey);
        return value ? JSON.parse(value) : defaultValue;
      } else {
        const value = localStorage.getItem(fullKey);
        return value ? JSON.parse(value) : defaultValue;
      }
    } catch (error) {
      logger.error(`Failed to get storage key: ${key}`, error);
      return defaultValue;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      const fullKey = this.getKey(key);
      const serialized = JSON.stringify(value);

      if (this.storage) {
        await this.storage.setItem(fullKey, serialized);
      } else {
        localStorage.setItem(fullKey, serialized);
      }

      logger.debug(`Stored key: ${key}`);
    } catch (error) {
      logger.error(`Failed to set storage key: ${key}`, error);
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      const fullKey = this.getKey(key);

      if (this.storage) {
        await this.storage.removeItem(fullKey);
      } else {
        localStorage.removeItem(fullKey);
      }

      logger.debug(`Removed key: ${key}`);
    } catch (error) {
      logger.error(`Failed to remove storage key: ${key}`, error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      if (this.storage) {
        // UXP doesn't have clear(), so we'd need to track keys
        logger.warn('Clear not fully supported in UXP secure storage');
      } else {
        // Only clear our namespace
        const keys = Object.keys(localStorage).filter((k) => k.startsWith(this.namespace));
        keys.forEach((k) => localStorage.removeItem(k));
      }

      logger.info('Storage cleared');
    } catch (error) {
      logger.error('Failed to clear storage', error);
      throw error;
    }
  }
}

// Singleton instance
export const storage = new Storage();
