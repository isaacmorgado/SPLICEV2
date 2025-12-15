import { storage } from './storage';
import { logger } from './logger';

/**
 * Secure credential storage for auth tokens and API keys
 * Wraps the base storage singleton with domain-specific methods
 */
class SecureCredentialStorage {
  private readonly AUTH_TOKEN_KEY = 'auth_token';
  private readonly REFRESH_TOKEN_KEY = 'refresh_token';
  private readonly TOKEN_EXPIRY_KEY = 'token_expiry';
  private readonly API_KEYS_KEY = 'api_keys';
  private readonly PREFERRED_LLM_KEY = 'preferred_llm';

  // ============================================
  // Auth Token Methods
  // ============================================

  async getAuthToken(): Promise<string | null> {
    try {
      return (await storage.get<string>(this.AUTH_TOKEN_KEY, undefined)) ?? null;
    } catch (error) {
      logger.error('Failed to get auth token', error);
      return null;
    }
  }

  async setAuthToken(token: string, expiresAt: Date): Promise<void> {
    try {
      await storage.set(this.AUTH_TOKEN_KEY, token);
      await storage.set(this.TOKEN_EXPIRY_KEY, expiresAt.toISOString());
      logger.debug('Auth token stored');
    } catch (error) {
      logger.error('Failed to set auth token', error);
      throw error;
    }
  }

  async clearAuthToken(): Promise<void> {
    try {
      await storage.remove(this.AUTH_TOKEN_KEY);
      await storage.remove(this.TOKEN_EXPIRY_KEY);
      logger.debug('Auth token cleared');
    } catch (error) {
      logger.error('Failed to clear auth token', error);
      throw error;
    }
  }

  async getTokenExpiry(): Promise<Date | null> {
    try {
      const expiryStr = await storage.get<string>(this.TOKEN_EXPIRY_KEY);
      return expiryStr ? new Date(expiryStr) : null;
    } catch (error) {
      logger.error('Failed to get token expiry', error);
      return null;
    }
  }

  async isTokenExpiringSoon(thresholdMinutes: number = 5): Promise<boolean> {
    const expiry = await this.getTokenExpiry();
    if (!expiry) return true; // No expiry means we should refresh

    const thresholdMs = thresholdMinutes * 60 * 1000;
    const now = Date.now();
    return expiry.getTime() - now < thresholdMs;
  }

  // ============================================
  // Refresh Token Methods
  // ============================================

  async getRefreshToken(): Promise<string | null> {
    try {
      return (await storage.get<string>(this.REFRESH_TOKEN_KEY, undefined)) ?? null;
    } catch (error) {
      logger.error('Failed to get refresh token', error);
      return null;
    }
  }

  async setRefreshToken(token: string): Promise<void> {
    try {
      await storage.set(this.REFRESH_TOKEN_KEY, token);
      logger.debug('Refresh token stored');
    } catch (error) {
      logger.error('Failed to set refresh token', error);
      throw error;
    }
  }

  async clearRefreshToken(): Promise<void> {
    try {
      await storage.remove(this.REFRESH_TOKEN_KEY);
      logger.debug('Refresh token cleared');
    } catch (error) {
      logger.error('Failed to clear refresh token', error);
      throw error;
    }
  }

  // ============================================
  // BYOK API Keys
  // ============================================

  async getApiKey(service: ApiKeyService): Promise<string | null> {
    try {
      const keys = await storage.get<Partial<Record<ApiKeyService, string>>>(this.API_KEYS_KEY, {});
      return keys?.[service] ?? null;
    } catch (error) {
      logger.error(`Failed to get API key for ${service}`, error);
      return null;
    }
  }

  async setApiKey(service: ApiKeyService, key: string): Promise<void> {
    try {
      const keys = await storage.get<Partial<Record<ApiKeyService, string>>>(this.API_KEYS_KEY, {});
      await storage.set(this.API_KEYS_KEY, { ...keys, [service]: key });
      logger.debug(`API key stored for ${service}`);
    } catch (error) {
      logger.error(`Failed to set API key for ${service}`, error);
      throw error;
    }
  }

  async clearApiKey(service: ApiKeyService): Promise<void> {
    try {
      const keys = await storage.get<Partial<Record<ApiKeyService, string>>>(this.API_KEYS_KEY, {});
      if (keys) {
        delete keys[service];
        await storage.set(this.API_KEYS_KEY, keys);
      }
      logger.debug(`API key cleared for ${service}`);
    } catch (error) {
      logger.error(`Failed to clear API key for ${service}`, error);
      throw error;
    }
  }

  async getAllApiKeys(): Promise<Partial<Record<ApiKeyService, string>>> {
    try {
      return (
        (await storage.get<Partial<Record<ApiKeyService, string>>>(this.API_KEYS_KEY, {})) ?? {}
      );
    } catch (error) {
      logger.error('Failed to get all API keys', error);
      return {};
    }
  }

  async hasApiKey(service: ApiKeyService): Promise<boolean> {
    const key = await this.getApiKey(service);
    return key !== null && key.length > 0;
  }

  async hasAnyByokKey(): Promise<boolean> {
    const keys = await this.getAllApiKeys();
    return Object.values(keys).some((key) => key && key.length > 0);
  }

  // ============================================
  // User Preferences
  // ============================================

  async getPreferredLLM(): Promise<LLMProviderType> {
    try {
      return (await storage.get<LLMProviderType>(this.PREFERRED_LLM_KEY, 'openai')) ?? 'openai';
    } catch (error) {
      logger.error('Failed to get preferred LLM', error);
      return 'openai';
    }
  }

  async setPreferredLLM(provider: LLMProviderType): Promise<void> {
    try {
      await storage.set(this.PREFERRED_LLM_KEY, provider);
      logger.debug(`Preferred LLM set to ${provider}`);
    } catch (error) {
      logger.error('Failed to set preferred LLM', error);
      throw error;
    }
  }

  // ============================================
  // Clear All (Logout)
  // ============================================

  async clearAll(): Promise<void> {
    try {
      await this.clearAuthToken();
      await this.clearRefreshToken();
      await storage.remove(this.API_KEYS_KEY);
      await storage.remove(this.PREFERRED_LLM_KEY);
      logger.info('All credentials cleared');
    } catch (error) {
      logger.error('Failed to clear all credentials', error);
      throw error;
    }
  }

  // ============================================
  // Auth State Helpers
  // ============================================

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getAuthToken();
    if (!token) return false;

    const isExpiring = await this.isTokenExpiringSoon(0); // Check if already expired
    return !isExpiring;
  }

  async needsTokenRefresh(): Promise<boolean> {
    const token = await this.getAuthToken();
    if (!token) return false;

    const refreshToken = await this.getRefreshToken();
    if (!refreshToken) return false;

    return await this.isTokenExpiringSoon(5); // 5 minute threshold
  }
}

// Singleton instance
export const secureStorage = new SecureCredentialStorage();
