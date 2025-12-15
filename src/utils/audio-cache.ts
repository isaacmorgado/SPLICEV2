/**
 * Audio Cache Utility
 *
 * Provides result caching for transcription and audio processing operations.
 * Uses SHA-256 hashing of audio buffers as cache keys to avoid reprocessing
 * identical audio content.
 *
 * Cache entries are stored in memory with LRU eviction policy to prevent
 * memory exhaustion in long editing sessions.
 */

import { logger } from '../lib/logger';

export interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
  size: number; // Approximate size in bytes
  hitCount: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  totalSize: number;
  hitRate: number;
}

export interface AudioCacheOptions {
  maxEntries?: number;
  maxSizeBytes?: number;
  ttlMs?: number; // Time to live in milliseconds
}

/**
 * LRU Cache implementation for audio processing results.
 * Thread-safe and memory-efficient.
 */
export class AudioCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private maxEntries: number;
  private maxSizeBytes: number;
  private ttlMs: number;
  private hits = 0;
  private misses = 0;
  private totalSize = 0;

  constructor(options: AudioCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 50;
    this.maxSizeBytes = options.maxSizeBytes ?? 100 * 1024 * 1024; // 100MB default
    this.ttlMs = options.ttlMs ?? 3600000; // 1 hour default
    this.cache = new Map();

    logger.info('AudioCache initialized', {
      maxEntries: this.maxEntries,
      maxSizeBytes: this.maxSizeBytes,
      ttlMs: this.ttlMs,
    });
  }

  /**
   * Generate a cache key from audio buffer using SHA-256 hash.
   * Uses SubtleCrypto API available in UXP environment.
   */
  async generateKey(audioBuffer: ArrayBuffer, prefix = ''): Promise<string> {
    try {
      // Use Web Crypto API for hashing
      const hashBuffer = await crypto.subtle.digest('SHA-256', audioBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

      return prefix ? `${prefix}:${hashHex}` : hashHex;
    } catch (error) {
      logger.warn('Failed to generate hash, using fallback', error);
      // Fallback to simple hash based on size and first/last bytes
      const view = new Uint8Array(audioBuffer);
      const fallbackHash = `${prefix}:${audioBuffer.byteLength}-${view[0]}-${view[view.length - 1]}`;
      return fallbackHash;
    }
  }

  /**
   * Get a value from cache by key.
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check TTL
    const now = Date.now();
    if (now - entry.timestamp > this.ttlMs) {
      logger.debug(`Cache entry expired: ${key}`);
      this.delete(key);
      this.misses++;
      return undefined;
    }

    // Update access time and hit count (LRU)
    entry.timestamp = now;
    entry.hitCount++;
    this.hits++;

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    logger.debug(`Cache hit: ${key}`, { hitCount: entry.hitCount });
    return entry.value;
  }

  /**
   * Set a value in cache.
   */
  set(key: string, value: T, estimatedSize?: number): void {
    const size = estimatedSize ?? this.estimateSize(value);

    // Check if we need to evict entries
    while (
      (this.cache.size >= this.maxEntries || this.totalSize + size > this.maxSizeBytes) &&
      this.cache.size > 0
    ) {
      this.evictLRU();
    }

    // Add new entry
    const entry: CacheEntry<T> = {
      key,
      value,
      timestamp: Date.now(),
      size,
      hitCount: 0,
    };

    this.cache.set(key, entry);
    this.totalSize += size;

    logger.debug(`Cache set: ${key}`, { size, totalEntries: this.cache.size });
  }

  /**
   * Delete a specific entry.
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.totalSize -= entry.size;
      this.cache.delete(key);
      logger.debug(`Cache delete: ${key}`);
      return true;
    }
    return false;
  }

  /**
   * Clear all cache entries.
   */
  clear(): void {
    this.cache.clear();
    this.totalSize = 0;
    this.hits = 0;
    this.misses = 0;
    logger.info('Cache cleared');
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.cache.size,
      totalSize: this.totalSize,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Evict the least recently used entry.
   */
  private evictLRU(): void {
    // Map maintains insertion order, so first entry is LRU
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      const entry = this.cache.get(firstKey);
      if (entry) {
        logger.debug(`Evicting LRU entry: ${firstKey}`, {
          age: Date.now() - entry.timestamp,
          hitCount: entry.hitCount,
        });
        this.totalSize -= entry.size;
      }
      this.cache.delete(firstKey);
    }
  }

  /**
   * Estimate the size of a cached value.
   * This is approximate and used for memory management.
   */
  private estimateSize(value: T): number {
    if (value === null || value === undefined) {
      return 0;
    }

    if (typeof value === 'string') {
      return value.length * 2; // UTF-16
    }

    if (value instanceof ArrayBuffer) {
      return value.byteLength;
    }

    if (typeof value === 'object') {
      // Rough estimation for objects
      const jsonStr = JSON.stringify(value);
      return jsonStr.length * 2;
    }

    return 8; // Default for primitives
  }

  /**
   * Remove expired entries from cache.
   */
  pruneExpired(): number {
    const now = Date.now();
    let pruned = 0;

    // Convert to array to avoid iterator issues
    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      if (now - entry.timestamp > this.ttlMs) {
        this.delete(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      logger.info(`Pruned ${pruned} expired cache entries`);
    }

    return pruned;
  }
}

/**
 * Specialized cache for transcription results.
 */
export class TranscriptionCache extends AudioCache<TranscriptionResult> {
  constructor(options: AudioCacheOptions = {}) {
    super({
      maxEntries: options.maxEntries ?? 30,
      maxSizeBytes: options.maxSizeBytes ?? 50 * 1024 * 1024, // 50MB
      ttlMs: options.ttlMs ?? 7200000, // 2 hours
    });
  }

  /**
   * Get cached transcription result by audio buffer.
   */
  async getByAudio(audioBuffer: ArrayBuffer): Promise<TranscriptionResult | undefined> {
    const key = await this.generateKey(audioBuffer, 'transcription');
    return this.get(key);
  }

  /**
   * Cache a transcription result.
   */
  async setByAudio(audioBuffer: ArrayBuffer, result: TranscriptionResult): Promise<void> {
    const key = await this.generateKey(audioBuffer, 'transcription');

    // Estimate size based on segments
    const estimatedSize = result.segments.reduce(
      (acc, seg) => acc + seg.text.length * 2 + 32, // text + metadata
      0
    );

    this.set(key, result, estimatedSize);
  }
}

/**
 * Specialized cache for voice isolation results.
 */
export class VoiceIsolationCache extends AudioCache<IsolatedAudio> {
  constructor(options: AudioCacheOptions = {}) {
    super({
      maxEntries: options.maxEntries ?? 10,
      maxSizeBytes: options.maxSizeBytes ?? 200 * 1024 * 1024, // 200MB (audio buffers are large)
      ttlMs: options.ttlMs ?? 3600000, // 1 hour
    });
  }

  /**
   * Get cached isolated audio by original buffer.
   */
  async getByAudio(audioBuffer: ArrayBuffer): Promise<IsolatedAudio | undefined> {
    const key = await this.generateKey(audioBuffer, 'isolation');
    return this.get(key);
  }

  /**
   * Cache isolated audio result.
   */
  async setByAudio(audioBuffer: ArrayBuffer, result: IsolatedAudio): Promise<void> {
    const key = await this.generateKey(audioBuffer, 'isolation');
    const estimatedSize = result.vocals.byteLength + result.background.byteLength;
    this.set(key, result, estimatedSize);
  }
}

// Singleton instances for global use
export const transcriptionCache = new TranscriptionCache();
export const voiceIsolationCache = new VoiceIsolationCache();
