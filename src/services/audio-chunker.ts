/**
 * Audio Chunker Utility
 * Splits WAV audio files into smaller chunks for processing by Whisper API
 * which has a 25MB file size limit.
 */

import { logger } from '../lib/logger';
import { SpliceError, SpliceErrorCode } from '../lib/errors';
import { AUDIO_CONFIG } from '../config/audio-config';

export interface AudioChunk {
  buffer: ArrayBuffer;
  startTime: number;
  endTime: number;
  chunkIndex: number;
  totalChunks: number;
}

interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
}

/**
 * Audio Chunker for splitting WAV files into smaller segments.
 * Designed to handle Whisper API's 25MB limit.
 */
export class AudioChunker {
  // Use centralized config
  private readonly CHUNK_DURATION_SECONDS = AUDIO_CONFIG.CHUNK_DURATION_SECONDS;
  private readonly MAX_FILE_SIZE_BYTES = AUDIO_CONFIG.MAX_CHUNK_SIZE_BYTES;

  /**
   * Check if an audio buffer needs chunking.
   *
   * @param buffer - WAV audio buffer
   * @returns True if buffer exceeds 25MB
   */
  needsChunking(buffer: ArrayBuffer): boolean {
    return buffer.byteLength > this.MAX_FILE_SIZE_BYTES;
  }

  /**
   * Parse WAV header to extract audio format information.
   *
   * @param buffer - WAV audio buffer
   * @returns WAV format information
   */
  private parseWavHeader(buffer: ArrayBuffer): WavInfo {
    const view = new DataView(buffer);

    // Verify RIFF header
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );

    if (riff !== 'RIFF') {
      throw new SpliceError(
        SpliceErrorCode.CHUNK_INVALID_WAV,
        'Invalid WAV file: missing RIFF header',
        { foundHeader: riff, expectedHeader: 'RIFF' }
      );
    }

