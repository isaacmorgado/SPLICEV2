/**
 * Adobe Media Encoder (AME) Export Service
 * Handles exporting timeline audio to WAV files via Premiere's EncoderManager API.
 */

import { logger } from '../lib/logger';
import { SpliceError, SpliceErrorCode } from '../lib/errors';
import { AUDIO_CONFIG, calculateExportTimeout } from '../config/audio-config';

declare const require: (module: string) => any;

export interface AMEExportOptions {
  workArea: 'full' | 'inout' | 'workarea';
  outputPath?: string;
  /** AbortSignal for cancellation support (#14) */
  signal?: AbortSignal;
}

export interface AMEExportResult {
  success: boolean;
  filePath: string;
  duration: number;
  fileSize: number;
  error?: string;
}

/**
 * AME Exporter service for extracting audio from Premiere Pro sequences.
 * Uses the EncoderManager API to export audio-only WAV files.
 */
export class AMEExporter {
  private ppro: any = null;
  private encoderManager: any = null;
  private fs: any = null;
  /** Track active export job ID */
  private activeJobId: string | null = null;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    try {
      this.ppro = require('premiere');
      // EncoderManager may be under different paths depending on API version
      this.encoderManager = this.ppro.encoderManager || this.ppro.EncoderManager;

      const uxp = require('uxp');
      this.fs = uxp.storage.localFileSystem;

      if (this.encoderManager) {
        logger.info('AME Exporter initialized successfully');
      } else {
        logger.warn('EncoderManager not found in Premiere API');
      }
    } catch (error) {
      logger.warn('AME Exporter initialization failed', error);
    }
  }

  /**
   * Check if AME export is available.
   */
  isAvailable(): boolean {
    return this.encoderManager !== null && this.fs !== null;
  }

  /**
   * Get the path to the WAV export preset.
   * Searches for system presets first (Adobe Media Encoder), then falls back to bundled preset.
   */
  async getPresetPath(): Promise<string> {
    const presetName = 'Waveform Audio 48kHz 16-bit.epr';
    const presetSubPath = `Contents/MediaIO/systempresets/3F3F3F3F_57415645/${presetName}`;

    // System preset paths to try (macOS)
    const systemPresetPaths = [
      `/Applications/Adobe Media Encoder (Beta)/Adobe Media Encoder (Beta).app/${presetSubPath}`,
      `/Applications/Adobe Media Encoder/Adobe Media Encoder.app/${presetSubPath}`,
    ];

    // Try system presets first
    for (const presetPath of systemPresetPaths) {
      try {
        await this.fs.getEntryWithUrl(`file://${presetPath}`);
        logger.info(`Using system preset: ${presetPath}`);
        return presetPath;
      } catch {
        // Preset not found at this path, try next
      }
    }

    // Fallback to bundled preset
    try {
      const pluginFolder = await this.fs.getPluginFolder();
      const bundledPresetPath = `${pluginFolder.nativePath}/presets/SpliceAudioExport.epr`;

      await this.fs.getEntryWithUrl(`file://${bundledPresetPath}`);
      logger.info(`Using bundled preset: ${bundledPresetPath}`);
      return bundledPresetPath;
    } catch {
      // No bundled preset either
    }

    const error = new SpliceError(
      SpliceErrorCode.AME_PRESET_NOT_FOUND,
      'WAV export preset not found',
      { triedPaths: systemPresetPaths }
    );
    logger.error('Failed to find WAV export preset', error);
    throw error;
  }

  /**
   * Generate a unique temp output path for the exported audio.
   */
  private async generateTempOutputPath(): Promise<string> {
    const tempFolder = await this.fs.getTemporaryFolder();
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(7);
    const fileName = `splice_export_${timestamp}_${randomSuffix}.wav`;

    // Create the file entry
    const outputFile = await tempFolder.createFile(fileName, { overwrite: true });
    return outputFile.nativePath;
  }

  /**
   * Export sequence audio to WAV file using Adobe Media Encoder.
   *
   * @param sequence - The Premiere Pro sequence to export
   * @param options - Export options (workArea determines what portion to export)
   * @returns Export result with file path, duration, and size
   */
  async exportSequenceAudio(
    sequence: any,
    options: AMEExportOptions = { workArea: 'full' }
  ): Promise<AMEExportResult> {
    if (!this.isAvailable()) {
      throw new SpliceError(SpliceErrorCode.AME_NOT_AVAILABLE, 'EncoderManager not available', {
        hasEncoderManager: !!this.encoderManager,
        hasFs: !!this.fs,
      });
    }

    try {
      const outputPath = options.outputPath || (await this.generateTempOutputPath());
      const presetPath = await this.getPresetPath();

      // Map workArea option to Premiere's numeric values
      // 0 = Entire sequence, 1 = In to Out, 2 = Work Area
      const workAreaMap: Record<string, number> = {
        full: 0,
        inout: 1,
        workarea: 2,
      };
      const workArea = workAreaMap[options.workArea] ?? 0;

      const duration = sequence.end?.seconds ?? 0;

      logger.info('Starting AME export', {
        outputPath,
        presetPath,
        workArea,
        duration,
      });

      // Delete any existing file at output path to prevent race condition
      await this.deleteExistingFile(outputPath);

      // Start the export job
      const jobId = await this.encoderManager.exportSequence(
        sequence,
        outputPath,
        presetPath,
        workArea
      );

      if (!jobId) {
        throw new SpliceError(
          SpliceErrorCode.AME_JOB_CREATION_FAILED,
          'Export job creation failed - no job ID returned',
          { outputPath, presetPath, workArea }
        );
      }

      // Track active job
      this.activeJobId = jobId;
      logger.info(`Export job started: ${jobId}`);

      // Calculate dynamic timeout based on sequence duration
      const dynamicTimeout = calculateExportTimeout(duration);
      logger.debug(`Using dynamic timeout: ${dynamicTimeout}ms for ${duration}s sequence`);

      // Wait for export to complete (includes initial delay)
      const completed = await this.waitForExportCompletion(
        outputPath,
        dynamicTimeout,
        options.signal
      );

      // Clear job tracking
      this.activeJobId = null;

      if (!completed) {
        throw new SpliceError(
          SpliceErrorCode.AME_EXPORT_TIMEOUT,
          'Export timeout - file did not complete within timeout period',
          { outputPath, timeout: dynamicTimeout, sequenceDuration: duration }
        );
      }

      // Check if cancelled after completion
      if (options.signal?.aborted) {
        throw new SpliceError(SpliceErrorCode.AME_EXPORT_CANCELLED, 'Export cancelled by user');
      }

      // Get file size
      const fileSize = await this.getFileSize(outputPath);

      logger.info('AME export completed successfully', {
        filePath: outputPath,
        duration,
        fileSize,
      });

      return {
        success: true,
        filePath: outputPath,
        duration,
        fileSize,
      };
    } catch (error) {
      // Re-throw SpliceErrors as-is
      if (error instanceof SpliceError) {
        logger.error('AME export failed', error);
        throw error;
      }

      // Wrap other errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown export error';
      logger.error('AME export failed', error);

      throw new SpliceError(
        SpliceErrorCode.AME_EXPORT_FAILED,
        errorMessage,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Delete an existing file at the specified path if it exists.
   * This prevents race conditions from polling old files.
   */
  private async deleteExistingFile(filePath: string): Promise<void> {
    try {
      const file = await this.fs.getEntryWithUrl(`file://${filePath}`);
      if (file && typeof file.delete === 'function') {
        await file.delete();
        logger.debug(`Deleted existing file at: ${filePath}`);
      }
    } catch {
      // File doesn't exist, which is fine
    }
  }

  /**
   * Wait for export to complete by polling file existence and size stability.
   * Since UXP may not have export completion events, we poll the filesystem.
   *
   * @param outputPath - Path to the output file being exported
   * @param timeout - Maximum time to wait in milliseconds (default: 2 minutes)
   * @param signal - Optional AbortSignal for cancellation (#14)
   * @returns True if export completed, false if timed out or cancelled
   */
  async waitForExportCompletion(
    outputPath: string,
    timeout: number = AUDIO_CONFIG.EXPORT_TIMEOUT_MS,
    signal?: AbortSignal
  ): Promise<boolean> {
    const pollInterval = AUDIO_CONFIG.EXPORT_POLL_INTERVAL_MS;
    const initialDelay = AUDIO_CONFIG.EXPORT_INITIAL_DELAY_MS;
    const startTime = Date.now();
    let lastSize = 0;
    let stableCount = 0;
    const requiredStableChecks = AUDIO_CONFIG.EXPORT_STABILITY_CHECKS;

    logger.debug(`Waiting for export completion: ${outputPath}`);

    // Check for cancellation before starting
    if (signal?.aborted) {
      logger.info('Export cancelled before polling started');
      return false;
    }

    // Initial delay to give AME time to start writing the file
    await this.sleep(initialDelay);

    while (Date.now() - startTime < timeout) {
      // Check for cancellation (#14)
      if (signal?.aborted) {
        logger.info('Export cancelled during polling');
        return false;
      }

      try {
        const currentSize = await this.getFileSize(outputPath);

        if (currentSize > 0) {
          if (currentSize === lastSize) {
            stableCount++;
            logger.debug(
              `File size stable: ${currentSize} bytes (check ${stableCount}/${requiredStableChecks})`
            );

            if (stableCount >= requiredStableChecks) {
              const elapsed = Date.now() - startTime;
              logger.info(`Export completed: ${currentSize} bytes in ${elapsed}ms`);
              return true;
            }
          } else {
            // File still growing
            stableCount = 0;
            lastSize = currentSize;
            logger.debug(`File growing: ${currentSize} bytes`);
          }
        }
      } catch {
        // File doesn't exist yet - keep waiting
        stableCount = 0;
      }

      await this.sleep(pollInterval);
    }

    // Log detailed timeout info (#10 improvement)
    const elapsed = Date.now() - startTime;
    logger.error(`Export timeout after ${elapsed}ms`, {
      lastObservedSize: lastSize,
      stableChecksReached: stableCount,
      requiredStableChecks,
      outputPath,
    });
    return false;
  }

  /**
   * Get the size of a file in bytes.
   *
   * @param filePath - Path to the file
   * @returns File size in bytes, or 0 if file doesn't exist
   */
  private async getFileSize(filePath: string): Promise<number> {
    try {
      const file = await this.fs.getEntryWithUrl(`file://${filePath}`);
      if (!file) return 0;

      // UXP files may have a size property, or we need to read to get size
      if (typeof file.size === 'number') {
        return file.size;
      }

      // Fallback: read file to determine size
      const buffer = await file.read({ format: 'binary' });
      return buffer.byteLength;
    } catch {
      return 0;
    }
  }

  /**
   * Clean up an exported temp file.
   *
   * @param filePath - Path to the file to delete
   */
  async cleanupExportedFile(filePath: string): Promise<void> {
    try {
      const file = await this.fs.getEntryWithUrl(`file://${filePath}`);

      if (file && typeof file.delete === 'function') {
        await file.delete();
        logger.debug(`Cleaned up temp file: ${filePath}`);
      }
    } catch (error) {
      // Don't throw - cleanup failure is not critical
      logger.warn('Failed to cleanup temp file', { filePath, error });
    }
  }

  /**
   * Sleep helper for polling.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const ameExporter = new AMEExporter();
