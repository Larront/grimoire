// The same matchers as the jsdom project, first: `setup.ts` imports jest-dom and this file
// did not, so `expect` meant two different things in the two projects. Latent rather than
// live — the browser files happen to use core matchers only — but the most natural assertion
// to reach for there is `expect(grip).toBeVisible()`, and it died as "not a function" in the
// one project whose whole purpose is asking about boxes.
import "@testing-library/jest-dom";

// What a real browser is missing that the app assumes: the Tauri bridge.
//
// The jsdom project mocks `@tauri-apps/api/core` with `vi.mock`. That is a module-graph
// trick, and the browser project cannot use it — its modules are served to a real page by
// Vite. So the bridge is stubbed where the API actually looks for it: on `window`.
//
// Without this a block that reads the ledger on mount — a Scene asking which slots its
// audio is bound to — throws inside a Svelte effect, which surfaces as an unhandled
// rejection and fails the run with every test still green.
//
// Everything answers an empty list, because the commands a block calls while drawing
// itself are the ones asking *what is bound to this* — a Scene's audio slots — and those
// return collections the caller maps over immediately. `null` reads as "no ledger" and
// then throws one line later, inside the same effect, which is no better than no stub at
// all. These tests are about boxes and never about data: a block that needs real rows to
// draw its chrome belongs in the jsdom project with real fixtures.
const invoke = async () => [];

Object.defineProperty(window, "__TAURI_INTERNALS__", {
  value: {
    invoke,
    transformCallback: (callback: unknown) => callback,
    convertFileSrc: (path: string) => path,
  },
  writable: true,
});
