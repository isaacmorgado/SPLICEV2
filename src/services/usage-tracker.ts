import { BackendClient, backendClient } from '../api/backend-client';
import { SubscriptionService, subscriptionService } from './subscription';
import { storage } from '../lib/storage';
import { logger } from '../lib/logger';

const PENDING_USAGE_KEY = 'pending_usage';
const USAGE_HISTORY_KEY = 'usage_history';

interface PendingUsage {
  featureType: FeatureType;
  minutes: number;
  timestamp: number;
}

/**
 * Usage tracker for monitoring and recording AI minutes used
 */
export class UsageTracker {
  private client: BackendClient;
  private subscription: SubscriptionService;
  private pendingUsage: PendingUsage[] = [];
  private syncInProgress: boolean = false;

  constructor(
    client: BackendClient = backendClient,
    subscription: SubscriptionService = subscriptionService
  ) {
    this.client = client;
    this.subscription = subscription;
    this.loadPendingUsage();
  }

  // ============================================
  // Track Usage
  // ============================================

  async trackUsage(feature: FeatureType, minutes: number): Promise<void> {
    // BYOK users don't track usage
    if (!(await this.shouldTrack())) {
      logger.debug(`Skipping usage tracking for BYOK user: ${feature} (${minutes} min)`);
      return;
    }

    // Update local subscription cache immediately (optimistic)
    await this.subscription.addUsage(minutes);

    // Queue for backend sync
    this.pendingUsage.push({
      featureType: feature,
      minutes,
      timestamp: Date.now(),
    });
    await this.savePendingUsage();

    logger.info(`Usage tracked: ${feature} - ${minutes} minutes`);

    // Try to sync immediately
    await this.syncUsage();
  }

  async canUse(feature: FeatureType, estimatedMinutes: number): Promise<boolean> {
    // BYOK users always can use
    if (!(await this.shouldTrack())) {
      return true;
    }

    // Check feature availability
    const canUseFeature = await this.subscription.canUseFeature(feature);
    if (!canUseFeature) {
      return false;
    }

    // Check if estimated usage would exceed limit
    const remaining = await this.subscription.getRemainingMinutes();
    return remaining >= estimatedMinutes;
  }

  async getUsageStats(): Promise<UsageStats> {
    // Get from backend if authenticated
    const isAuth = await this.client.isAuthenticated();
    if (isAuth) {
      try {
        const records = await this.client.getUsage();
        return this.calculateStats(records);
      } catch (error) {
        logger.error('Failed to fetch usage stats from backend', error);
      }
    }

    // Fall back to local data
    return this.getLocalUsageStats();
  }

  // ============================================
  // BYOK Bypass
  // ============================================

  async shouldTrack(): Promise<boolean> {
    // Don't track if user has full BYOK setup
    return !(await this.subscription.isByokEnabled());
  }

  // ============================================
  // Usage Warnings
  // ============================================

  async getUsageWarning(): Promise<string | null> {
    if (!(await this.shouldTrack())) {
      return null;
    }

    const remaining = await this.subscription.getRemainingMinutes();
    const status = await this.subscription.getStatus();
    const usedPercent = (status.minutesUsed / status.minutesLimit) * 100;

    if (remaining <= 0) {
      return `You've used all ${status.minutesLimit} minutes this period. Upgrade or add your own API keys to continue.`;
    }

    if (usedPercent >= 90) {
      return `You've used ${Math.round(usedPercent)}% of your minutes. Only ${remaining.toFixed(1)} minutes remaining.`;
    }

    if (usedPercent >= 75) {
      return `Usage: ${status.minutesUsed.toFixed(1)}/${status.minutesLimit} minutes (${Math.round(usedPercent)}%)`;
    }

    return null;
  }

  async shouldShowUpgradePrompt(): Promise<boolean> {
    if (!(await this.shouldTrack())) {
      return false;
    }

    const status = await this.subscription.getStatus();

    // Only show for free tier users near limit
    if (status.tier !== 'free') {
      return false;
    }

    const usedPercent = (status.minutesUsed / status.minutesLimit) * 100;
    return usedPercent >= 80;
  }

  // ============================================
  // Sync with Backend
  // ============================================

  async syncUsage(): Promise<void> {
    if (this.syncInProgress || this.pendingUsage.length === 0) {
      return;
    }

    const isAuth = await this.client.isAuthenticated();
    if (!isAuth) {
      return;
    }

    this.syncInProgress = true;

    try {
      // Process pending usage in batches
      const toSync = [...this.pendingUsage];
      this.pendingUsage = [];

      for (const usage of toSync) {
        try {
          await this.client.recordUsage(usage.featureType, usage.minutes);
        } catch (error) {
          // Re-queue failed items
          this.pendingUsage.push(usage);
          logger.error('Failed to sync usage record', error);
        }
      }

      await this.savePendingUsage();
      logger.debug(`Synced ${toSync.length - this.pendingUsage.length} usage records`);
    } finally {
      this.syncInProgress = false;
    }
  }

  // ============================================
  // Local Storage
  // ============================================

  private async loadPendingUsage(): Promise<void> {
    try {
      const pending = await storage.get<PendingUsage[]>(PENDING_USAGE_KEY, []);
      this.pendingUsage = pending ?? [];
    } catch (error) {
      logger.error('Failed to load pending usage', error);
      this.pendingUsage = [];
    }
  }

  private async savePendingUsage(): Promise<void> {
    try {
      await storage.set(PENDING_USAGE_KEY, this.pendingUsage);
    } catch (error) {
      logger.error('Failed to save pending usage', error);
    }
  }

  private async getLocalUsageStats(): Promise<UsageStats> {
    try {
      const history = await storage.get<UsageRecord[]>(USAGE_HISTORY_KEY, []);
      return this.calculateStats(history ?? []);
    } catch {
      return this.emptyStats();
    }
  }

  private calculateStats(records: UsageRecord[]): UsageStats {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Filter to current period
    const periodRecords = records.filter(
      (r) => r.createdAt >= periodStart && r.createdAt <= periodEnd
    );

    const byFeature: Record<FeatureType, number> = {
      voice_isolation: 0,
      transcription: 0,
      take_analysis: 0,
    };

    let totalMinutes = 0;
    for (const record of periodRecords) {
      totalMinutes += record.minutes;
      if (record.featureType in byFeature) {
        byFeature[record.featureType] += record.minutes;
      }
    }

    return {
      totalMinutes,
      byFeature,
      periodStart,
      periodEnd,
    };
  }

  private emptyStats(): UsageStats {
    const now = new Date();
    return {
      totalMinutes: 0,
      byFeature: {
        voice_isolation: 0,
        transcription: 0,
        take_analysis: 0,
      },
      periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
      periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
    };
  }

  // ============================================
  // Estimation Helpers
  // ============================================

  estimateMinutes(durationSeconds: number, feature: FeatureType): number {
    // Convert seconds to minutes, rounding up
    const minutes = Math.ceil(durationSeconds / 60);

    // Apply feature-specific multipliers if needed
    switch (feature) {
      case 'voice_isolation':
        // Voice isolation takes roughly 1:1 time
        return minutes;
      case 'transcription':
        // Transcription is fast, count as 1:1
        return minutes;
      case 'take_analysis':
        // Take analysis uses LLM, minimal time
        return Math.max(1, Math.ceil(minutes * 0.1));
      default:
        return minutes;
    }
  }

  getPendingCount(): number {
    return this.pendingUsage.length;
  }
}

// Singleton instance
export const usageTracker = new UsageTracker();
