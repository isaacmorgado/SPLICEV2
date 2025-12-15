/**
 * WAV File Builder for Testing
 *
 * Utility for creating valid and invalid WAV files for testing audio processing code.
 * Generates WAV buffers with configurable parameters.
 */

/**
 * Builder class for creating WAV audio buffers.
 */
export class WavBuilder {
  private sampleRate: number;
  private channels: number;
  private bitsPerSample: number;
  private samples: number[] = [];

  constructor(sampleRate = 48000, channels = 2, bitsPerSample = 16) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.bitsPerSample = bitsPerSample;
  }

  /**
   * Add silence for a given duration.
   */
  addSilence(durationSeconds: number): this {
    const numSamples = Math.floor(durationSeconds * this.sampleRate * this.channels);
    for (let i = 0; i < numSamples; i++) {
      this.samples.push(0);
    }
    return this;
  }

  /**
   * Add a sine wave tone.
   */
  addTone(frequency: number, durationSeconds: number, amplitude = 0.5): this {
    const numSamples = Math.floor(durationSeconds * this.sampleRate);
    for (let i = 0; i < numSamples; i++) {
      const value = amplitude * Math.sin((2 * Math.PI * frequency * i) / this.sampleRate);
      // Add to all channels
      for (let ch = 0; ch < this.channels; ch++) {
        this.samples.push(value);
      }
    }
    return this;
  }

  /**
   * Add white noise.
   */
  addNoise(durationSeconds: number, amplitude = 0.3): this {
    const numSamples = Math.floor(durationSeconds * this.sampleRate * this.channels);
    for (let i = 0; i < numSamples; i++) {
      this.samples.push((Math.random() * 2 - 1) * amplitude);
    }
    return this;
  }

  /**
   * Get the duration of the current audio in seconds.
   */
  getDuration(): number {
    return this.samples.length / (this.sampleRate * this.channels);
  }

  /**
   * Build the WAV file as an ArrayBuffer.
   */
  build(): ArrayBuffer {
    const bytesPerSample = this.bitsPerSample / 8;
    const dataSize = this.samples.length * bytesPerSample;
    const headerSize = 44;
    const buffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true); // File size - 8
    writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
    view.setUint16(22, this.channels, true);
    view.setUint32(24, this.sampleRate, true);
    view.setUint32(28, this.sampleRate * this.channels * bytesPerSample, true); // ByteRate
    view.setUint16(32, this.channels * bytesPerSample, true); // BlockAlign
    view.setUint16(34, this.bitsPerSample, true);

    // data sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write samples
    const maxValue = Math.pow(2, this.bitsPerSample - 1) - 1;
    let offset = 44;

    for (const sample of this.samples) {
      const intValue = Math.round(Math.max(-1, Math.min(1, sample)) * maxValue);

      if (this.bitsPerSample === 16) {
        view.setInt16(offset, intValue, true);
        offset += 2;
      } else if (this.bitsPerSample === 8) {
        // 8-bit WAV is unsigned
        view.setUint8(offset, intValue + 128);
        offset += 1;
      } else if (this.bitsPerSample === 24) {
        // 24-bit little-endian
        view.setUint8(offset, intValue & 0xff);
        view.setUint8(offset + 1, (intValue >> 8) & 0xff);
        view.setUint8(offset + 2, (intValue >> 16) & 0xff);
        offset += 3;
      } else if (this.bitsPerSample === 32) {
        view.setInt32(offset, intValue, true);
        offset += 4;
      }
    }

    return buffer;
  }

  /**
   * Reset the builder for reuse.
   */
  reset(): this {
    this.samples = [];
    return this;
  }
}

/**
 * Types of invalid WAV files for testing error handling.
 */
export type InvalidWavType =
  | 'no-riff'
  | 'no-wave'
  | 'no-fmt'
  | 'no-data'
  | 'truncated'
  | 'invalid-sample-rate'
  | 'invalid-channels'
  | 'invalid-bits';

