/**
 * Audio Extractor Service
 *
 * Extracts audio from Premiere Pro timelines using multiple strategies:
 * 1. Primary: AME (Adobe Media Encoder) export - most reliable
 * 2. Fallback: Direct source file reading
 *
 * Throws SpliceError if both methods fail (no mock fallback).
 */

import { logger } from '../lib/logger';
import { SpliceError, SpliceErrorCode, isSpliceError } from '../lib/errors';
import { ameExporter, AMEExportResult } from './ame-exporter';
import { audioChunker, AudioChunk } from './audio-chunker';
import { AUDIO_CONFIG, validateTimelineDuration } from '../config/audio-config';

declare const require: (module: string) => any;

interface SourceFileInfo {
  path: string;
  clipStart: number; // Timeline position
  clipEnd: number; // Timeline position
  mediaStart: number; // In-point in source file
  mediaEnd: number; // Out-point in source file
}

export interface AudioExtractionResult {
  buffer: ArrayBuffer;
  duration: number;
  sampleRate: number;
  channels: number;
  sourceFiles: SourceFileInfo[];
  /** Audio chunks if the file exceeded 25MB and was split */
  chunks?: AudioChunk[];
  /** The extraction method that was used */
  extractionMethod: 'ame' | 'source';
}

// AudioExtractionError has been replaced by SpliceError for consistent error handling.
// For backward compatibility, export an alias
export { SpliceError as AudioExtractionError } from '../lib/errors';

/**
 * Extracts audio from Premiere Pro timeline clips.
 *
 * Extraction Strategy:
 * 1. AME Export (preferred) - Uses Adobe Media Encoder to export timeline audio to WAV
 * 2. Source File Reading (fallback) - Reads original source files directly
 *
 * Throws SpliceError if both methods fail.
 */
export class AudioExtractor {
  private app: any = null;
  private project: any = null;
  private fs: any = null;

  constructor() {
    this.initializeAPI();
  }

  private initializeAPI(): void {
    try {
      const ppro = require('premiere');
      this.app = ppro.app;
      this.project = ppro.project;

      const uxp = require('uxp');
      this.fs = uxp.storage.localFileSystem;
    } catch {
      logger.warn('Premiere API not available for AudioExtractor');
    }
  }

  private isAvailable(): boolean {
    return this.app !== null && this.project !== null;
  }

  /**
   * Extract audio from the active sequence.
   *
   * Tries AME export first, then falls back to source file reading.
   * Throws SpliceError if both methods fail.
   */
  async extractFromTimeline(): Promise<AudioExtractionResult> {
    if (!this.isAvailable()) {
      throw new SpliceError(
        SpliceErrorCode.PREMIERE_NOT_AVAILABLE,
        'Premiere Pro API not available',
        { hasApp: !!this.app, hasProject: !!this.project }
      );
    }

    const activeSequence = this.project.activeSequence;
    if (!activeSequence) {
      throw new SpliceError(SpliceErrorCode.AUDIO_NO_SEQUENCE, 'No active sequence found');
    }

    const duration = activeSequence.end?.seconds;
    if (!duration || duration <= 0) {
      throw new SpliceError(
        SpliceErrorCode.AUDIO_INVALID_DURATION,
        `Invalid sequence duration: ${duration}`,
        { duration }
      );
    }

    // Validate timeline duration to prevent excessive processing
    const durationValidation = validateTimelineDuration(duration);
    if (!durationValidation.valid) {
      throw new SpliceError(
        SpliceErrorCode.AUDIO_TIMELINE_TOO_LONG,
        durationValidation.error || 'Timeline too long',
        { duration, maxDuration: AUDIO_CONFIG.MAX_TIMELINE_DURATION_SECONDS }
      );
    }
    if (durationValidation.warning) {
      logger.warn(durationValidation.warning);
    }

    let ameError: SpliceError | undefined;
    let sourceError: string | undefined;

    // Strategy 1: AME Export (preferred)
    if (ameExporter.isAvailable()) {
      logger.info('Attempting AME export for audio extraction...');

      try {
        const exportResult = await ameExporter.exportSequenceAudio(activeSequence, {
          workArea: 'full',
        });

        // AME exporter now throws on failure, so if we get here it succeeded
        return await this.handleSuccessfulExport(exportResult, duration);
      } catch (error) {
        // Capture the error for context if fallback also fails
        if (isSpliceError(error)) {
          ameError = error;
        } else {
          ameError = new SpliceError(
            SpliceErrorCode.AME_EXPORT_FAILED,
            error instanceof Error ? error.message : 'Unknown AME export error',
            undefined,
            error instanceof Error ? error : undefined
          );
        }
        logger.warn('AME export failed, trying fallback...', ameError);
      }
    } else {
      logger.info('AME not available, skipping to fallback extraction');
    }

    // Strategy 2: Source File Reading (fallback)
    logger.info('Attempting source file extraction...');
    try {
      const sourceResult = await this.extractFromSourceFiles(activeSequence);
      if (sourceResult) {
        return sourceResult;
      }
      sourceError = 'No audio clips found on timeline or source files unreadable';
    } catch (error) {
      sourceError = error instanceof Error ? error.message : 'Unknown source extraction error';
    }

    // Both methods failed - throw detailed error
    throw new SpliceError(
      SpliceErrorCode.AUDIO_EXTRACTION_FAILED,
      'Audio extraction failed. Neither AME export nor source file reading succeeded.',
      {
        ameError: ameError?.toLogString(),
        sourceError,
      }
    );
  }

