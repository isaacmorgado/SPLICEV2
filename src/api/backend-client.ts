import { secureStorage } from '../lib/secure-storage';
import { logger } from '../lib/logger';
import { serviceStatus } from '../services/service-status';

// Backend URL configuration
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000/api';

/**
 * HTTP client for all Vercel backend communication
 * Handles authentication, token refresh, and API requests
 */
export class BackendClient {
  private baseUrl: string;
  private isRefreshing: boolean = false;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(baseUrl: string = BACKEND_URL) {
    this.baseUrl = baseUrl;
  }

  // ============================================
  // Core HTTP Methods
  // ============================================

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    requiresAuth: boolean = true
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add auth token if required
    if (requiresAuth) {
      // Check if token needs refresh
      if (await secureStorage.needsTokenRefresh()) {
        await this.refreshToken();
      }

      const token = await secureStorage.getAuthToken();
      if (token) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
      }
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      // Handle 401 - try to refresh token once
      if (response.status === 401 && requiresAuth) {
        const newToken = await this.refreshToken();
        if (newToken) {
          // Retry the request with new token
          (headers as Record<string, string>)['Authorization'] = `Bearer ${newToken}`;
          const retryResponse = await fetch(url, { ...options, headers });
          if (!retryResponse.ok) {
            throw await this.handleError(retryResponse);
          }
          return retryResponse.json();
        } else {
          // Refresh failed - user needs to re-login
          await this.logout();
          throw new Error('Session expired. Please log in again.');
        }
      }

      if (!response.ok) {
        throw await this.handleError(response);
      }

