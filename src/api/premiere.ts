import { logger } from '../lib/logger';
import { audioExtractor } from '../services/audio-extractor';
import { silenceDetector, SilentSection } from '../services/silence-detector';

// UXP Premiere Pro API types
declare const require: (module: string) => any;

interface TimelineAnalysis {
  clipCount: number;
  duration: number;
  tracks: number;
}

interface AutoCutResult {
  cutsApplied: number;
  silentSections: number;
  timeRemoved: number;
}

interface ExtractedAudio {
  buffer: ArrayBuffer;
  duration: number;
  sampleRate: number;
  channels: number;
}

interface MarkerInfo {
  name: string;
  time: number;
  color?: string;
  comments?: string;
}

interface TrackInfo {
  name: string;
  index: number;
  type: 'video' | 'audio';
}

interface AutoCutOptions {
  thresholdDb?: number;
  useVoiceIsolation?: boolean;
  useAIAnalysis?: boolean;
}

/**
 * Result of applying silence cuts to the timeline.
 * Supports partial success - some cuts may fail while others succeed.
 */
export interface ApplySilenceCutsResult {
  cutsApplied: number;
  cutsAttempted: number;
  timeRemoved: number;
  errors: string[];
}

/**
 * Premiere Pro automation API wrapper
 * Provides high-level methods for common automation tasks
 */
export class PremiereAPI {
  private app: any;
  private project: any;

  /** Stores detected silent sections between detection and application */
  public pendingSilentSections: SilentSection[] = [];

  /** Stores detected takes between detection and application */
  public pendingTakes: NormalizedTake[] = [];

  /** Color rotation for takes: Green (1), Yellow (3), Orange (5), Purple (9), Blue (7), Cyan (11) */
  public static readonly TAKE_COLOR_ROTATION = [1, 3, 5, 9, 7, 11];

  constructor() {
    this.initializeAPI();
  }

  private initializeAPI(): void {
    try {
      // UXP provides Premiere Pro APIs through require
      const ppro = require('premiere');
      this.app = ppro.app;
      this.project = ppro.project;
      logger.info('Premiere Pro API initialized');
    } catch {
      // In development/testing environment, APIs may not be available
      logger.warn('Premiere Pro API not available (development mode)');
      this.app = null;
      this.project = null;
    }
  }

  /**
   * Check if running inside Premiere Pro
   */
  isAvailable(): boolean {
    return this.app !== null && this.project !== null;
  }

  /**
   * Analyze the active timeline
   */
  async analyzeTimeline(): Promise<TimelineAnalysis> {
    if (!this.isAvailable()) {
      logger.info('Running in mock mode');
      return this.mockAnalyzeTimeline();
    }

    try {
      const activeSequence = this.project.activeSequence;
      if (!activeSequence) {
        throw new Error('No active sequence');
      }

      const videoTracks = activeSequence.videoTracks;
      const audioTracks = activeSequence.audioTracks;
      let clipCount = 0;

      // Count video clips
      for (let i = 0; i < videoTracks.numTracks; i++) {
        const track = videoTracks[i];
        clipCount += track.clips.numItems;
      }

      // Count audio clips
      for (let i = 0; i < audioTracks.numTracks; i++) {
        const track = audioTracks[i];
        clipCount += track.clips.numItems;
      }

      return {
        clipCount,
        duration: activeSequence.end.seconds,
        tracks: videoTracks.numTracks + audioTracks.numTracks,
      };
    } catch (error) {
      logger.error('Failed to analyze timeline', error);
      throw error;
    }
  }

