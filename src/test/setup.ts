import "@testing-library/jest-dom";
import { vi } from "vitest";

// mode-watcher uses PersistedState (runed) which reads localStorage as source of truth —
// the mock must actually store and retrieve values for setMode/resetMode to work in tests.
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key];
  }),
  clear: vi.fn(() => {
    Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]);
  }),
  length: 0,
  key: vi.fn().mockReturnValue(null),
};
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// mode-watcher reads matchMedia to detect prefers-color-scheme
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockResolvedValue(""),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
  watch: vi.fn().mockResolvedValue(() => {}),
  watchImmediate: vi.fn().mockResolvedValue(() => {}),
}));