/**
 * Create an invalid WAV buffer for testing error handling.
 */
export function createInvalidWav(type: InvalidWavType): ArrayBuffer {
  const buffer = new ArrayBuffer(type === 'truncated' ? 20 : 44);
  const view = new DataView(buffer);

  switch (type) {
    case 'no-riff':
      // Write garbage instead of RIFF
      writeString(view, 0, 'XXXX');
      view.setUint32(4, 36, true);
      writeString(view, 8, 'WAVE');
      break;

    case 'no-wave':
      writeString(view, 0, 'RIFF');
      view.setUint32(4, 36, true);
      writeString(view, 8, 'XXXX'); // Not WAVE
      break;

    case 'no-fmt':
      writeString(view, 0, 'RIFF');
      view.setUint32(4, 36, true);
      writeString(view, 8, 'WAVE');
      // Skip fmt chunk, go directly to data
      writeString(view, 12, 'data');
      view.setUint32(16, 0, true);
      break;

    case 'no-data':
      writeString(view, 0, 'RIFF');
      view.setUint32(4, 36, true);
      writeString(view, 8, 'WAVE');
      writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 2, true);
      view.setUint32(24, 48000, true);
      view.setUint32(28, 192000, true);
      view.setUint16(32, 4, true);
      view.setUint16(34, 16, true);
      // No data chunk
      break;

    case 'truncated':
      // Only partial header
      writeString(view, 0, 'RIFF');
      view.setUint32(4, 1000, true); // Claims more data than exists
      writeString(view, 8, 'WAVE');
      break;

    case 'invalid-sample-rate':
      writeString(view, 0, 'RIFF');
      view.setUint32(4, 36, true);
      writeString(view, 8, 'WAVE');
      writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 2, true);
      view.setUint32(24, 999999999, true); // Invalid sample rate
      view.setUint32(28, 192000, true);
      view.setUint16(32, 4, true);
      view.setUint16(34, 16, true);
      writeString(view, 36, 'data');
      view.setUint32(40, 0, true);
      break;

    case 'invalid-channels':
      writeString(view, 0, 'RIFF');
      view.setUint32(4, 36, true);
      writeString(view, 8, 'WAVE');
      writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 99, true); // Too many channels
      view.setUint32(24, 48000, true);
      view.setUint32(28, 192000, true);
      view.setUint16(32, 4, true);
      view.setUint16(34, 16, true);
      writeString(view, 36, 'data');
      view.setUint32(40, 0, true);
      break;

    case 'invalid-bits':
      writeString(view, 0, 'RIFF');
      view.setUint32(4, 36, true);
      writeString(view, 8, 'WAVE');
      writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 2, true);
      view.setUint32(24, 48000, true);
      view.setUint32(28, 192000, true);
      view.setUint16(32, 4, true);
      view.setUint16(34, 13, true); // Invalid bits per sample
      writeString(view, 36, 'data');
      view.setUint32(40, 0, true);
      break;
  }

  return buffer;
}

/**
 * Create a valid but minimal WAV file (just header, no audio data).
 */
export function createEmptyWav(sampleRate = 48000, channels = 2, bitsPerSample = 16): ArrayBuffer {
  return new WavBuilder(sampleRate, channels, bitsPerSample).build();
}

/**
 * Create a WAV file of a specific size (for testing chunking).
 */
export function createWavOfSize(targetSizeBytes: number): ArrayBuffer {
  const headerSize = 44;
  const dataSize = targetSizeBytes - headerSize;
  const bytesPerSample = 2; // 16-bit
  const numSamples = Math.floor(dataSize / bytesPerSample);

  const builder = new WavBuilder(48000, 1, 16);

  // Add samples to reach target size
  const durationNeeded = numSamples / 48000;
  builder.addSilence(durationNeeded);

  return builder.build();
}

/**
 * Helper to write a string to a DataView.
 */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
