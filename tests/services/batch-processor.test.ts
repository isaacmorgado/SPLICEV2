import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BatchProcessor } from '../../src/services/batch-processor';

describe('BatchProcessor', () => {
  let processor: BatchProcessor;

  beforeEach(() => {
    processor = new BatchProcessor();
    vi.clearAllMocks();
  });

  describe('queueSequences', () => {
    it('queues multiple sequences', async () => {
      const result = await processor.queueSequences(['seq1', 'seq2', 'seq3']);

      expect(result.success).toBe(true);
      expect(result.queuedJobs).toBe(3);

      const state = processor.getState();
      expect(state.totalJobs).toBe(3);
      expect(state.pendingJobs).toBe(3);
    });

    it('handles empty sequence list', async () => {
      const result = await processor.queueSequences([]);

      expect(result.success).toBe(true);
      expect(result.queuedJobs).toBe(0);
    });
  });

  describe('job management', () => {
    beforeEach(async () => {
      await processor.queueSequences(['seq1', 'seq2', 'seq3']);
    });

    it('gets all jobs', () => {
      const jobs = processor.getJobs();

      expect(jobs.length).toBe(3);
      expect(jobs.every((j) => j.status === 'pending')).toBe(true);
    });

    it('gets jobs by status', async () => {
      const pendingJobs = processor.getJobsByStatus('pending');
      expect(pendingJobs.length).toBe(3);

      const completedJobs = processor.getJobsByStatus('completed');
      expect(completedJobs.length).toBe(0);
    });

    it('gets a specific job', () => {
      const jobs = processor.getJobs();
      const jobId = jobs[0].id;

      const job = processor.getJob(jobId);

      expect(job).toBeDefined();
      expect(job?.id).toBe(jobId);
    });

    it('returns undefined for non-existent job', () => {
      const job = processor.getJob('non-existent-id');

      expect(job).toBeUndefined();
    });
  });

  describe('startProcessing', () => {
    it('processes queued jobs', async () => {
      await processor.queueSequences(['seq1', 'seq2']);

      const result = await processor.startProcessing();

      expect(result.totalJobs).toBe(2);
      expect(result.completedJobs).toBe(2);
      expect(result.failedJobs).toBe(0);
    });

    it('tracks progress during processing', async () => {
      await processor.queueSequences(['seq1']);

      const progressUpdates: number[] = [];

      await processor.startProcessing({
        onProgress: (job) => {
          progressUpdates.push(job.progress);
        },
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
    });

    it('calls completion callback', async () => {
      await processor.queueSequences(['seq1']);

      let completedCount = 0;

      await processor.startProcessing({
        onComplete: () => {
          completedCount++;
        },
      });

      expect(completedCount).toBe(1);
    });

    it('prevents starting when already processing', async () => {
      await processor.queueSequences(['seq1']);

      // Start processing (don't await)
      const processing = processor.startProcessing();

      // Try to start again
      await expect(processor.startProcessing()).rejects.toThrow('already in progress');

      // Wait for first to complete
      await processing;
    });
  });

  describe('cancelJob', () => {
    it('cancels a pending job', async () => {
      await processor.queueSequences(['seq1', 'seq2']);
      const jobs = processor.getJobs();

      const cancelled = processor.cancelJob(jobs[0].id);

      expect(cancelled).toBe(true);

      const job = processor.getJob(jobs[0].id);
      expect(job?.status).toBe('cancelled');
    });

    it('prevents cancelling completed job', async () => {
      await processor.queueSequences(['seq1']);
      const jobs = processor.getJobs();

      // Complete the job
      await processor.startProcessing();

      const cancelled = processor.cancelJob(jobs[0].id);

      expect(cancelled).toBe(false);
    });

    it('handles non-existent job', () => {
      const cancelled = processor.cancelJob('non-existent');

      expect(cancelled).toBe(false);
    });
  });

  describe('cancelAll', () => {
    it('cancels all pending and processing jobs', async () => {
      await processor.queueSequences(['seq1', 'seq2', 'seq3']);

      const cancelledCount = processor.cancelAll();

      expect(cancelledCount).toBe(3);

      const state = processor.getState();
      expect(state.pendingJobs).toBe(0);
      expect(state.processingJobs).toBe(0);
    });

    it('does not cancel completed jobs', async () => {
      await processor.queueSequences(['seq1', 'seq2']);

      // Complete first job
      await processor.startProcessing();

      // Queue another
      await processor.queueSequences(['seq3']);

      const cancelledCount = processor.cancelAll();

      // Should only cancel the new pending job
      expect(cancelledCount).toBe(1);
    });
  });

  describe('pause and resume', () => {
    it('pauses processing', async () => {
      await processor.queueSequences(['seq1', 'seq2', 'seq3']);

      // Start processing in background
      const processingPromise = processor.startProcessing();

      // Pause immediately
      processor.pause();

      await processingPromise;

      const state = processor.getState();
      expect(state.isPaused).toBe(true);

      // Not all jobs should be completed due to pause
      expect(state.completedJobs).toBeLessThan(3);
    });

    it('resumes processing', async () => {
      await processor.queueSequences(['seq1', 'seq2']);

      // Start and pause
      const processingPromise = processor.startProcessing();
      processor.pause();
      await processingPromise;

      // Resume
      const resumeResult = await processor.resume();

      expect(resumeResult.totalJobs).toBe(2);
      expect(resumeResult.completedJobs).toBe(2);
    });

    it('throws error when resuming without pause', async () => {
      await expect(processor.resume()).rejects.toThrow('not paused');
    });
  });

  describe('clearFinishedJobs', () => {
    it('clears completed and failed jobs', async () => {
      await processor.queueSequences(['seq1', 'seq2', 'seq3']);

      // Complete some jobs
      await processor.startProcessing();

      // Queue a new one
      await processor.queueSequences(['seq4']);

      const clearedCount = processor.clearFinishedJobs();

      expect(clearedCount).toBe(3); // The 3 completed jobs

      const state = processor.getState();
      expect(state.totalJobs).toBe(1); // Only the new pending job remains
    });
  });

  describe('reset', () => {
    it('resets the batch processor', async () => {
      await processor.queueSequences(['seq1', 'seq2']);
      await processor.startProcessing();

      processor.reset();

      const state = processor.getState();
      expect(state.totalJobs).toBe(0);
      expect(state.isProcessing).toBe(false);
      expect(state.isPaused).toBe(false);
      expect(state.currentJobId).toBeNull();
    });
  });

  describe('getState', () => {
    it('returns current processing state', async () => {
      await processor.queueSequences(['seq1', 'seq2', 'seq3']);

      const initialState = processor.getState();
      expect(initialState.isProcessing).toBe(false);
      expect(initialState.isPaused).toBe(false);
      expect(initialState.totalJobs).toBe(3);
      expect(initialState.pendingJobs).toBe(3);
      expect(initialState.processingJobs).toBe(0);
      expect(initialState.completedJobs).toBe(0);
      expect(initialState.failedJobs).toBe(0);
    });

    it('updates state during processing', async () => {
      await processor.queueSequences(['seq1']);

      const stateSnapshots: ReturnType<typeof processor.getState>[] = [];

      await processor.startProcessing({
        onProgress: () => {
          stateSnapshots.push(processor.getState());
        },
      });

      expect(stateSnapshots.length).toBeGreaterThan(0);
      // At least one snapshot should show processing
      expect(stateSnapshots.some((s) => s.processingJobs > 0 || s.completedJobs > 0)).toBe(true);
    });
  });
});
