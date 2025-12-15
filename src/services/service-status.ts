/**
 * Service Status Tracker
 *
 * Tracks the availability of external services and provides
 * graceful degradation capabilities when services are unavailable.
 */

import { logger } from '../lib/logger';

export type ServiceAvailability = 'available' | 'degraded' | 'unavailable';

export interface ServiceHealth {
  status: ServiceAvailability;
  lastCheck: Date | null;
  lastError?: string;
  responseTimeMs?: number;
}

export interface ServiceStatuses {
  ame: ServiceHealth;
  backend: ServiceHealth;
  transcription: ServiceHealth;
}

/**
 * Default health state for a service.
 */
function createDefaultHealth(): ServiceHealth {
  return {
    status: 'unavailable',
    lastCheck: null,
  };
}

/**
 * Service Status Tracker
 * Monitors and tracks the availability of external services.
 */
class ServiceStatusTracker {
  private statuses: ServiceStatuses = {
    ame: createDefaultHealth(),
    backend: createDefaultHealth(),
    transcription: createDefaultHealth(),
  };

  /** Listeners for status changes */
  private listeners: Array<(statuses: ServiceStatuses) => void> = [];

  /** Cached subscription status for offline mode */
  private cachedSubscription: {
    tier: string;
    minutesUsed: number;
    minutesLimit: number;
    cachedAt: Date;
  } | null = null;

  /** How long to consider cached subscription valid (30 minutes) */
  private readonly SUBSCRIPTION_CACHE_TTL_MS = 30 * 60 * 1000;

  /**
   * Update the status of a service.
   */
  updateStatus(
    service: keyof ServiceStatuses,
    status: ServiceAvailability,
    responseTimeMs?: number,
    error?: string
  ): void {
    const previousStatus = this.statuses[service].status;

    this.statuses[service] = {
      status,
      lastCheck: new Date(),
      lastError: error,
      responseTimeMs,
    };

    // Log status changes
    if (previousStatus !== status) {
      logger.info(`Service ${service} status changed: ${previousStatus} -> ${status}`);
    }

    // Notify listeners
    this.notifyListeners();
  }

  /**
   * Mark a service as available after a successful operation.
   */
  markAvailable(service: keyof ServiceStatuses, responseTimeMs?: number): void {
    this.updateStatus(service, 'available', responseTimeMs);
  }

  /**
   * Mark a service as degraded (partially working).
   */
  markDegraded(service: keyof ServiceStatuses, reason?: string): void {
    this.updateStatus(service, 'degraded', undefined, reason);
  }

  /**
   * Mark a service as unavailable after a failed operation.
   */
  markUnavailable(service: keyof ServiceStatuses, error?: string): void {
    this.updateStatus(service, 'unavailable', undefined, error);
  }

  /**
   * Get the current status of all services.
   */
  getStatuses(): ServiceStatuses {
    return { ...this.statuses };
  }

  /**
   * Get the status of a specific service.
   */
  getStatus(service: keyof ServiceStatuses): ServiceHealth {
    return { ...this.statuses[service] };
  }

  /**
   * Check if a service is available.
   */
  isAvailable(service: keyof ServiceStatuses): boolean {
    return this.statuses[service].status === 'available';
  }

  /**
   * Check if a service is at least partially available.
   */
  isUsable(service: keyof ServiceStatuses): boolean {
    const status = this.statuses[service].status;
    return status === 'available' || status === 'degraded';
  }

  /**
   * Get overall system status.
   * Returns 'available' if all critical services are up,
   * 'degraded' if some services have issues,
   * 'unavailable' if critical services are down.
   */
  getOverallStatus(): ServiceAvailability {
    const { backend, transcription } = this.statuses;

    // Backend is critical
    if (backend.status === 'unavailable') {
      return 'unavailable';
    }

    // If any service is degraded or transcription unavailable
    if (
      backend.status === 'degraded' ||
      transcription.status === 'unavailable' ||
      transcription.status === 'degraded'
    ) {
      return 'degraded';
    }

    return 'available';
  }

  /**
   * Cache subscription status for offline mode.
   */
  cacheSubscription(tier: string, minutesUsed: number, minutesLimit: number): void {
    this.cachedSubscription = {
      tier,
      minutesUsed,
      minutesLimit,
      cachedAt: new Date(),
    };
    logger.debug('Cached subscription status', this.cachedSubscription);
  }

  /**
   * Get cached subscription status if still valid.
   * Returns null if cache is expired or not available.
   */
  getCachedSubscription(): { tier: string; minutesUsed: number; minutesLimit: number } | null {
    if (!this.cachedSubscription) {
      return null;
    }

    const age = Date.now() - this.cachedSubscription.cachedAt.getTime();
    if (age > this.SUBSCRIPTION_CACHE_TTL_MS) {
      logger.debug('Cached subscription expired');
      return null;
    }

    return {
      tier: this.cachedSubscription.tier,
      minutesUsed: this.cachedSubscription.minutesUsed,
      minutesLimit: this.cachedSubscription.minutesLimit,
    };
  }

  /**
   * Check if we should use fallback behavior for a feature.
   * @param service - The service to check
   * @returns true if we should use fallback/heuristic behavior
   */
  shouldUseFallback(service: keyof ServiceStatuses): boolean {
    return !this.isAvailable(service);
  }

  /**
   * Subscribe to status changes.
   */
  subscribe(listener: (statuses: ServiceStatuses) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Notify all listeners of status changes.
   */
  private notifyListeners(): void {
    const statuses = this.getStatuses();
    for (const listener of this.listeners) {
      try {
        listener(statuses);
      } catch (error) {
        logger.error('Error in service status listener', error);
      }
    }
  }

  /**
   * Get a user-friendly status message for display.
   */
  getStatusMessage(): string {
    const overall = this.getOverallStatus();

    switch (overall) {
      case 'available':
        return 'All services operational';
      case 'degraded': {
        const issues: string[] = [];
        if (this.statuses.backend.status === 'degraded') {
          issues.push('Backend experiencing issues');
        }
        if (!this.isAvailable('transcription')) {
          issues.push('Transcription limited');
        }
        if (!this.isAvailable('ame')) {
          issues.push('Audio export limited');
        }
        return issues.join('. ') || 'Some services degraded';
      }
      case 'unavailable':
        return 'Services temporarily unavailable';
    }
  }

  /**
   * Get CSS color for status indicator.
   */
  getStatusColor(): string {
    const overall = this.getOverallStatus();

    switch (overall) {
      case 'available':
        return 'var(--spectrum-global-color-green-500)';
      case 'degraded':
        return 'var(--spectrum-global-color-orange-500)';
      case 'unavailable':
        return 'var(--spectrum-global-color-red-500)';
    }
  }
}

// Singleton instance
export const serviceStatus = new ServiceStatusTracker();