  /**
   * Auto-cut silence from audio tracks.
   * Detects silence using transcription + AI analysis, stores results for later application.
   */
  async autoCutSilence(
    thresholdDb: number = -40,
    options: Partial<AutoCutOptions> = {}
  ): Promise<AutoCutResult> {
    const { useVoiceIsolation = false, useAIAnalysis = true } = options;

    if (!this.isAvailable()) {
      logger.info('Running in mock mode - using mock detection');
      // In mock mode, generate some realistic mock data
      const mockDuration = 180; // 3 minutes
      this.pendingSilentSections = silenceDetector.createMockDetection(mockDuration);
      const timeRemoved = this.pendingSilentSections.reduce((sum, s) => sum + s.duration, 0);

      return {
        cutsApplied: 0,
        silentSections: this.pendingSilentSections.length,
        timeRemoved,
      };
    }

    try {
      const activeSequence = this.project.activeSequence;
      if (!activeSequence) {
        throw new Error('No active sequence');
      }

      logger.info(
        `Detecting silence (threshold: ${thresholdDb}dB, voice isolation: ${useVoiceIsolation})`
      );

      // Step 1: Extract audio from timeline
      const audio = await audioExtractor.extractFromTimeline();
      logger.info(`Extracted ${audio.duration}s of audio`);

      // Step 2: Detect silence using transcription + AI
      const sections = await silenceDetector.detectSilence({
        audioBuffer: audio.buffer,
        thresholdDb,
        useVoiceIsolation,
        useAIAnalysis,
      });

      // Store for later application
      this.pendingSilentSections = sections;

      const timeRemoved = sections.reduce((sum, s) => sum + s.duration, 0);
      logger.info(`Found ${sections.length} cuttable sections, ${timeRemoved.toFixed(1)}s total`);

      return {
        cutsApplied: 0, // Not applied yet
        silentSections: sections.length,
        timeRemoved,
      };
    } catch (error) {
      logger.error('Failed to detect silence', error);
      throw error;
    }
  }

  /**
   * Get project metadata
   */
  async getProjectInfo(): Promise<{ name: string; path: string }> {
    if (!this.isAvailable()) {
      return { name: 'Mock Project', path: '/mock/path' };
    }

    return {
      name: this.project.name,
      path: this.project.path,
    };
  }

  // ============================================
  // Timeline Manipulation Methods
  // ============================================

  /**
   * Extract audio from the active sequence
   * @param trackIndex - Optional specific audio track to extract (all audio tracks if not specified)
   */
  async extractAudio(trackIndex?: number): Promise<ExtractedAudio> {
    if (!this.isAvailable()) {
      logger.info('Running in mock mode');
      return this.mockExtractAudio();
    }

    try {
      const activeSequence = this.project.activeSequence;
      if (!activeSequence) {
        throw new Error('No active sequence');
      }

      // Get sequence duration for audio extraction
      const duration = activeSequence.end.seconds;

      // In Premiere UXP, we need to export audio to a temp file then read it
      // For now, this is a placeholder that would use AME (Adobe Media Encoder)
      // or the sequence's audio rendering capabilities
      logger.info(
        `Extracting audio from sequence (track: ${trackIndex ?? 'all'}, duration: ${duration}s)`
      );

      // TODO: Implement actual audio extraction using Premiere's export APIs
      // This would involve:
      // 1. Create an export preset for audio-only (WAV)
      // 2. Export to temp location
      // 3. Read the file using UXP storage APIs
      // 4. Return the buffer

      // For now, return mock data in real mode too until export is implemented
      logger.warn('Audio extraction not fully implemented - returning mock data');
      return this.mockExtractAudio();
    } catch (error) {
      logger.error('Failed to extract audio', error);
      throw error;
    }
  }

  /**
   * Add a marker to the active sequence at the specified time
   * @param time - Time in seconds where to place the marker
   * @param name - Marker name/label
   * @param color - Optional marker color (e.g., 'red', 'green', 'blue')
   * @param comments - Optional comments for the marker
   */
  async addMarker(
    time: number,
    name: string,
    color?: string,
    comments?: string
  ): Promise<MarkerInfo> {
    if (!this.isAvailable()) {
      logger.info('Running in mock mode');
      return this.mockAddMarker(time, name, color, comments);
    }

    try {
      const activeSequence = this.project.activeSequence;
      if (!activeSequence) {
        throw new Error('No active sequence');
      }

      // Access the markers collection
      const markers = activeSequence.markers;

      // Create a new marker at the specified time
      // Note: Premiere UXP marker API may vary - this is based on documented patterns
      const marker = markers.createMarker(time);
      if (marker) {
        marker.name = name;
        if (comments) {
          marker.comments = comments;
        }
        // Color setting depends on available API
        // marker.setColorByIndex() or similar may be available
      }

      logger.info(`Added marker "${name}" at ${time}s`);

      return {
        name,
        time,
        color,
        comments,
      };
    } catch (error) {
      logger.error('Failed to add marker', error);
      throw error;
    }
  }

