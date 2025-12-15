import { describe, it, expect, beforeEach } from 'vitest';
import { AudioChunker, audioChunker } from '../../src/services/audio-chunker';
import { SpliceErrorCode } from '../../src/lib/errors';
import { WavBuilder, createInvalidWav } from '../utils/wav-builder';
import { AUDIO_CONFIG } from '../../src/config/audio-config';

describe('AudioChunker', () => {
  let chunker: AudioChunker;

  beforeEach(() => {
    chunker = new AudioChunker();
  });

  describe('needsChunking', () => {
    it('returns false for small buffers', () => {
      const smallBuffer = new ArrayBuffer(1024 * 1024); // 1MB

      expect(chunker.needsChunking(smallBuffer)).toBe(false);
    });

    it('returns true for buffers over 25MB', () => {
      const largeBuffer = new ArrayBuffer(26 * 1024 * 1024); // 26MB

      expect(chunker.needsChunking(largeBuffer)).toBe(true);
    });

    it('returns false for buffer exactly at limit', () => {
      const limitBuffer = new ArrayBuffer(AUDIO_CONFIG.MAX_CHUNK_SIZE_BYTES);

      expect(chunker.needsChunking(limitBuffer)).toBe(false);
    });

    it('returns true for buffer just over limit', () => {
      const overLimitBuffer = new ArrayBuffer(AUDIO_CONFIG.MAX_CHUNK_SIZE_BYTES + 1);

      expect(chunker.needsChunking(overLimitBuffer)).toBe(true);
    });
  });

  describe('chunkWavBuffer - error handling', () => {
    it('throws CHUNK_INVALID_WAV for missing RIFF header', async () => {
      const invalidWav = createInvalidWav('no-riff');

      await expect(chunker.chunkWavBuffer(invalidWav, 1)).rejects.toThrow();

      try {
        await chunker.chunkWavBuffer(invalidWav, 1);
      } catch (error: any) {
        expect(error.code).toBe(SpliceErrorCode.CHUNK_INVALID_WAV);
        expect(error.context?.foundHeader).toBe('XXXX');
      }
    });

    it('throws CHUNK_INVALID_WAV for missing WAVE format', async () => {
      const invalidWav = createInvalidWav('no-wave');

      await expect(chunker.chunkWavBuffer(invalidWav, 1)).rejects.toThrow();

      try {
        await chunker.chunkWavBuffer(invalidWav, 1);
      } catch (error: any) {
        expect(error.code).toBe(SpliceErrorCode.CHUNK_INVALID_WAV);
      }
    });

    it('throws CHUNK_MISSING_HEADER for missing fmt chunk', async () => {
      const invalidWav = createInvalidWav('no-fmt');

      await expect(chunker.chunkWavBuffer(invalidWav, 1)).rejects.toThrow();

      try {
        await chunker.chunkWavBuffer(invalidWav, 1);
      } catch (error: any) {
        expect(error.code).toBe(SpliceErrorCode.CHUNK_MISSING_HEADER);
      }
    });

    it('throws CHUNK_MISSING_DATA for missing data chunk', async () => {
      const invalidWav = createInvalidWav('no-data');

      await expect(chunker.chunkWavBuffer(invalidWav, 1)).rejects.toThrow();

      try {
        await chunker.chunkWavBuffer(invalidWav, 1);
      } catch (error: any) {
        expect(error.code).toBe(SpliceErrorCode.CHUNK_MISSING_DATA);
      }
    });

    it('throws CHUNK_INVALID_FORMAT for invalid sample rate', async () => {
      const invalidWav = createInvalidWav('invalid-sample-rate');

      await expect(chunker.chunkWavBuffer(invalidWav, 1)).rejects.toThrow();

      try {
        await chunker.chunkWavBuffer(invalidWav, 1);
      } catch (error: any) {
        expect(error.code).toBe(SpliceErrorCode.CHUNK_INVALID_FORMAT);
      }
    });

    it('throws CHUNK_INVALID_FORMAT for invalid channel count', async () => {
      const invalidWav = createInvalidWav('invalid-channels');

      await expect(chunker.chunkWavBuffer(invalidWav, 1)).rejects.toThrow();

      try {
        await chunker.chunkWavBuffer(invalidWav, 1);
      } catch (error: any) {
        expect(error.code).toBe(SpliceErrorCode.CHUNK_INVALID_FORMAT);
      }
    });

    it('throws CHUNK_INVALID_FORMAT for invalid bits per sample', async () => {
      const invalidWav = createInvalidWav('invalid-bits');

      await expect(chunker.chunkWavBuffer(invalidWav, 1)).rejects.toThrow();

      try {
        await chunker.chunkWavBuffer(invalidWav, 1);
      } catch (error: any) {
        expect(error.code).toBe(SpliceErrorCode.CHUNK_INVALID_FORMAT);
      }
    });
  });

  describe('chunkWavBuffer - valid files', () => {
    it('returns single chunk for small files', async () => {
      const wav = new WavBuilder(48000, 2, 16).addTone(440, 5).build(); // 5 seconds

      const chunks = await chunker.chunkWavBuffer(wav, 5);

      expect(chunks.length).toBe(1);
      expect(chunks[0].startTime).toBe(0);
      expect(chunks[0].endTime).toBe(5);
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].totalChunks).toBe(1);
    });

    it('preserves WAV header in single chunk', async () => {
      const wav = new WavBuilder(48000, 2, 16).addTone(440, 2).build();

      const chunks = await chunker.chunkWavBuffer(wav, 2);
      const chunkView = new DataView(chunks[0].buffer);

      // Verify RIFF header
      const riff = String.fromCharCode(
        chunkView.getUint8(0),
        chunkView.getUint8(1),
        chunkView.getUint8(2),
        chunkView.getUint8(3)
      );
      expect(riff).toBe('RIFF');

      // Verify WAVE format
      const wave = String.fromCharCode(
        chunkView.getUint8(8),
        chunkView.getUint8(9),
        chunkView.getUint8(10),
        chunkView.getUint8(11)
      );
      expect(wave).toBe('WAVE');
    });

    it('handles different sample rates', async () => {
      const wav44k = new WavBuilder(44100, 2, 16).addTone(440, 1).build();
      const wav48k = new WavBuilder(48000, 2, 16).addTone(440, 1).build();
      const wav96k = new WavBuilder(96000, 2, 16).addTone(440, 1).build();

      const chunks44k = await chunker.chunkWavBuffer(wav44k, 1);
      const chunks48k = await chunker.chunkWavBuffer(wav48k, 1);
      const chunks96k = await chunker.chunkWavBuffer(wav96k, 1);

      expect(chunks44k.length).toBe(1);
      expect(chunks48k.length).toBe(1);
      expect(chunks96k.length).toBe(1);
    });

    it('handles mono audio', async () => {
      const monoWav = new WavBuilder(48000, 1, 16).addTone(440, 2).build();

      const chunks = await chunker.chunkWavBuffer(monoWav, 2);

      expect(chunks.length).toBe(1);
    });

    it('handles different bit depths', async () => {
      const wav8bit = new WavBuilder(48000, 2, 8).addTone(440, 1).build();
      const wav16bit = new WavBuilder(48000, 2, 16).addTone(440, 1).build();
      const wav24bit = new WavBuilder(48000, 2, 24).addTone(440, 1).build();

      const chunks8 = await chunker.chunkWavBuffer(wav8bit, 1);
      const chunks16 = await chunker.chunkWavBuffer(wav16bit, 1);
      const chunks24 = await chunker.chunkWavBuffer(wav24bit, 1);

      expect(chunks8.length).toBe(1);
      expect(chunks16.length).toBe(1);
      expect(chunks24.length).toBe(1);
    });
  });

  describe('mergeTranscriptionResults', () => {
    it('adjusts timestamps based on chunk offsets', () => {
      const chunkResults = [
        [
          { start: 0, end: 5, text: 'hello' },
          { start: 5, end: 10, text: 'world' },
        ],
        [
          { start: 0, end: 5, text: 'foo' },
          { start: 5, end: 10, text: 'bar' },
        ],
      ];
      const chunks = [
        { buffer: new ArrayBuffer(0), startTime: 0, endTime: 600, chunkIndex: 0, totalChunks: 2 },
        {
          buffer: new ArrayBuffer(0),
          startTime: 600,
          endTime: 1200,
          chunkIndex: 1,
          totalChunks: 2,
        },
      ];

      const merged = chunker.mergeTranscriptionResults(chunkResults, chunks);

      // First chunk - no offset
      expect(merged[0].start).toBe(0);
      expect(merged[0].end).toBe(5);
      expect(merged[1].start).toBe(5);
      expect(merged[1].end).toBe(10);

      // Second chunk - offset by 600
      expect(merged[2].start).toBe(600);
      expect(merged[2].end).toBe(605);
      expect(merged[3].start).toBe(605);
      expect(merged[3].end).toBe(610);
    });

    it('handles empty chunk results', () => {
      const chunkResults: Array<Array<{ start: number; end: number; text: string }>> = [[], []];
      const chunks = [
        { buffer: new ArrayBuffer(0), startTime: 0, endTime: 600, chunkIndex: 0, totalChunks: 2 },
        {
          buffer: new ArrayBuffer(0),
          startTime: 600,
          endTime: 1200,
          chunkIndex: 1,
          totalChunks: 2,
        },
      ];

      const merged = chunker.mergeTranscriptionResults(chunkResults, chunks);

      expect(merged.length).toBe(0);
    });

    it('preserves additional properties in results', () => {
      const chunkResults = [[{ start: 0, end: 5, text: 'hello', confidence: 0.95, speaker: 'A' }]];
      const chunks = [
        { buffer: new ArrayBuffer(0), startTime: 100, endTime: 700, chunkIndex: 0, totalChunks: 1 },
      ];

      const merged = chunker.mergeTranscriptionResults(chunkResults, chunks);

      expect(merged[0].start).toBe(100);
      expect(merged[0].end).toBe(105);
      expect((merged[0] as any).confidence).toBe(0.95);
      expect((merged[0] as any).speaker).toBe('A');
    });
  });

  describe('singleton instance', () => {
    it('exports a singleton', () => {
      expect(audioChunker).toBeInstanceOf(AudioChunker);
    });
  });
});
