import { beforeAll, afterEach, vi } from 'vitest';

// Mock UXP modules
vi.mock('premiere', () => ({
  app: {
    version: '25.6.0',
    build: '1',
    project: null,
    quit: vi.fn(),
  },
  project: null,
}));

vi.mock('uxp', () => ({
  storage: {
    secureStorage: {
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    },
    localFileSystem: {
      getFileForOpening: vi.fn().mockResolvedValue(null),
      getFileForSaving: vi.fn().mockResolvedValue(null),
      getFolder: vi.fn().mockResolvedValue(null),
    },
  },
}));

beforeAll(() => {
  // Set up DOM environment
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  // Clean up after each test
  vi.clearAllMocks();
});
