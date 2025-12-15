import { describe, it, expect, beforeEach } from 'vitest';
import { AudioCache, TranscriptionCache, VoiceIsolationCache } from '../../src/utils/audio-cache';

describe('AudioCache', () => {
  let cache: AudioCache<string>;

  beforeEach(() => {
    cache = new AudioCache<string>({
      maxEntries: 3,
      maxSizeBytes: 1000,
      ttlMs: 1000, // 1 second for faster testing
    });
  });

  describe('generateKey', () => {
    it('generates consistent keys for same buffer', async () => {
      const buffer = new ArrayBuffer(10);
      const view = new Uint8Array(buffer);
      view.fill(42);

      const key1 = await cache.generateKey(buffer);
      const key2 = await cache.generateKey(buffer);

      expect(key1).toBe(key2);
    });

    it('generates different keys for different buffers', async () => {
      const buffer1 = new ArrayBuffer(10);
      const buffer2 = new ArrayBuffer(10);
      new Uint8Array(buffer1).fill(1);
      new Uint8Array(buffer2).fill(2);

      const key1 = await cache.generateKey(buffer1);
      const key2 = await cache.generateKey(buffer2);

      expect(key1).not.toBe(key2);
    });

    it('includes prefix in key when provided', async () => {
      const buffer = new ArrayBuffer(10);
      const key = await cache.generateKey(buffer, 'test');

      expect(key).toContain('test:');
    });
  });

  describe('get/set', () => {
    it('stores and retrieves values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('returns undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('updates hit count on repeated access', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('key1');

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
    });

    it('tracks cache misses', () => {
      cache.get('nonexistent');
      cache.get('nonexistent');

      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entry when maxEntries exceeded', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4'); // Should evict key1

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
    });

    it('moves accessed entries to end (most recent)', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Access key1, making it most recent
      cache.get('key1');

      // Add key4, should evict key2 (oldest)
      cache.set('key4', 'value4');

      expect(cache.get('key1')).toBe('value1'); // Still there
      expect(cache.get('key2')).toBeUndefined(); // Evicted
      expect(cache.get('key3')).toBe('value3'); // Still there
      expect(cache.get('key4')).toBe('value4'); // New entry
    });
  });

  describe('size-based eviction', () => {
    it('evicts entries when total size exceeds limit', () => {
      // Each string is ~10 bytes, cache limit is 1000 bytes
      const largeValue = 'x'.repeat(500); // ~500 bytes

      cache.set('key1', largeValue, 500);
      cache.set('key2', largeValue, 500);
      cache.set('key3', 'small', 10); // Should evict key1

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBe(largeValue);
      expect(cache.get('key3')).toBe('small');
    });
  });

  describe('TTL (time to live)', () => {
    it('expires entries after TTL', async () => {
      cache.set('key1', 'value1');

      expect(cache.get('key1')).toBe('value1');

      // Wait for TTL to expire (1 second + buffer)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      expect(cache.get('key1')).toBeUndefined();
    });

    it('updates timestamp on access', async () => {
      cache.set('key1', 'value1');

      // Access after 500ms
      await new Promise((resolve) => setTimeout(resolve, 500));
      cache.get('key1');

      // Wait another 600ms (total 1100ms, but last access was only 600ms ago)
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Should still be valid because access updated timestamp
      expect(cache.get('key1')).toBe('value1');
    });
  });

  describe('delete', () => {
    it('removes specific entry', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBe('value2');
    });

    it('returns false for non-existent key', () => {
      expect(cache.delete('nonexistent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.clear();

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.getStats().entries).toBe(0);
    });

    it('resets hit/miss counters', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('nonexistent');

      cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('getStats', () => {
    it('returns accurate statistics', () => {
      cache.set('key1', 'value1', 10);
      cache.set('key2', 'value2', 20);

      cache.get('key1'); // Hit
      cache.get('key1'); // Hit
      cache.get('nonexistent'); // Miss

      const stats = cache.getStats();

      expect(stats.entries).toBe(2);
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.totalSize).toBe(30);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
    });
  });

  describe('pruneExpired', () => {
    it('removes expired entries', async () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const pruned = cache.pruneExpired();

      expect(pruned).toBe(2);
      expect(cache.getStats().entries).toBe(0);
    });

    it('keeps non-expired entries', async () => {
      cache.set('key1', 'value1');

      // Wait 500ms
      await new Promise((resolve) => setTimeout(resolve, 500));

      cache.set('key2', 'value2'); // Fresh entry

      // Wait another 600ms (key1 expired, key2 still fresh)
      await new Promise((resolve) => setTimeout(resolve, 600));

      const pruned = cache.pruneExpired();

      expect(pruned).toBe(1);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBe('value2');
    });
  });
});

describe('TranscriptionCache', () => {
  let cache: TranscriptionCache;

  beforeEach(() => {
    cache = new TranscriptionCache();
  });

  describe('getByAudio/setByAudio', () => {
    it('caches and retrieves transcription results by audio buffer', async () => {
      const buffer = new ArrayBuffer(100);
      new Uint8Array(buffer).fill(42);

      const result: TranscriptionResult = {
        success: true,
        text: 'Hello world',
        segments: [
          { start: 0, end: 1, text: 'Hello', confidence: 0.9 },
          { start: 1, end: 2, text: 'world', confidence: 0.95 },
        ],
      };

      await cache.setByAudio(buffer, result);
      const retrieved = await cache.getByAudio(buffer);

      expect(retrieved).toEqual(result);
    });

    it('returns undefined for uncached audio', async () => {
      const buffer = new ArrayBuffer(100);
      const result = await cache.getByAudio(buffer);

      expect(result).toBeUndefined();
    });

    it('uses same cache key for identical audio', async () => {
      const buffer1 = new ArrayBuffer(100);
      const buffer2 = new ArrayBuffer(100);
      new Uint8Array(buffer1).fill(42);
      new Uint8Array(buffer2).fill(42);

      const result: TranscriptionResult = {
        success: true,
        text: 'Test',
        segments: [],
      };

      await cache.setByAudio(buffer1, result);
      const retrieved = await cache.getByAudio(buffer2);

      expect(retrieved).toEqual(result);
    });
  });
});

describe('VoiceIsolationCache', () => {
  let cache: VoiceIsolationCache;

  beforeEach(() => {
    cache = new VoiceIsolationCache();
  });

  describe('getByAudio/setByAudio', () => {
    it('caches and retrieves isolation results by audio buffer', async () => {
      const buffer = new ArrayBuffer(100);
      new Uint8Array(buffer).fill(42);

      const result: IsolatedAudio = {
        vocals: new ArrayBuffer(50),
        background: new ArrayBuffer(50),
      };

      await cache.setByAudio(buffer, result);
      const retrieved = await cache.getByAudio(buffer);

      expect(retrieved).toEqual(result);
    });

    it('estimates size based on output buffers', async () => {
      const buffer = new ArrayBuffer(100);
      const result: IsolatedAudio = {
        vocals: new ArrayBuffer(200),
        background: new ArrayBuffer(300),
      };

      await cache.setByAudio(buffer, result);
      const stats = cache.getStats();

      expect(stats.totalSize).toBe(500); // 200 + 300
    });
  });
});
