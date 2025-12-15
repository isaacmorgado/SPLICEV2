export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private minLevel: LogLevel = 'debug';
  private logs: LogEntry[] = [];
  private maxLogs: number = 1000;

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Get logs filtered by level.
   * Returns all logs at or above the specified level.
   */
  getLogsFiltered(minLevel: LogLevel = 'debug', limit: number = 50): LogEntry[] {
    const minLevelNum = LOG_LEVELS[minLevel];
    return this.logs.filter((entry) => LOG_LEVELS[entry.level] >= minLevelNum).slice(-limit);
  }

  /**
   * Export logs as a formatted string for debugging.
   */
  exportLogs(minLevel: LogLevel = 'debug'): string {
    const logs = this.getLogsFiltered(minLevel, this.maxLogs);
    const lines = logs.map((entry) => {
      const time = entry.timestamp.split('T')[1].split('.')[0]; // HH:MM:SS
      const dataStr = entry.data ? ` | ${JSON.stringify(entry.data)}` : '';
      return `[${time}] ${entry.level.toUpperCase().padEnd(5)} ${entry.message}${dataStr}`;
    });
    return lines.join('\n');
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };

    this.logs.push(entry);

    // Trim old logs if exceeding max
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Also log to console for debugging
    const prefix = `[Splice ${level.toUpperCase()}]`;
    const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';

    if (data !== undefined) {
      console[consoleMethod](prefix, message, data);
    } else {
      console[consoleMethod](prefix, message);
    }
  }
}

// Singleton instance
export const logger = new Logger();
