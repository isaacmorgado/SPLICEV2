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
   * Process a single sequence - the core implementation
   */
  private async processSequence(job: BatchJob, options: BatchProcessorOptions): Promise<void> {
    const threshold = options.silenceThreshold || options.preset?.threshold || -40;
    const useVoiceIsolation =
      options.useVoiceIsolation ?? options.preset?.useVoiceIsolation ?? false;

    // Step 1: Switch to the target sequence (10% progress)
    logger.info(`Switching to sequence: ${job.sequenceName}`);
    job.progress = 5;
    this.reportProgress(job, options);

    const switched = await this.premiereAPI.switchToSequence(job.sequenceId);
    if (!switched) {
      throw new SpliceError(
        SpliceErrorCode.SEQUENCE_NOT_FOUND,
        `Could not switch to sequence: ${job.sequenceName}`
      );
    }

    job.progress = 10;
    this.reportProgress(job, options);

    // Check for cancellation (status can change externally via cancelJob)
    if (this.isPaused || (job.status as BatchJobStatus) === 'cancelled') {
      throw new Error('Processing cancelled');
    }

    // Step 2: Run silence detection (10% -> 60% progress)
    logger.info(`Detecting silence in sequence: ${job.sequenceName}`);
    job.progress = 15;
    this.reportProgress(job, options);

    const detectionResult = await this.premiereAPI.autoCutSilence(threshold, {
      useVoiceIsolation,
      useAIAnalysis: true,
    });

    job.progress = 60;
    this.reportProgress(job, options);

    // Check for cancellation (status can change externally via cancelJob)
    if (this.isPaused || (job.status as BatchJobStatus) === 'cancelled') {
      this.premiereAPI.clearPendingSections();
      throw new Error('Processing cancelled');
    }

    // Step 3: Apply the cuts (60% -> 95% progress)
    if (detectionResult.silentSections > 0) {
      logger.info(`Applying ${detectionResult.silentSections} cuts to: ${job.sequenceName}`);
      job.progress = 65;
      this.reportProgress(job, options);

      const applyResult = await this.premiereAPI.applySilenceCuts();

      if (applyResult.errors.length > 0) {
        logger.warn(`Some cuts failed: ${applyResult.errors.length} errors`, applyResult.errors);
      }

      logger.info(
        `Applied ${applyResult.cutsApplied}/${applyResult.cutsAttempted} cuts, removed ${applyResult.timeRemoved.toFixed(1)}s`
      );
    } else {
      logger.info(`No silence detected in: ${job.sequenceName}`);
    }

    job.progress = 95;
    this.reportProgress(job, options);

    // Step 4: Finalize (95% -> 100%)
    // Small delay to allow UI to update
    await new Promise((resolve) => setTimeout(resolve, 100));

    job.progress = 100;
    this.reportProgress(job, options);
  }

  /**
   * Report progress to callback if provided
   */
  private reportProgress(job: BatchJob, options: BatchProcessorOptions): void {
    if (options.onProgress) {
      options.onProgress(job);
    }
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

    // Clear any pending cuts from the API
    this.premiereAPI.clearPendingSections();

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
    const info = await this.premiereAPI.getSequenceInfo(sequenceId);
    if (info) {
      return info.name;
    }
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