      return response.json();
    } catch (error) {
      logger.error(`Request failed: ${endpoint}`, error);
      throw error;
    }
  }

  private async handleError(response: Response): Promise<Error> {
    let message = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const data = await response.json();
      if (data.error) {
        message = data.error;
      }
    } catch {
      // Response is not JSON
    }
    return new Error(message);
  }

  // ============================================
  // Authentication Endpoints
  // ============================================

  async register(email: string, password: string): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>(
      '/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      },
      false
    );

    if (response.success && response.token) {
      await this.storeTokens(response);
    }

    return response;
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      },
      false
    );

    if (response.success && response.token) {
      await this.storeTokens(response);
    }

    return response;
  }

  async verify(): Promise<boolean> {
    try {
      const response = await this.request<{ valid: boolean }>('/auth/verify', {
        method: 'GET',
      });
      return response.valid;
    } catch {
      return false;
    }
  }

  async refreshToken(): Promise<string | null> {
    // Prevent multiple simultaneous refresh requests
    if (this.isRefreshing) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = this.doRefreshToken();

    try {
      return await this.refreshPromise;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  private async doRefreshToken(): Promise<string | null> {
    const refreshToken = await secureStorage.getRefreshToken();
    if (!refreshToken) {
      logger.warn('No refresh token available');
      return null;
    }

    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        logger.warn('Token refresh failed');
        return null;
      }

      const data: AuthResponse = await response.json();
      if (data.success && data.token) {
        await this.storeTokens(data);
        logger.debug('Token refreshed successfully');
        return data.token;
      }

      return null;
    } catch (error) {
      logger.error('Token refresh error', error);
      return null;
    }
  }

  async logout(): Promise<void> {
    await secureStorage.clearAuthToken();
    await secureStorage.clearRefreshToken();
    logger.info('User logged out');
  }

  private async storeTokens(response: AuthResponse): Promise<void> {
    if (response.token) {
      const expiresAt = response.expiresAt
        ? new Date(response.expiresAt)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default 7 days
      await secureStorage.setAuthToken(response.token, expiresAt);
    }
    if (response.refreshToken) {
      await secureStorage.setRefreshToken(response.refreshToken);
    }
  }

  // ============================================
  // Subscription Endpoints
  // ============================================

  async getSubscriptionStatus(): Promise<SubscriptionStatus> {
    const response = await this.request<{
      tier: TierId;
      status: string;
      period_end: string;
      minutes_used: number;
      minutes_limit: number;
    }>('/subscription/status');

    return {
      tier: response.tier,
      status: response.status as 'active' | 'canceled' | 'expired',
      periodEnd: new Date(response.period_end),
      minutesUsed: response.minutes_used,
      minutesLimit: response.minutes_limit,
    };
  }

  async getTiers(): Promise<Tier[]> {
    return this.request<Tier[]>('/subscription/tiers', {}, false);
  }

  async createCheckoutSession(tierId: TierId): Promise<{ url: string }> {
    return this.request<{ url: string }>('/stripe/create-checkout', {
      method: 'POST',
      body: JSON.stringify({ tierId }),
    });
  }

  async createPortalSession(): Promise<{ url: string }> {
    return this.request<{ url: string }>('/stripe/create-portal', {
      method: 'POST',
    });
  }

  // ============================================
  // AI Proxy Endpoints (for non-BYOK users)
  // ============================================

  async isolateVoice(audioBuffer: ArrayBuffer): Promise<IsolatedAudio> {
    const formData = new FormData();
    formData.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');

    const token = await secureStorage.getAuthToken();
    const response = await fetch(`${this.baseUrl}/ai/isolate-audio`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    const data = await response.json();
    return {
      vocals: this.base64ToArrayBuffer(data.vocals),
      background: this.base64ToArrayBuffer(data.background),
    };
  }

  async transcribe(audioBuffer: ArrayBuffer): Promise<TranscriptionResult> {
    const formData = new FormData();
    formData.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');

    const token = await secureStorage.getAuthToken();
    const response = await fetch(`${this.baseUrl}/ai/transcribe`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    return response.json();
  }

  async analyzeTakes(transcript: string): Promise<TakeAnalysis> {
    return this.request<TakeAnalysis>('/ai/analyze-takes', {
      method: 'POST',
      body: JSON.stringify({ transcript }),
    });
  }

  // ============================================
  // Usage Endpoints
  // ============================================

  async recordUsage(featureType: FeatureType, minutes: number): Promise<void> {
    await this.request<{ success: boolean }>('/subscription/usage', {
      method: 'POST',
      body: JSON.stringify({ featureType, minutes }),
    });
  }

  async getUsage(): Promise<UsageRecord[]> {
    const response = await this.request<{
      records: Array<{
        id: string;
        user_id: string;
        feature_type: string;
        minutes_used: number;
        created_at: string;
      }>;
    }>('/subscription/usage');

    return response.records.map((r) => ({
      id: r.id,
      userId: r.user_id,
      featureType: r.feature_type as FeatureType,
      minutes: r.minutes_used,
      createdAt: new Date(r.created_at),
    }));
  }

  // ============================================
  // Utility Methods
  // ============================================

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async isAuthenticated(): Promise<boolean> {
    return secureStorage.isAuthenticated();
  }

  // ============================================
  // Health Check
  // ============================================

  /**
   * Check backend health and update service status.
   * Returns true if backend is available.
   */
  async checkHealth(): Promise<boolean> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const responseTime = Date.now() - start;

      if (response.ok) {
        const data = await response.json();

        // Update service status based on health response
        if (data.status === 'healthy') {
          serviceStatus.markAvailable('backend', responseTime);
        } else if (data.status === 'degraded') {
          serviceStatus.markDegraded('backend', 'Some services experiencing issues');
        } else {
          serviceStatus.markUnavailable('backend', data.status);
        }

        logger.info(`Backend health check: ${data.status} (${responseTime}ms)`);
        return data.status !== 'unhealthy';
      } else {
        serviceStatus.markUnavailable('backend', `HTTP ${response.status}`);
        logger.warn(`Backend health check failed: HTTP ${response.status}`);
        return false;
      }
    } catch (error) {
      serviceStatus.markUnavailable(
        'backend',
        error instanceof Error ? error.message : 'Unknown error'
      );
      logger.error('Backend health check failed', error);
      return false;
    }
  }

  /**
   * Get subscription status with caching for offline mode.
   * Falls back to cached data if backend is unavailable.
   */
  async getSubscriptionStatusWithFallback(): Promise<SubscriptionStatus | null> {
    try {
      const status = await this.getSubscriptionStatus();

      // Cache the subscription status
      serviceStatus.cacheSubscription(status.tier, status.minutesUsed, status.minutesLimit);
      serviceStatus.markAvailable('backend');

      return status;
    } catch (error) {
      logger.warn('Failed to get subscription status, checking cache', error);
      serviceStatus.markDegraded('backend', 'Failed to fetch subscription');

      // Try to return cached data
      const cached = serviceStatus.getCachedSubscription();
      if (cached) {
        logger.info('Using cached subscription status');
        return {
          tier: cached.tier as TierId,
          status: 'active', // Assume active for cached data
          periodEnd: new Date(), // Unknown
          minutesUsed: cached.minutesUsed,
          minutesLimit: cached.minutesLimit,
        };
      }

      return null;
    }
  }
}

// Default singleton instance
export const backendClient = new BackendClient();