  /**
   * Handle a successful AME export - read the file and optionally chunk it.
   * Uses try-finally to guarantee cleanup even on failure.
   */
  private async handleSuccessfulExport(
    exportResult: AMEExportResult,
    sequenceDuration: number
  ): Promise<AudioExtractionResult> {
    let buffer: ArrayBuffer | undefined;

    try {
      // Read the exported file
      buffer = await this.readExportedFile(exportResult.filePath);
      logger.info(`Successfully read exported audio: ${buffer.byteLength} bytes`);

      // Parse actual audio properties from WAV header (#12)
      const wavInfo = this.parseWavInfo(buffer);
      const actualDuration = wavInfo.duration;

      // Log if duration differs significantly from sequence duration
      if (Math.abs(actualDuration - sequenceDuration) > 1) {
        logger.warn(
          `WAV duration (${actualDuration.toFixed(2)}s) differs from sequence duration (${sequenceDuration.toFixed(2)}s)`
        );
      }

      // Check if chunking is needed (Whisper 25MB limit)
      let chunks: AudioChunk[] | undefined;
      if (audioChunker.needsChunking(buffer)) {
        logger.info('Audio exceeds 25MB, chunking for Whisper API...');
        chunks = await audioChunker.chunkWavBuffer(buffer, actualDuration);
      }

      return {
        buffer,
        duration: actualDuration,
        sampleRate: wavInfo.sampleRate,
        channels: wavInfo.channels,
        sourceFiles: [],
        chunks,
        extractionMethod: 'ame',
      };
    } catch (error) {
      // If we fail to read the exported file, let the caller handle fallback
      logger.error('Failed to read exported file', error);
      throw error;
    } finally {
      // Always clean up the temp file, even on error
      await ameExporter.cleanupExportedFile(exportResult.filePath);
    }
  }

  /**
   * Parse WAV header to extract audio information including duration (#12).
   */
  private parseWavInfo(buffer: ArrayBuffer): {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    duration: number;
  } {
    const view = new DataView(buffer);

    // Verify RIFF header
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );
    if (riff !== 'RIFF') {
      logger.warn('Not a valid WAV file, using defaults');
      return {
        sampleRate: AUDIO_CONFIG.DEFAULT_SAMPLE_RATE,
        channels: AUDIO_CONFIG.DEFAULT_CHANNELS,
        bitsPerSample: AUDIO_CONFIG.DEFAULT_BITS_PER_SAMPLE,
        duration: 0,
      };
    }

    let offset = 12;
    let sampleRate: number = AUDIO_CONFIG.DEFAULT_SAMPLE_RATE;
    let channels: number = AUDIO_CONFIG.DEFAULT_CHANNELS;
    let bitsPerSample: number = AUDIO_CONFIG.DEFAULT_BITS_PER_SAMPLE;
    let dataSize = 0;

    // Find fmt and data chunks
    while (offset < buffer.byteLength - 8) {
      const chunkId = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
      );
      const chunkSize = view.getUint32(offset + 4, true);

      if (chunkId === 'fmt ') {
        channels = view.getUint16(offset + 10, true);
        sampleRate = view.getUint32(offset + 12, true);
        bitsPerSample = view.getUint16(offset + 22, true);
      } else if (chunkId === 'data') {
        dataSize = chunkSize;
        break;
      }

