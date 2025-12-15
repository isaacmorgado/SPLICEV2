/**
 * Operation Lock Service
 *
 * Prevents multiple concurrent operations that could cause race conditions
 * or resource conflicts. Only one major operation can run at a time.
 */

import { logger } from './logger';
import { SpliceError, SpliceErrorCode } from './errors';

export type OperationType =
  | 'audio-extraction'
  | 'transcription'
  | 'silence-detection'
  | 'take-detection'
  | 'apply-cuts'
  | 'apply-takes'
  | 'export';

/**
 * Singleton service for managing operation locks.
 * Ensures only one major operation runs at a time.
 */
class OperationLock {
  private activeOperation: OperationType | null = null;
  private operationStartTime: number = 0;
  private abortController: AbortController | null = null;

  /**
   * Attempt to acquire the lock for an operation.
   *
   * @param operation - The type of operation being started
   * @returns An AbortSignal that can be used to cancel the operation
   * @throws SpliceError if another operation is in progress
   */
  acquire(operation: OperationType): AbortSignal {
    if (this.activeOperation !== null) {
      const elapsed = Date.now() - this.operationStartTime;
      throw new SpliceError(
        SpliceErrorCode.PREMIERE_OPERATION_LOCKED,
        `Cannot start ${operation}: ${this.activeOperation} is in progress`,
        {
          blockedBy: this.activeOperation,
          elapsedMs: elapsed,
          requestedOperation: operation,
        }
      );
    }

    this.activeOperation = operation;
    this.operationStartTime = Date.now();
    this.abortController = new AbortController();

    logger.debug(`Operation lock acquired: ${operation}`);
    return this.abortController.signal;
  }

  /**
   * Release the lock after an operation completes.
   *
   * @param operation - The operation being released (must match acquired operation)
   */
  release(operation: OperationType): void {
    if (this.activeOperation !== operation) {
      logger.warn(`Attempted to release lock for ${operation} but ${this.activeOperation} is held`);
      return;
    }

    const elapsed = Date.now() - this.operationStartTime;
    logger.debug(`Operation lock released: ${operation} (${elapsed}ms)`);

    this.activeOperation = null;
    this.operationStartTime = 0;
    this.abortController = null;
  }

  /**
   * Cancel the currently running operation.
   * The operation should check the AbortSignal and stop gracefully.
   */
  cancel(): void {
    if (this.abortController && this.activeOperation) {
      logger.info(`Cancelling operation: ${this.activeOperation}`);
      this.abortController.abort();
    }
  }

  /**
   * Check if an operation is currently in progress.
   */
  isLocked(): boolean {
    return this.activeOperation !== null;
  }

  /**
   * Get the name of the currently active operation, if any.
   */
  getActiveOperation(): OperationType | null {
    return this.activeOperation;
  }

  /**
   * Get how long the current operation has been running, in milliseconds.
   */
  getElapsedTime(): number {
    if (this.activeOperation === null) return 0;
    return Date.now() - this.operationStartTime;
  }

  /**
   * Force release the lock (use with caution).
   * This is for error recovery when an operation fails without releasing.
   */
  forceRelease(): void {
    if (this.activeOperation) {
      logger.warn(`Force releasing lock for: ${this.activeOperation}`);
      this.activeOperation = null;
      this.operationStartTime = 0;
      this.abortController = null;
    }
  }
}

// Singleton instance
export const operationLock = new OperationLock();

/**
 * Decorator-like helper to wrap an async operation with lock management.
 * Automatically acquires and releases the lock, and handles errors.
 *
 * @param operation - The type of operation
 * @param fn - The async function to execute
 * @returns The result of the function
 */
export async function withOperationLock<T>(
  operation: OperationType,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const signal = operationLock.acquire(operation);

  try {
    return await fn(signal);
  } finally {
    operationLock.release(operation);
  }
}