    // Verify WAVE format
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11)
    );

    if (wave !== 'WAVE') {
      throw new SpliceError(
        SpliceErrorCode.CHUNK_INVALID_WAV,
        'Invalid WAV file: missing WAVE format',
        { foundFormat: wave, expectedFormat: 'WAVE' }
      );
    }

    // Parse fmt chunk (usually at offset 12)
    let offset = 12;
    let sampleRate: number | undefined;
    let channels: number | undefined;
    let bitsPerSample: number | undefined;
    let dataOffset = 0;
    let dataSize = 0;
    let foundFmt = false;

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
        foundFmt = true;
        // Audio format (1 = PCM)
        // const audioFormat = view.getUint16(offset + 8, true);
        channels = view.getUint16(offset + 10, true);
        sampleRate = view.getUint32(offset + 12, true);
        // Byte rate at offset + 16
        // Block align at offset + 20
        bitsPerSample = view.getUint16(offset + 22, true);
      } else if (chunkId === 'data') {
        dataOffset = offset + 8;
        dataSize = chunkSize;
        break;
      }

      offset += 8 + chunkSize;
      // Ensure even alignment
      if (chunkSize % 2 !== 0) offset++;
    }

    // Validate fmt chunk was found (#5)
    if (
      !foundFmt ||
      sampleRate === undefined ||
      channels === undefined ||
      bitsPerSample === undefined
    ) {
      throw new SpliceError(
        SpliceErrorCode.CHUNK_MISSING_HEADER,
        'Invalid WAV file: missing or incomplete fmt chunk',
        { foundFmt, sampleRate, channels, bitsPerSample }
      );
    }

    // Validate format values are sensible
    if (sampleRate <= 0 || sampleRate > AUDIO_CONFIG.MAX_SAMPLE_RATE) {
      throw new SpliceError(
        SpliceErrorCode.CHUNK_INVALID_FORMAT,
        `Invalid WAV file: sample rate ${sampleRate} Hz is out of valid range`,
        { sampleRate, maxSampleRate: AUDIO_CONFIG.MAX_SAMPLE_RATE }
      );
    }
    if (channels <= 0 || channels > AUDIO_CONFIG.MAX_CHANNELS) {
      throw new SpliceError(
        SpliceErrorCode.CHUNK_INVALID_FORMAT,
        `Invalid WAV file: channel count ${channels} is out of valid range`,
        { channels, maxChannels: AUDIO_CONFIG.MAX_CHANNELS }
      );
    }
    if (
      bitsPerSample !== 8 &&
      bitsPerSample !== 16 &&
      bitsPerSample !== 24 &&
      bitsPerSample !== 32
    ) {
      throw new SpliceError(
        SpliceErrorCode.CHUNK_INVALID_FORMAT,
        `Invalid WAV file: bits per sample ${bitsPerSample} is not supported`,
        { bitsPerSample, supportedBits: [8, 16, 24, 32] }
      );
    }

    if (dataOffset === 0) {
      throw new SpliceError(
        SpliceErrorCode.CHUNK_MISSING_DATA,
        'Invalid WAV file: missing data chunk'
      );
    }

    return {
      sampleRate,
      channels,
      bitsPerSample,
      dataOffset,
      dataSize,
    };
  }

  /**
   * Create a WAV header for a chunk.
   *
   * @param dataSize - Size of the audio data in bytes
   * @param sampleRate - Sample rate in Hz
   * @param channels - Number of channels
   * @param bitsPerSample - Bits per sample
   * @returns ArrayBuffer containing the WAV header
   */
  private createWavHeader(
    dataSize: number,
    sampleRate: number,
    channels: number,
    bitsPerSample: number
  ): ArrayBuffer {
    const headerSize = 44;
    const buffer = new ArrayBuffer(headerSize);
    const view = new DataView(buffer);

    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;

    // RIFF chunk descriptor
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true); // File size - 8
    this.writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data sub-chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    return buffer;
  }

  /**
   * Write a string to a DataView at the specified offset.
   */
  private writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /**
   * Split a WAV buffer into chunks suitable for Whisper API.
   * Each chunk is ~10 minutes or less.
   *
   * @param buffer - The full WAV audio buffer
   * @param totalDuration - Total duration in seconds
   * @returns Array of audio chunks
   */
  async chunkWavBuffer(buffer: ArrayBuffer, totalDuration: number): Promise<AudioChunk[]> {
    // Always validate WAV header first, regardless of size
    const wavInfo = this.parseWavHeader(buffer);

    if (!this.needsChunking(buffer)) {
      // Return single chunk if under limit
      return [
        {
          buffer,
          startTime: 0,
          endTime: totalDuration,
          chunkIndex: 0,
          totalChunks: 1,
        },
      ];
    }

    logger.info(`Chunking audio: ${buffer.byteLength} bytes, ${totalDuration}s duration`);
    const chunks: AudioChunk[] = [];

    const bytesPerSecond = wavInfo.sampleRate * wavInfo.channels * (wavInfo.bitsPerSample / 8);
    const totalChunks = Math.ceil(totalDuration / this.CHUNK_DURATION_SECONDS);

    logger.info(`Creating ${totalChunks} chunks`, {
      sampleRate: wavInfo.sampleRate,
      channels: wavInfo.channels,
      bitsPerSample: wavInfo.bitsPerSample,
      bytesPerSecond,
    });

    // Calculate block align for sample boundary alignment (#4)
    const bytesPerSample = wavInfo.bitsPerSample / 8;
    const blockAlign = wavInfo.channels * bytesPerSample;

    for (let i = 0; i < totalChunks; i++) {
      const startTime = i * this.CHUNK_DURATION_SECONDS;
      const endTime = Math.min((i + 1) * this.CHUNK_DURATION_SECONDS, totalDuration);
      const chunkDuration = endTime - startTime;

      // Calculate byte offsets within data chunk, aligned to sample boundaries (#4)
      // This prevents splitting audio samples in half, which causes clicks/pops
      const rawStartByte = Math.floor(startTime * bytesPerSecond);
      const rawEndByte = Math.floor(endTime * bytesPerSecond);
      const startByte = Math.floor(rawStartByte / blockAlign) * blockAlign;
      const endByte = Math.floor(rawEndByte / blockAlign) * blockAlign;
      let chunkDataSize = endByte - startByte;

      // Bounds checking (#8) - ensure we don't read past the data chunk
      const maxDataEnd = wavInfo.dataOffset + wavInfo.dataSize;
      const requestedEnd = wavInfo.dataOffset + startByte + chunkDataSize;
      if (requestedEnd > maxDataEnd) {
        const overflow = requestedEnd - maxDataEnd;
        chunkDataSize -= overflow;
        // Re-align to block boundary after adjustment
        chunkDataSize = Math.floor(chunkDataSize / blockAlign) * blockAlign;
        logger.debug(`Adjusted chunk ${i} size to ${chunkDataSize} bytes to fit buffer bounds`);
      }

      if (chunkDataSize <= 0) {
        logger.warn(`Chunk ${i} has no data after bounds adjustment, skipping`);
        continue;
      }

      // Create chunk buffer with header + data
      const header = this.createWavHeader(
        chunkDataSize,
        wavInfo.sampleRate,
        wavInfo.channels,
        wavInfo.bitsPerSample
      );

      const chunkBuffer = new ArrayBuffer(header.byteLength + chunkDataSize);
      const chunkView = new Uint8Array(chunkBuffer);

      // Copy header
      chunkView.set(new Uint8Array(header), 0);

      // Copy audio data with bounds checking (#8)
      const sourceOffset = wavInfo.dataOffset + startByte;
      if (sourceOffset + chunkDataSize > buffer.byteLength) {
        throw new SpliceError(SpliceErrorCode.CHUNK_BOUNDS_ERROR, `Chunk bounds exceed buffer`, {
          sourceOffset,
          chunkDataSize,
          bufferLength: buffer.byteLength,
        });
      }
      const sourceData = new Uint8Array(buffer, sourceOffset, chunkDataSize);
      chunkView.set(sourceData, header.byteLength);

      chunks.push({
        buffer: chunkBuffer,
        startTime,
        endTime,
        chunkIndex: i,
        totalChunks,
      });

      logger.debug(`Created chunk ${i + 1}/${totalChunks}`, {
        startTime,
        endTime,
        duration: chunkDuration,
        size: chunkBuffer.byteLength,
      });
    }

    logger.info(`Audio chunking complete: ${chunks.length} chunks created`);
    return chunks;
  }

  /**
   * Generator version of chunkWavBuffer for memory optimization (#15).
   * Yields chunks one at a time instead of creating all in memory.
   * Use this when processing chunks sequentially to reduce memory pressure.
   *
   * @param buffer - The full WAV audio buffer
   * @param totalDuration - Total duration in seconds
   * @yields Audio chunks one at a time
   */
  async *chunkWavBufferIterator(
    buffer: ArrayBuffer,
    totalDuration: number
  ): AsyncGenerator<AudioChunk> {
    // Always validate WAV header first, regardless of size
    const wavInfo = this.parseWavHeader(buffer);

    if (!this.needsChunking(buffer)) {
      // Yield single chunk if under limit
      yield {
        buffer,
        startTime: 0,
        endTime: totalDuration,
        chunkIndex: 0,
        totalChunks: 1,
      };
      return;
    }

    logger.info(
      `Chunking audio (iterator): ${buffer.byteLength} bytes, ${totalDuration}s duration`
    );
    const bytesPerSecond = wavInfo.sampleRate * wavInfo.channels * (wavInfo.bitsPerSample / 8);
    const totalChunks = Math.ceil(totalDuration / this.CHUNK_DURATION_SECONDS);

    // Calculate block align for sample boundary alignment
    const bytesPerSample = wavInfo.bitsPerSample / 8;
    const blockAlign = wavInfo.channels * bytesPerSample;

    for (let i = 0; i < totalChunks; i++) {
      const startTime = i * this.CHUNK_DURATION_SECONDS;
      const endTime = Math.min((i + 1) * this.CHUNK_DURATION_SECONDS, totalDuration);

      // Calculate byte offsets, aligned to sample boundaries
      const rawStartByte = Math.floor(startTime * bytesPerSecond);
      const rawEndByte = Math.floor(endTime * bytesPerSecond);
      const startByte = Math.floor(rawStartByte / blockAlign) * blockAlign;
      const endByte = Math.floor(rawEndByte / blockAlign) * blockAlign;
      let chunkDataSize = endByte - startByte;

      // Bounds checking
      const maxDataEnd = wavInfo.dataOffset + wavInfo.dataSize;
      const requestedEnd = wavInfo.dataOffset + startByte + chunkDataSize;
      if (requestedEnd > maxDataEnd) {
        const overflow = requestedEnd - maxDataEnd;
        chunkDataSize -= overflow;
        chunkDataSize = Math.floor(chunkDataSize / blockAlign) * blockAlign;
      }

      if (chunkDataSize <= 0) {
        continue;
      }

      // Create chunk buffer with header + data
      const header = this.createWavHeader(
        chunkDataSize,
        wavInfo.sampleRate,
        wavInfo.channels,
        wavInfo.bitsPerSample
      );

      const chunkBuffer = new ArrayBuffer(header.byteLength + chunkDataSize);
      const chunkView = new Uint8Array(chunkBuffer);

      // Copy header
      chunkView.set(new Uint8Array(header), 0);

      // Copy audio data
      const sourceOffset = wavInfo.dataOffset + startByte;
      const sourceData = new Uint8Array(buffer, sourceOffset, chunkDataSize);
      chunkView.set(sourceData, header.byteLength);

      yield {
        buffer: chunkBuffer,
        startTime,
        endTime,
        chunkIndex: i,
        totalChunks,
      };

      logger.debug(`Yielded chunk ${i + 1}/${totalChunks}`);
    }
  }

  /**
   * Merge transcription results from multiple chunks.
   * Adjusts timestamps to be relative to the full audio.
   *
   * @param chunkResults - Array of transcription results from each chunk
   * @param chunks - The audio chunks (for time offset info)
   * @returns Merged transcription with corrected timestamps
   */
  mergeTranscriptionResults<T extends { start: number; end: number }>(
    chunkResults: T[][],
    chunks: AudioChunk[]
  ): T[] {
    const merged: T[] = [];

    for (let i = 0; i < chunkResults.length; i++) {
      const results = chunkResults[i];
      const chunk = chunks[i];
      const timeOffset = chunk.startTime;

      for (const result of results) {
        merged.push({
          ...result,
          start: result.start + timeOffset,
          end: result.end + timeOffset,
        });
      }
    }

    return merged;
  }
}

// Singleton instance
export const audioChunker = new AudioChunker();
