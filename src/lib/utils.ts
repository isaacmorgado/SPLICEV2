/**
 * Format seconds to timecode string (HH:MM:SS:FF)
 */
export function formatTimecode(seconds: number, frameRate: number = 30): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const frames = Math.floor((seconds % 1) * frameRate);

  return [hours, minutes, secs, frames].map((n) => n.toString().padStart(2, '0')).join(':');
}

/**
 * Parse timecode string to seconds
 */
export function parseTimecode(timecode: string, frameRate: number = 30): number {
  const parts = timecode.split(':').map(Number);

  if (parts.length !== 4) {
    throw new Error('Invalid timecode format. Expected HH:MM:SS:FF');
  }

  const [hours, minutes, seconds, frames] = parts;
  return hours * 3600 + minutes * 60 + seconds + frames / frameRate;
}

/**
 * Debounce function calls
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;

  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle function calls
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clamp a number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * clamp(t, 0, 1);
}

/**
 * Generate a unique ID
 */
export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if running in UXP environment
 */
export function isUXPEnvironment(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('uxp');
    return true;
  } catch {
    return false;
  }
}
