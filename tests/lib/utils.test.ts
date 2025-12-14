import { describe, it, expect } from 'vitest';
import {
  formatTimecode,
  parseTimecode,
  clamp,
  lerp,
  generateId,
  deepClone,
} from '../../src/lib/utils';

describe('Utils', () => {
  describe('formatTimecode', () => {
    it('formats 0 seconds correctly', () => {
      expect(formatTimecode(0)).toBe('00:00:00:00');
    });

    it('formats 1 hour correctly', () => {
      expect(formatTimecode(3600)).toBe('01:00:00:00');
    });

    it('formats complex timecode correctly', () => {
      expect(formatTimecode(3661.5, 30)).toBe('01:01:01:15');
    });

    it('handles different frame rates', () => {
      expect(formatTimecode(1.5, 24)).toBe('00:00:01:12');
      expect(formatTimecode(1.5, 30)).toBe('00:00:01:15');
    });
  });

  describe('parseTimecode', () => {
    it('parses zero timecode', () => {
      expect(parseTimecode('00:00:00:00')).toBe(0);
    });

    it('parses 1 hour', () => {
      expect(parseTimecode('01:00:00:00')).toBe(3600);
    });

    it('parses with frames', () => {
      const result = parseTimecode('00:00:01:15', 30);
      expect(result).toBe(1.5);
    });

    it('throws on invalid format', () => {
      expect(() => parseTimecode('00:00:00')).toThrow('Invalid timecode format');
    });
  });

  describe('clamp', () => {
    it('clamps value below min', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('clamps value above max', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('returns value within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });
  });

  describe('lerp', () => {
    it('returns start at t=0', () => {
      expect(lerp(0, 100, 0)).toBe(0);
    });

    it('returns end at t=1', () => {
      expect(lerp(0, 100, 1)).toBe(100);
    });

    it('returns midpoint at t=0.5', () => {
      expect(lerp(0, 100, 0.5)).toBe(50);
    });

    it('clamps t to [0, 1]', () => {
      expect(lerp(0, 100, 1.5)).toBe(100);
      expect(lerp(0, 100, -0.5)).toBe(0);
    });
  });

  describe('generateId', () => {
    it('generates unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });

    it('uses custom prefix', () => {
      const id = generateId('test');
      expect(id.startsWith('test_')).toBe(true);
    });
  });

  describe('deepClone', () => {
    it('clones objects', () => {
      const obj = { a: 1, b: { c: 2 } };
      const clone = deepClone(obj);

      expect(clone).toEqual(obj);
      expect(clone).not.toBe(obj);
      expect(clone.b).not.toBe(obj.b);
    });

    it('clones arrays', () => {
      const arr = [1, [2, 3]];
      const clone = deepClone(arr);

      expect(clone).toEqual(arr);
      expect(clone).not.toBe(arr);
      expect(clone[1]).not.toBe(arr[1]);
    });
  });
});
