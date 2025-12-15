// Splice Plugin Type Definitions

declare module 'premiere' {
  interface Project {
    name: string;
    path: string;
    activeSequence: Sequence | null;
    sequences: SequenceCollection;
    rootItem: ProjectItem;
  }

  interface Sequence {
    name: string;
    id: string;
    videoTracks: TrackCollection;
    audioTracks: TrackCollection;
    markers: MarkerCollection;
    end: Time;
    frameSizeHorizontal: number;
    frameSizeVertical: number;
    timebase: string;
    setPlayerPosition?(time: number): void;
    cti?: Time;
  }

  /**
   * Adobe Media Encoder Manager for exporting sequences.
   * Used to export timeline audio to WAV files.
   */
  interface EncoderManager {
    /**
     * Export a sequence to a file using a preset.
     * @param sequence - The sequence to export
     * @param outputPath - Path for the output file
     * @param presetPath - Path to the .epr export preset
     * @param workArea - 0=entire sequence, 1=in/out points, 2=work area
     * @returns Job ID for tracking the export
     */
    exportSequence(
      sequence: Sequence,
      outputPath: string,
      presetPath: string,
      workArea: number
    ): Promise<string>;

    /**
     * Get the file extension for an export preset.
     * @param sequence - The sequence
     * @param presetPath - Path to the preset
     * @returns File extension (e.g., '.wav')
     */
    getExportFileExtension(sequence: Sequence, presetPath: string): string;
  }

  interface TrackCollection {
    numTracks: number;
    [index: number]: Track;
  }

  interface Track {
    name: string;
    id: string;
    clips: ClipCollection;
    isMuted(): boolean;
    setMute(mute: boolean): void;
  }

  interface ClipCollection {
    numItems: number;
    [index: number]: Clip;
  }

  interface Clip {
    name: string;
    start: Time;
    end: Time;
    inPoint: Time;
    outPoint: Time;
    projectItem: ProjectItem;
    setColorLabel?(colorIndex: number): void;
    colorLabelIndex?: number;
  }

  interface ProjectItem {
    name: string;
    type: number;
    treePath: string;
    children: ProjectItem[];
    /** Get the filesystem path to the media file (if available) */
    getMediaPath?(): string;
  }

  interface MarkerCollection {
    numMarkers: number;
    [index: number]: Marker;
  }

  interface Marker {
    name: string;
    start: Time;
    end: Time;
    comments: string;
    type: string;
  }

  interface Time {
    seconds: number;
    ticks: string;
  }

  interface SequenceCollection {
    numSequences: number;
    [index: number]: Sequence;
  }

  interface Application {
    version: string;
    build: string;
    project: Project;
    quit(): void;
  }

  export const app: Application;
  export const project: Project;
  export const encoderManager: EncoderManager;
}

declare module 'uxp' {
  namespace storage {
    interface SecureStorage {
      getItem(key: string): Promise<string | null>;
      setItem(key: string, value: string): Promise<void>;
      removeItem(key: string): Promise<void>;
    }

    const secureStorage: SecureStorage;
    const localFileSystem: LocalFileSystem;
  }

  interface LocalFileSystem {
    getFileForOpening(options?: FilePickerOptions): Promise<File | null>;
    getFileForSaving(suggestedName: string, options?: FilePickerOptions): Promise<File | null>;
    getFolder(options?: FolderPickerOptions): Promise<Folder | null>;
    /** Get the system temporary folder */
    getTemporaryFolder(): Promise<Folder>;
    /** Get the plugin's installation folder */
    getPluginFolder(): Promise<Folder>;
    /** Get a file or folder entry by its file:// URL */
    getEntryWithUrl(url: string): Promise<Entry | null>;
  }

  interface FilePickerOptions {
    types?: string[];
  }

  interface FolderPickerOptions {
    initialDomain?: string;
  }

  interface File {
    name: string;
    read(options?: ReadOptions): Promise<string | ArrayBuffer>;
    write(data: string | ArrayBuffer, options?: WriteOptions): Promise<void>;
  }

  interface Folder {
    name: string;
    /** Native filesystem path */
    nativePath: string;
    getEntries(): Promise<Entry[]>;
    createFile(name: string, options?: CreateOptions): Promise<File>;
    createFolder(name: string): Promise<Folder>;
  }

  interface Entry {
    name: string;
    isFile: boolean;
    isFolder: boolean;
    /** Native filesystem path */
    nativePath: string;
    /** File size in bytes (if available) */
    size?: number;
    /** Delete this entry */
    delete?(): Promise<void>;
  }

  interface ReadOptions {
    format?: 'utf-8' | 'binary';
  }

  interface WriteOptions {
    format?: 'utf-8' | 'binary';
  }

  interface CreateOptions {
    overwrite?: boolean;
  }

  export { storage };
}

