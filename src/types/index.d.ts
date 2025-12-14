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
  }

  interface ProjectItem {
    name: string;
    type: number;
    treePath: string;
    children: ProjectItem[];
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
    getEntries(): Promise<Entry[]>;
    createFile(name: string, options?: CreateOptions): Promise<File>;
    createFolder(name: string): Promise<Folder>;
  }

  interface Entry {
    name: string;
    isFile: boolean;
    isFolder: boolean;
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