      offset += 8 + chunkSize;
      if (chunkSize % 2 !== 0) offset++;
    }

    // Calculate duration from data size
    const bytesPerSample = bitsPerSample / 8;
    const bytesPerSecond = sampleRate * channels * bytesPerSample;
    const duration = bytesPerSecond > 0 ? dataSize / bytesPerSecond : 0;

    return { sampleRate, channels, bitsPerSample, duration };
  }

  /**
   * Read an exported audio file from disk.
   */
  private async readExportedFile(filePath: string): Promise<ArrayBuffer> {
    if (!this.fs) {
      throw new SpliceError(
        SpliceErrorCode.AUDIO_FILE_READ_FAILED,
        'UXP file system not available'
      );
    }

    const file = await this.fs.getEntryWithUrl(`file://${filePath}`);
    if (!file) {
      throw new SpliceError(
        SpliceErrorCode.AUDIO_FILE_READ_FAILED,
        `Exported file not found: ${filePath}`,
        { filePath }
      );
    }

    const buffer = await file.read({ format: 'binary' });
    return buffer;
  }

  /**
   * Attempt to extract audio by reading source files directly.
   * This is the fallback when AME export is not available.
   */
  private async extractFromSourceFiles(activeSequence: any): Promise<AudioExtractionResult | null> {
    try {
      const audioTracks = activeSequence.audioTracks;
      const sourceFiles: SourceFileInfo[] = [];

      // Collect all audio clips and their source files
      for (let i = 0; i < audioTracks.numTracks; i++) {
        const track = audioTracks[i];
        if (track.isMuted && track.isMuted()) continue;

        for (let j = 0; j < track.clips.numItems; j++) {
          const clip = track.clips[j];
          const projectItem = clip.projectItem;

          // Get the media file path
          let mediaPath = '';
          if (projectItem && typeof projectItem.getMediaPath === 'function') {
            mediaPath = projectItem.getMediaPath();
          } else if (projectItem && projectItem.treePath) {
            mediaPath = projectItem.treePath;
          }

          if (mediaPath) {
            sourceFiles.push({
              path: mediaPath,
              clipStart: clip.start.seconds,
              clipEnd: clip.end.seconds,
              mediaStart: clip.inPoint?.seconds ?? 0,
              mediaEnd: clip.outPoint?.seconds ?? clip.end.seconds - clip.start.seconds,
            });
          }
        }
      }

      if (sourceFiles.length === 0) {
        logger.warn('No audio clips found on timeline');
        return null;
      }

      // Sort by timeline position
      sourceFiles.sort((a, b) => a.clipStart - b.clipStart);

      // Warn about multi-clip limitation (#13)
      if (sourceFiles.length > 1) {
        logger.warn(
          `Source file extraction found ${sourceFiles.length} audio clips, but only the first will be used. ` +
            `For multi-clip sequences, use AME export for accurate results.`
        );
      }

      // Try to read the first source file
      const firstFile = sourceFiles[0];
      logger.info(`Attempting to read source audio from: ${firstFile.path}`);

      try {
        const buffer = await this.readAudioFile(firstFile.path);
        const duration = activeSequence.end.seconds;

        // Check if chunking is needed
        let chunks: AudioChunk[] | undefined;
        if (audioChunker.needsChunking(buffer)) {
          logger.info('Audio exceeds 25MB, chunking for Whisper API...');
          chunks = await audioChunker.chunkWavBuffer(buffer, duration);
        }

        return {
          buffer,
          duration,
          sampleRate: AUDIO_CONFIG.DEFAULT_SAMPLE_RATE,
          channels: AUDIO_CONFIG.DEFAULT_CHANNELS,
          sourceFiles,
          chunks,
          extractionMethod: 'source',
        };
      } catch (readError) {
        logger.warn('Could not read source file', readError);
        return null;
      }
    } catch (error) {
      logger.error('Source file extraction failed', error);
      return null;
    }
  }

  /**
   * Read an audio file using UXP file system APIs.
   */
  private async readAudioFile(filePath: string): Promise<ArrayBuffer> {
    if (!this.fs) {
      throw new SpliceError(
        SpliceErrorCode.AUDIO_FILE_READ_FAILED,
        'UXP file system not available'
      );
    }

    const file = await this.fs.getEntryWithUrl(`file://${filePath}`);

    if (!file) {
      throw new SpliceError(
        SpliceErrorCode.AUDIO_FILE_READ_FAILED,
        `Source file not found: ${filePath}`,
        { filePath }
      );
    }

    const buffer = await file.read({ format: 'binary' });
    logger.info(`Read ${buffer.byteLength} bytes from ${filePath}`);

    return buffer;
  }
}

// Singleton instance
export const audioExtractor = new AudioExtractor();
