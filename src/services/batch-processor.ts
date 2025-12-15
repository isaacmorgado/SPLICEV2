import { logger } from '../lib/logger';
import { PremiereAPI } from '../api/premiere';
import { SpliceError, SpliceErrorCode } from '../lib/errors';

/**
 * Service for batch processing multiple sequences in a project.
 * Supports queue management, progress tracking, and cancel/pause operations.
 */
export class BatchProcessor {
  private jobs: Map<string, BatchJob> = new Map();
  private isProcessing: boolean = false;
  private isPaused: boolean = false;
  private currentJobId: string | null = null;
  private premiereAPI: PremiereAPI;

  constructor(premiereAPI?: PremiereAPI) {
    this.premiereAPI = premiereAPI || new PremiereAPI();
  }

  /**
   * Add sequences to the batch queue
   */
  async queueSequences(
    sequenceIds: string[],
    _options: BatchProcessorOptions = {}
  ): Promise<{ success: boolean; queuedJobs: number; error?: string }> {
    try {
      let queuedCount = 0;

      for (const sequenceId of sequenceIds) {
        // Get sequence info from Premiere
        const sequenceName = await this.getSequenceName(sequenceId);

        const job: BatchJob = {
          id: `job-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          sequenceId,
          sequenceName,
          status: 'pending',
          progress: 0,
        };

        this.jobs.set(job.id, job);
        queuedCount++;

        logger.info(`Queued job ${job.id} for sequence: ${sequenceName}`);
      }

      return {
        success: true,
        queuedJobs: queuedCount,
      };
    } catch (error) {
      logger.error('Failed to queue sequences', error);
      return {
        success: false,
        queuedJobs: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Start processing the batch queue
   */
  async startProcessing(options: BatchProcessorOptions = {}): Promise<BatchProcessingResult> {
    if (this.isProcessing) {
      throw new SpliceError(
        SpliceErrorCode.OPERATION_IN_PROGRESS,
        'Batch processing already in progress'
      );
    }

    this.isProcessing = true;
    this.isPaused = false;

    const result: BatchProcessingResult = {
      totalJobs: this.jobs.size,
      completedJobs: 0,
      failedJobs: 0,
      jobs: [],
      errors: [],
    };

    logger.info(`Starting batch processing of ${this.jobs.size} jobs`);

    for (const [jobId, job] of this.jobs.entries()) {
      // Check if paused or cancelled
      if (this.isPaused) {
        logger.info('Batch processing paused');
        break;
      }

      if (job.status === 'cancelled') {
        continue;
      }

      // Update job status
      job.status = 'processing';
      job.startedAt = new Date();
      this.currentJobId = jobId;

      try {
        // Process the sequence
        await this.processSequence(job, options);

        // Mark as completed
        job.status = 'completed';
        job.progress = 100;
        job.completedAt = new Date();
        result.completedJobs++;

        if (options.onComplete) {
          options.onComplete(job);
        }

        logger.info(`Completed job ${jobId} for sequence: ${job.sequenceName}`);
      } catch (error) {
        // Mark as failed
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : 'Unknown error';
        job.completedAt = new Date();
        result.failedJobs++;

        result.errors.push({
          jobId,
          error: job.error,
        });

        if (options.onError) {
          options.onError(job, error as Error);
        }

        logger.error(`Failed job ${jobId} for sequence: ${job.sequenceName}`, error);
      }

      result.jobs.push(job);
    }

    this.isProcessing = false;
    this.currentJobId = null;

    logger.info(
      `Batch processing complete: ${result.completedJobs} completed, ${result.failedJobs} failed`
    );

    return result;
  }

  /**
   * Process a single sequence
   */
  private async processSequence(job: BatchJob, options: BatchProcessorOptions): Promise<void> {
    // TODO: This would need to interact with PremiereAPI to:
    // 1. Switch to the sequence
    // 2. Run silence detection with the given options
    // 3. Apply cuts
    // 4. Report progress

    // For now, simulate processing with progress updates
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      if (this.isPaused || job.status === 'cancelled') {
        throw new Error('Processing cancelled');
      }

      job.progress = ((i + 1) / steps) * 100;

      if (options.onProgress) {
        options.onProgress(job);
      }

      // Simulate work
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // In a real implementation, this would call:
    // await this.premiereAPI.switchToSequence(job.sequenceId);
    // const threshold = options.silenceThreshold || options.preset?.threshold || -40;
    // const useVoiceIsolation = options.useVoiceIsolation || options.preset?.useVoiceIsolation || false;
    // await this.premiereAPI.autoCutSilence(threshold, { useVoiceIsolation });
  }

  /**
   * Pause batch processing
   */
  pause(): void {
    if (!this.isProcessing) {
      logger.warn('Cannot pause: batch processing not running');
      return;
    }

    this.isPaused = true;
    logger.info('Batch processing paused');
  }

  /**
   * Resume batch processing
   */
  async resume(options: BatchProcessorOptions = {}): Promise<BatchProcessingResult> {
    if (!this.isPaused) {
      throw new Error('Cannot resume: batch processing not paused');
    }

    this.isPaused = false;
    logger.info('Batch processing resumed');

    return this.startProcessing(options);
  }

  /**
   * Cancel a specific job
   */
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) {
      logger.warn(`Cannot cancel job ${jobId}: not found`);
      return false;
    }

    if (job.status === 'completed' || job.status === 'failed') {
      logger.warn(`Cannot cancel job ${jobId}: already finished`);
      return false;
    }

    job.status = 'cancelled';
    job.completedAt = new Date();
    logger.info(`Cancelled job ${jobId}`);

    return true;
  }

  /**
   * Cancel all pending and processing jobs
   */
  cancelAll(): number {
    let cancelledCount = 0;

    for (const job of this.jobs.values()) {
      if (job.status === 'pending' || job.status === 'processing') {
        job.status = 'cancelled';
        job.completedAt = new Date();
        cancelledCount++;
      }
    }

    this.isPaused = false;
    this.isProcessing = false;
    this.currentJobId = null;

    logger.info(`Cancelled ${cancelledCount} jobs`);
    return cancelledCount;
  }

  /**
   * Clear completed and failed jobs from queue
   */
  clearFinishedJobs(): number {
    let clearedCount = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        this.jobs.delete(jobId);
        clearedCount++;
      }
    }

    logger.info(`Cleared ${clearedCount} finished jobs`);
    return clearedCount;
  }

  /**
   * Get all jobs
   */
  getJobs(): BatchJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get jobs by status
   */
  getJobsByStatus(status: BatchJobStatus): BatchJob[] {
    return Array.from(this.jobs.values()).filter((job) => job.status === status);
  }

  /**
   * Get a specific job
   */
  getJob(jobId: string): BatchJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get current processing state
   */
  getState(): {
    isProcessing: boolean;
    isPaused: boolean;
    currentJobId: string | null;
    totalJobs: number;
    pendingJobs: number;
    processingJobs: number;
    completedJobs: number;
    failedJobs: number;
  } {
    const jobs = Array.from(this.jobs.values());

    return {
      isProcessing: this.isProcessing,
      isPaused: this.isPaused,
      currentJobId: this.currentJobId,
      totalJobs: jobs.length,
      pendingJobs: jobs.filter((j) => j.status === 'pending').length,
      processingJobs: jobs.filter((j) => j.status === 'processing').length,
      completedJobs: jobs.filter((j) => j.status === 'completed').length,
      failedJobs: jobs.filter((j) => j.status === 'failed').length,
    };
  }

  /**
   * Helper method to get sequence name from Premiere
   */
  private async getSequenceName(sequenceId: string): Promise<string> {
    // In a real implementation, this would query Premiere
    // For now, return a placeholder
    return `Sequence ${sequenceId.substring(0, 8)}`;
  }

  /**
   * Reset the batch processor
   */
  reset(): void {
    this.cancelAll();
    this.jobs.clear();
    this.isProcessing = false;
    this.isPaused = false;
    this.currentJobId = null;
    logger.info('Batch processor reset');
  }
}

// Singleton instance
export const batchProcessor = new BatchProcessor();