  /**
   * Cut clips at a specific time (razor tool functionality)
   * @param time - Time in seconds where to make the cut
   * @param trackIndex - Optional specific track to cut (all tracks if not specified)
   */
  async razorAtTime(time: number, trackIndex?: number): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.info('Running in mock mode');
      return this.mockRazorAtTime();
    }

    try {
      const activeSequence = this.project.activeSequence;
      if (!activeSequence) {
        throw new Error('No active sequence');
      }

      let cutsMade = 0;

      // Get both video and audio tracks
      const videoTracks = activeSequence.videoTracks;
      const audioTracks = activeSequence.audioTracks;

      // Helper to cut clips on a track collection
      const cutOnTracks = (tracks: any, startIdx?: number, endIdx?: number) => {
        const start = startIdx ?? 0;
        const end = endIdx ?? tracks.numTracks;

        for (let i = start; i < end; i++) {
          const track = tracks[i];
          if (!track || track.isMuted()) continue;

          // Find clips at the specified time
          for (let j = 0; j < track.clips.numItems; j++) {
            const clip = track.clips[j];
            const clipStart = clip.start.seconds;
            const clipEnd = clip.end.seconds;

            // Check if time falls within this clip
            if (time > clipStart && time < clipEnd) {
              // Split the clip at this time
              // Note: The actual API method may be clip.split() or similar
              if (typeof clip.split === 'function') {
                clip.split(time);
                cutsMade++;
              }
            }
          }
        }
      };

      if (trackIndex !== undefined) {
        // Cut on specific track only
        // Determine if it's video or audio based on index
        const totalVideoTracks = videoTracks.numTracks;
        if (trackIndex < totalVideoTracks) {
          cutOnTracks(videoTracks, trackIndex, trackIndex + 1);
        } else {
          const audioIndex = trackIndex - totalVideoTracks;
          cutOnTracks(audioTracks, audioIndex, audioIndex + 1);
        }
      } else {
        // Cut on all tracks
        cutOnTracks(videoTracks);
        cutOnTracks(audioTracks);
      }

      logger.info(`Made ${cutsMade} cuts at ${time}s`);
      return cutsMade > 0;
    } catch (error) {
      logger.error('Failed to razor at time', error);
      throw error;
    }
  }

  /**
   * Create a new video track (for captions/text overlays)
   * @param name - Optional name for the track
   */
  async createTextTrack(name?: string): Promise<TrackInfo> {
    if (!this.isAvailable()) {
      logger.info('Running in mock mode');
      return this.mockCreateTextTrack(name);
    }

    try {
      const activeSequence = this.project.activeSequence;
      if (!activeSequence) {
        throw new Error('No active sequence');
      }

      // Get current video track count
      const videoTracks = activeSequence.videoTracks;
      const currentTrackCount = videoTracks.numTracks;

      // Add a new video track at the top
      // Note: The API may be sequence.addVideoTrack() or similar
      // This creates a track that can hold text/graphics
      const trackName = name || `Text Track ${currentTrackCount + 1}`;

      // Premiere UXP should provide a method to add tracks
      // The exact API call depends on the version
      if (typeof activeSequence.addVideoTrack === 'function') {
        activeSequence.addVideoTrack();
      }

      const newTrackIndex = videoTracks.numTracks - 1;
      const newTrack = videoTracks[newTrackIndex];

      if (newTrack && typeof newTrack.name !== 'undefined') {
        newTrack.name = trackName;
      }

      logger.info(`Created text track "${trackName}" at index ${newTrackIndex}`);

      return {
        name: trackName,
        index: newTrackIndex,
        type: 'video',
      };
    } catch (error) {
      logger.error('Failed to create text track', error);
      throw error;
    }
  }

  /**
   * Delete clips in a time range (for removing silence)
   * @param startTime - Start time in seconds
   * @param endTime - End time in seconds
   * @param trackIndex - Optional specific track (all tracks if not specified)
   * @param ripple - Whether to ripple delete (close the gap)
   */
  async deleteRange(
    startTime: number,
    endTime: number,
    trackIndex?: number,
    ripple: boolean = true
  ): Promise<{ clipsDeleted: number; timeRemoved: number }> {
    if (!this.isAvailable()) {
      logger.info('Running in mock mode');
      return this.mockDeleteRange(startTime, endTime);
    }

    try {
      const activeSequence = this.project.activeSequence;
      if (!activeSequence) {
        throw new Error('No active sequence');
      }

      // First, make cuts at start and end times
      await this.razorAtTime(startTime, trackIndex);
      await this.razorAtTime(endTime, trackIndex);

      let clipsDeleted = 0;
      const timeRemoved = endTime - startTime;

      // Find and delete clips that fall within the range
      const videoTracks = activeSequence.videoTracks;
      const audioTracks = activeSequence.audioTracks;

      const deleteFromTracks = (tracks: any) => {
        for (let i = 0; i < tracks.numTracks; i++) {
          if (trackIndex !== undefined && i !== trackIndex) continue;

          const track = tracks[i];
          const clipsToDelete: any[] = [];

          // Find clips in range
          for (let j = 0; j < track.clips.numItems; j++) {
            const clip = track.clips[j];
            const clipStart = clip.start.seconds;
            const clipEnd = clip.end.seconds;

            // Check if clip is within the delete range
            if (clipStart >= startTime && clipEnd <= endTime) {
              clipsToDelete.push(clip);
            }
          }

          // Delete the clips
          for (const clip of clipsToDelete) {
            if (typeof clip.remove === 'function') {
              clip.remove(ripple);
              clipsDeleted++;
            }
          }
        }
      };

      deleteFromTracks(videoTracks);
      deleteFromTracks(audioTracks);

      logger.info(`Deleted ${clipsDeleted} clips, removed ${timeRemoved}s`);

      return { clipsDeleted, timeRemoved };
    } catch (error) {
      logger.error('Failed to delete range', error);
      throw error;
    }
  }

  /**
   * Apply previously detected silence cuts to the timeline.
   * Cuts from END to START to preserve earlier timecodes.
   */
  async applySilenceCuts(sections?: SilentSection[]): Promise<ApplySilenceCutsResult> {
    const sectionsToApply = sections ?? this.pendingSilentSections;

    const result: ApplySilenceCutsResult = {
      cutsApplied: 0,
      cutsAttempted: sectionsToApply.length,
      timeRemoved: 0,
      errors: [],
    };

    if (sectionsToApply.length === 0) {
      logger.warn('No silent sections to apply');
      return result;
    }

    if (!this.isAvailable()) {
      logger.info('Running in mock mode - simulating cuts');
      // In mock mode, just clear the pending sections
      const timeRemoved = sectionsToApply.reduce((sum, s) => sum + s.duration, 0);
      this.pendingSilentSections = [];
      return {
        cutsApplied: sectionsToApply.length,
        cutsAttempted: sectionsToApply.length,
        timeRemoved,
        errors: [],
      };
    }

    try {
      // Sort sections by time DESCENDING (cut from end first to preserve timecodes)
      const sorted = [...sectionsToApply].sort((a, b) => b.start - a.start);

      logger.info(`Applying ${sorted.length} cuts (from end to start)...`);

      for (const section of sorted) {
        try {
          logger.info(`Cutting: ${section.start.toFixed(2)}s - ${section.end.toFixed(2)}s`);
          await this.deleteRange(section.start, section.end, undefined, true); // ripple=true
          result.cutsApplied++;
          result.timeRemoved += section.duration;
        } catch (error) {
          const errorMsg = `Failed to cut at ${section.start.toFixed(2)}s: ${error}`;
          result.errors.push(errorMsg);
          logger.error(errorMsg);
          // Continue with other cuts
        }
      }

      // Clear pending sections after application
      this.pendingSilentSections = [];

      logger.info(
        `Applied ${result.cutsApplied}/${result.cutsAttempted} cuts, removed ${result.timeRemoved.toFixed(1)}s`
      );
      return result;
    } catch (error) {
      logger.error('Failed to apply silence cuts', error);
      throw error;
    }
  }

  /**
   * Clear pending silent sections without applying cuts.
   */
  clearPendingSections(): void {
    this.pendingSilentSections = [];
    logger.info('Cleared pending silent sections');
  }

  // ============================================
  // Take Detection Methods
  // ============================================

  /**
   * Set the color label of a clip
   * @param clip - The clip object to color
   * @param colorIndex - Color index (0-15 in Premiere)
   */
  async setClipColorLabel(clip: any, colorIndex: number): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.info('Running in mock mode');
      return true;
    }

    try {
      if (!clip) {
        logger.warn('setClipColorLabel: No clip provided');
        return false;
      }

      // Validate color index (0-15)
      const safeIndex = Math.max(0, Math.min(15, Math.floor(colorIndex)));

      // Premiere UXP API for setting color label
      if (typeof clip.setColorLabel === 'function') {
        clip.setColorLabel(safeIndex);
        logger.debug(`Set clip color to ${safeIndex}`);
        return true;
      } else if (typeof clip.colorLabelIndex !== 'undefined') {
        // Alternative property-based approach
        clip.colorLabelIndex = safeIndex;
        logger.debug(`Set clip colorLabelIndex to ${safeIndex}`);
        return true;
      }

      logger.warn('Clip does not support color label API');
      return false;
    } catch (error) {
      logger.error('Failed to set clip color label', error);
      return false;
    }
  }

  /**
   * Rename a clip in the timeline
   * @param clip - The clip object to rename
   * @param newName - New name for the clip
   */
  async renameClip(clip: any, newName: string): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.info('Running in mock mode');
      return true;
    }

    try {
      if (!clip) {
        logger.warn('renameClip: No clip provided');
        return false;
      }

      // Premiere clips have a writable name property
      if (typeof clip.name !== 'undefined') {
        clip.name = newName;
        logger.debug(`Renamed clip to "${newName}"`);
        return true;
      }

      logger.warn('Clip does not support name property');
      return false;
    } catch (error) {
      logger.error('Failed to rename clip', error);
      return false;
    }
  }

  /**
   * Move the playhead to a specific time in the sequence
   * @param timeInSeconds - Target time in seconds
   */
  async goToTime(timeInSeconds: number): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.info('Running in mock mode');
      return true;
    }

    try {
      const activeSequence = this.project.activeSequence;
      if (!activeSequence) {
        throw new Error('No active sequence');
      }

      // Premiere UXP API for setting player position
      if (typeof activeSequence.setPlayerPosition === 'function') {
        activeSequence.setPlayerPosition(timeInSeconds);
        logger.info(`Moved playhead to ${timeInSeconds}s`);
        return true;
      }

      // Alternative: Use CTI (Current Time Indicator) if available
      if (activeSequence.cti) {
        activeSequence.cti.seconds = timeInSeconds;
        logger.info(`Moved CTI to ${timeInSeconds}s`);
        return true;
      }

      logger.warn('Sequence does not support setPlayerPosition');
      return false;
    } catch (error) {
      logger.error('Failed to go to time', error);
      return false;
    }
  }

  /**
   * Find all clips that overlap with a given time
   * @param timeInSeconds - Time to check
   * @param tracksToSearch - 'video' | 'audio' | 'all'
   */
  async findClipsAtTime(
    timeInSeconds: number,
    tracksToSearch: 'video' | 'audio' | 'all' = 'all'
  ): Promise<Array<{ clip: any; track: any; trackIndex: number; clipIndex: number }>> {
    if (!this.isAvailable()) {
      return [];
    }

    try {
      const activeSequence = this.project.activeSequence;
      if (!activeSequence) {
        return [];
      }

      const clips: Array<{ clip: any; track: any; trackIndex: number; clipIndex: number }> = [];

      const searchTracks = (trackCollection: any, _trackType: 'video' | 'audio') => {
        for (let i = 0; i < trackCollection.numTracks; i++) {
          const track = trackCollection[i];
          if (track.isMuted && track.isMuted()) continue;

          for (let j = 0; j < track.clips.numItems; j++) {
            const clip = track.clips[j];
            const clipStart = clip.start.seconds;
            const clipEnd = clip.end.seconds;

            if (timeInSeconds >= clipStart && timeInSeconds < clipEnd) {
              clips.push({
                clip,
                track,
                trackIndex: i,
                clipIndex: j,
              });
            }
          }
        }
      };

      if (tracksToSearch === 'video' || tracksToSearch === 'all') {
        searchTracks(activeSequence.videoTracks, 'video');
      }
      if (tracksToSearch === 'audio' || tracksToSearch === 'all') {
        searchTracks(activeSequence.audioTracks, 'audio');
      }

      return clips;
    } catch (error) {
      logger.error('Failed to find clips at time', error);
      return [];
    }
  }

  /**
   * Apply take detection results to timeline.
   * Creates razor cuts, applies colors, and renames clips.
   * Processes from END to START to preserve earlier timecodes.
   *
   * @param takes - Array of normalized takes to apply (uses pendingTakes if not provided)
   */
  async applyTakesToTimeline(takes?: NormalizedTake[]): Promise<ApplyTakesResult> {
    const takesToApply = takes ?? this.pendingTakes;

    const result: ApplyTakesResult = {
      takesApplied: 0,
      cutsCreated: 0,
      clipsColored: 0,
      clipsRenamed: 0,
      errors: [],
    };

    if (takesToApply.length === 0) {
      logger.warn('No takes to apply');
      return result;
    }

    if (!this.isAvailable()) {
      logger.info('Running in mock mode - simulating take application');
      this.pendingTakes = [];
      return {
        takesApplied: takesToApply.length,
        cutsCreated: takesToApply.length * 2,
        clipsColored: takesToApply.length,
        clipsRenamed: takesToApply.length,
        errors: [],
      };
    }

    try {
      // Sort takes by start time DESCENDING (process from end first)
      const sorted = [...takesToApply].sort((a, b) => b.start - a.start);

      logger.info(`Applying ${sorted.length} takes (from end to start)...`);

      for (const take of sorted) {
        try {
          // Step 1: Make cuts at take boundaries
          const cutAtStart = await this.razorAtTime(take.start);
          const cutAtEnd = await this.razorAtTime(take.end);

          if (cutAtStart) result.cutsCreated++;
          if (cutAtEnd) result.cutsCreated++;

          // Step 2: Find the clip that now represents this take
          // After cutting, we need to find the clip that starts at take.start
          const clips = await this.findClipsAtTime(take.start + 0.01); // Small offset to be inside clip

          for (const { clip } of clips) {
            // Step 3: Apply color label
            const colorSuccess = await this.setClipColorLabel(clip, take.colorIndex);
            if (colorSuccess) result.clipsColored++;

            // Step 4: Rename clip
            const renameSuccess = await this.renameClip(clip, take.clipName);
            if (renameSuccess) result.clipsRenamed++;
          }

          result.takesApplied++;
          logger.debug(`Applied take: ${take.clipName}`);
        } catch (error) {
          const errorMsg = `Failed to apply take at ${take.start}s: ${error}`;
          result.errors.push(errorMsg);
          logger.error(errorMsg);
        }
      }

      // Clear pending takes after application
      this.pendingTakes = [];

      logger.info(
        `Takes applied: ${result.takesApplied}, cuts: ${result.cutsCreated}, errors: ${result.errors.length}`
      );
      return result;
    } catch (error) {
      logger.error('Failed to apply takes to timeline', error);
      throw error;
    }
  }

  /**
   * Clear pending takes without applying them
   */
  clearPendingTakes(): void {
    this.pendingTakes = [];
    logger.info('Cleared pending takes');
  }

  // ============================================
  // Sequence Management Methods
  // ============================================

  /**
   * Get all sequences in the current project
   */
  async getSequences(): Promise<Array<{ id: string; name: string }>> {
    if (!this.isAvailable()) {
      logger.info('Running in mock mode');
      return [
        { id: 'seq-001', name: 'Main Sequence' },
        { id: 'seq-002', name: 'B-Roll' },
        { id: 'seq-003', name: 'Interview' },
      ];
    }

    try {
      const sequences: Array<{ id: string; name: string }> = [];
      const projectItems = this.project.rootItem.children;

      for (let i = 0; i < projectItems.numItems; i++) {
        const item = projectItems[i];
        if (item.type === 2) {
          // Type 2 is sequence in Premiere
          sequences.push({
            id: item.nodeId,
            name: item.name,
          });
        }
      }

      return sequences;
    } catch (error) {
      logger.error('Failed to get sequences', error);
      throw error;
    }
  }

  /**
   * Switch to a specific sequence by ID
   * @param sequenceId - The sequence node ID to switch to
   */
  async switchToSequence(sequenceId: string): Promise<boolean> {
    if (!this.isAvailable()) {
      logger.info('Running in mock mode - simulating sequence switch');
      return true;
    }

    try {
      const projectItems = this.project.rootItem.children;

      for (let i = 0; i < projectItems.numItems; i++) {
        const item = projectItems[i];
        if (item.nodeId === sequenceId && item.type === 2) {
          // Open the sequence in the timeline
          if (typeof this.project.openSequence === 'function') {
            this.project.openSequence(item.nodeId);
          } else if (typeof item.openInTimeline === 'function') {
            item.openInTimeline();
          }

          logger.info(`Switched to sequence: ${item.name}`);
          return true;
        }
      }

      logger.warn(`Sequence not found: ${sequenceId}`);
      return false;
    } catch (error) {
      logger.error('Failed to switch sequence', error);
      throw error;
    }
  }

  /**
   * Get information about a specific sequence
   */
  async getSequenceInfo(sequenceId: string): Promise<{ name: string; duration: number } | null> {
    if (!this.isAvailable()) {
      return { name: `Sequence ${sequenceId.substring(0, 8)}`, duration: 180 };
    }

    try {
      const projectItems = this.project.rootItem.children;

      for (let i = 0; i < projectItems.numItems; i++) {
        const item = projectItems[i];
        if (item.nodeId === sequenceId && item.type === 2) {
          // Get the sequence object
          const sequences = this.project.sequences;
          for (let j = 0; j < sequences.numSequences; j++) {
            const seq = sequences[j];
            if (seq.name === item.name) {
              return {
                name: seq.name,
                duration: seq.end?.seconds || 0,
              };
            }
          }

          return { name: item.name, duration: 0 };
        }
      }

      return null;
    } catch (error) {
      logger.error('Failed to get sequence info', error);
      return null;
    }
  }

  // ============================================
  // Mock methods for development/testing
  // ============================================
  private mockAnalyzeTimeline(): TimelineAnalysis {
    return {
      clipCount: 42,
      duration: 180.5,
      tracks: 6,
    };
  }

  private mockAutoCutSilence(): AutoCutResult {
    return {
      cutsApplied: 8,
      silentSections: 12,
      timeRemoved: 15.3,
    };
  }

  private mockExtractAudio(): ExtractedAudio {
    // Create a minimal mock audio buffer (silent WAV header)
    const sampleRate = 48000;
    const duration = 10; // 10 seconds
    const channels = 2;
    const bytesPerSample = 2;
    const dataSize = sampleRate * duration * channels * bytesPerSample;

    // Create WAV header + empty audio data
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF header
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataSize, true); // File size - 8
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // fmt chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // Chunk size
    view.setUint16(20, 1, true); // Audio format (PCM)
    view.setUint16(22, channels, true); // Channels
    view.setUint32(24, sampleRate, true); // Sample rate
    view.setUint32(28, sampleRate * channels * bytesPerSample, true); // Byte rate
    view.setUint16(32, channels * bytesPerSample, true); // Block align
    view.setUint16(34, bytesPerSample * 8, true); // Bits per sample

    // data chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataSize, true); // Data size

    return {
      buffer,
      duration,
      sampleRate,
      channels,
    };
  }

  private mockAddMarker(time: number, name: string, color?: string, comments?: string): MarkerInfo {
    return {
      name,
      time,
      color: color || 'green',
      comments: comments || '',
    };
  }

  private mockRazorAtTime(): boolean {
    return true;
  }

  private mockCreateTextTrack(name?: string): TrackInfo {
    return {
      name: name || 'Text Track 1',
      index: 3,
      type: 'video',
    };
  }

  private mockDeleteRange(
    startTime: number,
    endTime: number
  ): { clipsDeleted: number; timeRemoved: number } {
    return {
      clipsDeleted: 2,
      timeRemoved: endTime - startTime,
    };
  }
}