// Spectrum Web Components
declare module '@spectrum-web-components/theme/sp-theme.js' {
  export class SpTheme extends HTMLElement {}
}

declare module '@spectrum-web-components/button/sp-button.js' {
  export class SpButton extends HTMLElement {
    variant: 'cta' | 'primary' | 'secondary' | 'negative';
    disabled: boolean;
  }
}

declare module '@spectrum-web-components/textfield/sp-textfield.js' {
  export class SpTextfield extends HTMLElement {
    value: string;
    placeholder: string;
    type: string;
    disabled: boolean;
  }
}

declare module '@spectrum-web-components/action-button/sp-action-button.js' {
  export class SpActionButton extends HTMLElement {
    selected: boolean;
    disabled: boolean;
  }
}

// ============================================
// Subscription & Billing Types
// ============================================

type TierId = 'free' | 'pro' | 'studio';

interface Tier {
  id: TierId;
  name: string;
  monthlyMinutes: number;
  priceMonthly: number;
  features: string[];
}

interface TierLimits {
  monthlyMinutes: number;
  features: string[];
}

interface SubscriptionStatus {
  tier: TierId;
  status: 'active' | 'canceled' | 'expired';
  periodEnd: Date;
  minutesUsed: number;
  minutesLimit: number;
}

// ============================================
// Usage Tracking Types
// ============================================

type FeatureType = 'voice_isolation' | 'transcription' | 'take_analysis';

interface UsageRecord {
  id: string;
  userId: string;
  featureType: FeatureType;
  minutes: number;
  createdAt: Date;
}

interface UsageStats {
  totalMinutes: number;
  byFeature: Record<FeatureType, number>;
  periodStart: Date;
  periodEnd: Date;
}

// ============================================
// Authentication Types
// ============================================

interface AuthResponse {
  success: boolean;
  token?: string;
  refreshToken?: string;
  expiresAt?: string;
  user?: { id: string; email: string };
  error?: string;
}

interface User {
  id: string;
  email: string;
  createdAt: Date;
}

// ============================================
// AI Service Types
// ============================================

interface IsolatedAudio {
  vocals: ArrayBuffer;
  background: ArrayBuffer;
}

interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  confidence: number;
}

interface TranscriptionResult {
  success: boolean;
  text: string;
  segments: TranscriptionSegment[];
}

// ============================================
// Whisper Transcription Types
// ============================================

interface WhisperOptions {
  language?: string; // ISO-639-1 code (e.g., 'en', 'es', 'fr')
  prompt?: string; // Context hint for better accuracy
  responseFormat?: 'json' | 'verbose_json' | 'text' | 'srt' | 'vtt';
  temperature?: number; // 0-1, lower = more deterministic
}

interface WhisperWord {
  word: string;
  start: number; // Start time in seconds
  end: number; // End time in seconds
}

interface WhisperSegment {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
}

interface WhisperTranscriptionResult {
  task: 'transcribe';
  language: string;
  duration: number;
  text: string;
  words?: WhisperWord[]; // Only with timestamp_granularities: ['word']
  segments?: WhisperSegment[]; // Only with verbose_json
}

interface PauseAnalysis {
  pauses: Array<{
    start: number;
    end: number;
    isNatural: boolean;
    confidence: number;
  }>;
}

interface TakeAnalysis {
  takes: Array<{
    start: number;
    end: number;
    text: string;
    isBest: boolean;
    score: number;
  }>;
}

// ============================================
// Take Detection Types
// ============================================

/** A normalized take with color and clip name assigned */
interface NormalizedTake {
  groupId: string;
  phrase: string;
  takeNumber: number;
  start: number;
  end: number;
  text: string;
  isBest: boolean;
  score: number;
  colorIndex: number;
  clipName: string;
}

/** A group of takes for the same phrase */
interface TakeGroup {
  id: string;
  phrase: string;
  takes: NormalizedTake[];
  bestTakeIndex: number;
}

/** Result of applying takes to timeline */
interface ApplyTakesResult {
  takesApplied: number;
  cutsCreated: number;
  clipsColored: number;
  clipsRenamed: number;
  errors: string[];
}

/** Configuration for take detection */
interface TakeDetectorConfig {
  colorRotation: number[];
  clipNameFormat: string;
  phrasePreviewLength: number;
}

// ============================================
// LLM Provider Types
// ============================================

type LLMProviderType = 'openai' | 'gemini';

interface LLMProviderConfig {
  type: LLMProviderType;
  apiKey: string;
  model?: string;
}

// ============================================
// API Key Types (BYOK)
// ============================================

type ApiKeyService = 'elevenlabs' | 'openai' | 'gemini';

interface StoredCredentials {
  authToken: string | null;
  refreshToken: string | null;
  tokenExpiry: string | null;
  apiKeys: Partial<Record<ApiKeyService, string>>;
  preferredLLM: LLMProviderType;
}
