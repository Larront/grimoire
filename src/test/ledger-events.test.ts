// Tests for the Ledger Watcher's frontend event contract (#212) — the module
// that replaced loose event-name strings in two components, and the one place
// a Details Source can subscribe through without a pane relaying anything.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

const { listeners, resolvers } = vi.hoisted(() => ({
  listeners: {} as Record<string, ((e: { payload: unknown }) => void)[]>,
  // Holds each listen() call's resolve, so a test can control when Tauri hands
  // back the unlisten function — the race the module has to survive.
  resolvers: [] as (() => void)[],
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, cb: (e: { payload: unknown }) => void) => {
    const stop = () => {
      listeners[name] = (listeners[name] ?? []).filter((f) => f !== cb);
    };
    return new Promise((resolve) => {
      resolvers.push(() => {
        (listeners[name] ??= []).push(cb);
        resolve(stop);
      });
    });
  }),
}));

const { onLedgerEvents } = await import("$lib/ledger/events");

function settleListen() {
  resolvers.splice(0).forEach((r) => r());
  return Promise.resolve();
}

function emit(name: string, payload: unknown = null) {
  (listeners[name] ?? []).forEach((cb) => cb({ payload }));
}

beforeEach(() => {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
});

afterEach(() => {
  Object.keys(listeners).forEach((k) => delete listeners[k]);
  resolvers.length = 0;
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("onLedgerEvents", () => {
  it("routes each event's payload to its handler", async () => {
    const seen: unknown[] = [];
    onLedgerEvents({
      "note:content-changed": (p) => seen.push(p.path),
      "note:moved": (p) => seen.push(`${p.from}->${p.to}`),
    });
    await settleListen();

    emit("note:content-changed", { path: "Aldric.md" });
    emit("note:moved", { from: "Aldric.md", to: "People/Aldric.md" });
    expect(seen).toEqual(["Aldric.md", "Aldric.md->People/Aldric.md"]);
  });

  it("detaches on teardown", async () => {
    const seen: string[] = [];
    const stop = onLedgerEvents({ "ledger:rebuilt": () => seen.push("hit") });
    await settleListen();

    emit("ledger:rebuilt");
    stop();
    emit("ledger:rebuilt");
    expect(seen).toEqual(["hit"]);
  });

  it("detaches listeners that arrive after teardown", async () => {
    const seen: string[] = [];
    const stop = onLedgerEvents({ "ledger:rebuilt": () => seen.push("hit") });

    // Teardown before Tauri has handed back a single unlisten function — the
    // race each hand-rolled `Promise.all(...).then(...)` call site could lose.
    stop();
    await settleListen();

    emit("ledger:rebuilt");
    expect(seen).toEqual([]);
  });

  it("is a no-op outside Tauri, so dev and jsdom never reach listen()", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const stop = onLedgerEvents({ "ledger:rebuilt": () => {} });
    expect(resolvers).toHaveLength(0);
    expect(() => stop()).not.toThrow();
  });
});
