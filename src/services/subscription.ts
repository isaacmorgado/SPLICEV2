import { BackendClient, backendClient } from '../api/backend-client';
import { secureStorage } from '../lib/secure-storage';
import { storage } from '../lib/storage';
import { logger } from '../lib/logger';

// Tier limits configuration
const TIER_LIMITS: Record<TierId, TierLimits> = {
  free: {
    monthlyMinutes: 10,
    features: ['voice_isolation', 'transcription'],
  },
  pro: {
    monthlyMinutes: 120,
    features: ['voice_isolation', 'transcription', 'take_analysis'],
  },
  studio: {
    monthlyMinutes: 500,
    features: ['voice_isolation', 'transcription', 'take_analysis'],
  },
};

const SUBSCRIPTION_CACHE_KEY = 'subscription_status';
const SUBSCRIPTION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CachedSubscription {
  status: SubscriptionStatus;
  cachedAt: number;
}

/**
 * Subscription service for managing subscription state and tier-based access
 */
export class SubscriptionService {
  private client: BackendClient;
  private cachedStatus: SubscriptionStatus | null = null;
  private lastFetch: number = 0;

  constructor(client: BackendClient = backendClient) {
    this.client = client;
    this.loadCachedStatus();
  }

  // ============================================
  // Status Methods
  // ============================================

  async getStatus(): Promise<SubscriptionStatus> {
    // Return cached if valid
    if (this.isCacheValid()) {
      return this.cachedStatus!;
    }

    // Fetch fresh status
    await this.refreshStatus();
    return this.cachedStatus!;
  }

  async refreshStatus(): Promise<void> {
    try {
      const isAuth = await this.client.isAuthenticated();
      if (!isAuth) {
        // Not authenticated - return free tier defaults
        this.cachedStatus = this.getDefaultStatus();
        return;
      }

      const status = await this.client.getSubscriptionStatus();
      this.cachedStatus = status;
      this.lastFetch = Date.now();

      // Persist to storage for offline access
      await this.saveCachedStatus();
      logger.debug('Subscription status refreshed');
    } catch (error) {
      logger.error('Failed to refresh subscription status', error);
      // Fall back to cached or default
      if (!this.cachedStatus) {
        this.cachedStatus = this.getDefaultStatus();
      }
    }
  }

  private getDefaultStatus(): SubscriptionStatus {
    return {
      tier: 'free',
      status: 'active',
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      minutesUsed: 0,
      minutesLimit: TIER_LIMITS.free.monthlyMinutes,
    };
  }

  // ============================================
  // Feature Access Methods
  // ============================================

  async canUseFeature(feature: FeatureType): Promise<boolean> {
    // BYOK users bypass all limits
    if (await this.isByokEnabled()) {
      return true;
    }

    const status = await this.getStatus();
    const limits = TIER_LIMITS[status.tier];

    // Check if feature is available for this tier
    if (!limits.features.includes(feature)) {
      return false;
    }

    // Check if user has remaining minutes
    if (status.minutesUsed >= status.minutesLimit) {
      return false;
    }

    return true;
  }

  async getRemainingMinutes(): Promise<number> {
    // BYOK users have unlimited
    if (await this.isByokEnabled()) {
      return Infinity;
    }

    const status = await this.getStatus();
    return Math.max(0, status.minutesLimit - status.minutesUsed);
  }

  getTierLimits(tier?: TierId): TierLimits {
    const tierToUse = tier || this.cachedStatus?.tier || 'free';
    return TIER_LIMITS[tierToUse];
  }

  async getCurrentTier(): Promise<TierId> {
    const status = await this.getStatus();
    return status.tier;
  }

  async isSubscriptionActive(): Promise<boolean> {
    const status = await this.getStatus();
    return status.status === 'active';
  }

  async isAtLimit(): Promise<boolean> {
    if (await this.isByokEnabled()) {
      return false;
    }
    const remaining = await this.getRemainingMinutes();
    return remaining <= 0;
  }

  async isNearLimit(thresholdPercent: number = 80): Promise<boolean> {
    if (await this.isByokEnabled()) {
      return false;
    }
    const status = await this.getStatus();
    const usedPercent = (status.minutesUsed / status.minutesLimit) * 100;
    return usedPercent >= thresholdPercent;
  }

  // ============================================
  // BYOK Handling
  // ============================================

  async hasByokKey(service: ApiKeyService): Promise<boolean> {
    return secureStorage.hasApiKey(service);
  }

  async isByokEnabled(): Promise<boolean> {
    // User has BYOK if they have keys for ALL required services
    const hasElevenLabs = await secureStorage.hasApiKey('elevenlabs');
    const hasLLM =
      (await secureStorage.hasApiKey('openai')) || (await secureStorage.hasApiKey('gemini'));

    return hasElevenLabs && hasLLM;
  }

  async getByokStatus(): Promise<{
    elevenlabs: boolean;
    openai: boolean;
    gemini: boolean;
    isFullByok: boolean;
  }> {
    const elevenlabs = await secureStorage.hasApiKey('elevenlabs');
    const openai = await secureStorage.hasApiKey('openai');
    const gemini = await secureStorage.hasApiKey('gemini');

    return {
      elevenlabs,
      openai,
      gemini,
      isFullByok: elevenlabs && (openai || gemini),
    };
  }

  // ============================================
  // Subscription Management
  // ============================================

  async getTiers(): Promise<Tier[]> {
    return this.client.getTiers();
  }

  async upgradeTo(tier: TierId): Promise<string | null> {
    try {
      const { url } = await this.client.createCheckoutSession(tier);
      return url;
    } catch (error) {
      logger.error('Failed to create checkout session', error);
      return null;
    }
  }

  async openBillingPortal(): Promise<string | null> {
    try {
      const { url } = await this.client.createPortalSession();
      return url;
    } catch (error) {
      logger.error('Failed to create portal session', error);
      return null;
    }
  }

  // ============================================
  // Usage Tracking Integration
  // ============================================

  async addUsage(minutes: number): Promise<void> {
    if (this.cachedStatus) {
      this.cachedStatus.minutesUsed += minutes;
      await this.saveCachedStatus();
    }
  }

  // ============================================
  // Cache Management
  // ============================================

  private isCacheValid(): boolean {
    if (!this.cachedStatus) return false;
    return Date.now() - this.lastFetch < SUBSCRIPTION_CACHE_TTL;
  }

  private async loadCachedStatus(): Promise<void> {
    try {
      const cached = await storage.get<CachedSubscription>(SUBSCRIPTION_CACHE_KEY);
      if (cached) {
        this.cachedStatus = {
          ...cached.status,
          periodEnd: new Date(cached.status.periodEnd),
        };
        this.lastFetch = cached.cachedAt;
      }
    } catch (error) {
      logger.error('Failed to load cached subscription status', error);
    }
  }

  private async saveCachedStatus(): Promise<void> {
    if (!this.cachedStatus) return;
    try {
      await storage.set<CachedSubscription>(SUBSCRIPTION_CACHE_KEY, {
        status: this.cachedStatus,
        cachedAt: this.lastFetch,
      });
    } catch (error) {
      logger.error('Failed to save cached subscription status', error);
    }
  }

  clearCache(): void {
    this.cachedStatus = null;
    this.lastFetch = 0;
  }
}

// Singleton instance
export const subscriptionService = new SubscriptionService();
