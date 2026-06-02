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

// Default mock reports a 1280px-wide pane (≥820 → docked) so existing tests
// that check for the docked aside continue to pass. Tests that need a narrow
// pane can override globalThis.ResizeObserver before rendering.
globalThis.ResizeObserver = class MockResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    this.cb(
      [
        {
          contentRect: { width: 1280, height: 800 } as DOMRectReadOnly,
          target,
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// bits-ui Command calls scrollIntoView on DOM elements during keyboard navigation
Element.prototype.scrollIntoView = vi.fn();

// Svelte built-in transitions (fly, fade, etc.) use the Web Animations API which
// jsdom does not implement. Mock animate() so transition effects don't throw.
Element.prototype.animate = vi.fn().mockReturnValue({
  onfinish: null,
  oncancel: null,
  cancel: vi.fn(),
  finish: vi.fn(),
  pause: vi.fn(),
  play: vi.fn(),
  reverse: vi.fn(),
  currentTime: 0,
  playbackRate: 1,
  playState: "idle",
  startTime: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}) as unknown as typeof Element.prototype.animate;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
  convertFileSrc: vi.fn().mockImplementation((url: string) => url),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockResolvedValue(""),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
  remove: vi.fn().mockResolvedValue(undefined),
  watch: vi.fn().mockResolvedValue(() => {}),
  watchImmediate: vi.fn().mockResolvedValue(() => {}),
}));
