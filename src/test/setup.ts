import "@testing-library/jest-dom";
import { afterAll, vi } from "vitest";

// bits-ui's body scroll lock (dialogs, the command palette) does not restore the
// body style the moment its last lock releases. It schedules the restore on a
// 24ms timer, so a lock re-registering in the same tick can cancel it — and
// nothing awaits that timer. So when a file's final test unmounts a locking
// component, the restore is still queued while Vitest tears the jsdom
// environment down, and it dereferences `document` on the way out:
//
//   ReferenceError: document is not defined
//     ❯ resetBodyStyle bits-ui/dist/internal/body-scroll-lock.svelte.js:34:9
//
// Vitest counts that as an unhandled error and fails the whole run even when
// every test passed. It is intermittent because it needs teardown to land inside
// the 24ms window — which is exactly the kind of failure that wastes an
// afternoon, so we drain the timer here instead.
//
// Draining is per file rather than per test: a pending restore is only dangerous
// at the point the environment goes away. The wait is conditional on the lock's
// own marker, so the ~90 files that never open a dialog pay nothing, and a file
// that does waits only the ~24ms it actually needs.
//
// Read through the style *attribute* rather than `style.getPropertyValue()`:
// jsdom's CSSStyleDeclaration does not resolve CSS custom properties, so the
// getter returns "" for a marker that is plainly there in the attribute text.
const scrollLockRestorePending = () =>
  (document.body.getAttribute("style") ?? "").includes("--scrollbar-width");

afterAll(async () => {
  const deadline = Date.now() + 250;
  while (scrollLockRestorePending() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
});

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
