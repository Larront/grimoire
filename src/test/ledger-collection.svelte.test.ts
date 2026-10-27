import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushSync } from "svelte";

// The factory owns the ledger open/close lifecycle: it loads via `fetch` when the
// ledger opens and clears itself when it closes. Drive the lifecycle by toggling a
// $state-backed `isOpen` on the mocked ledger, then flushSync() the effect.
let mockLedgerOpen = $state(false);
// Which ledger is open. It is the *path* the collection watches, not the flag: opening
// a second ledger from inside the first never lowers `isOpen`, so a collection keyed on
// the flag alone would keep serving the ledger the GM left.
let mockLedgerPath = $state("/ledgers/one");
// Bumped by every open. Reopening the ledger already open changes neither the flag nor
// the path, and only this says it happened.
let mockOpenGeneration = $state(0);

vi.mock("$lib/stores/ledger.svelte", () => ({
  ledger: {
    get isOpen() {
      return mockLedgerOpen;
    },
    get path() {
      return mockLedgerOpen ? mockLedgerPath : null;
    },
    get openGeneration() {
      return mockOpenGeneration;
    },
  },
}));

import { createLedgerCollection } from "$lib/stores/ledger-collection.svelte";

// load() awaits fetch; a few microtask turns let the resolved value settle.
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let cleanup: (() => void) | null = null;

function mount<T>(opts: { fetch: () => Promise<T[]>; onClose?: () => void }) {
  let collection!: ReturnType<typeof createLedgerCollection<T>>;
  cleanup = $effect.root(() => {
    collection = createLedgerCollection<T>(opts);
  });
  flushSync();
  return collection;
}

beforeEach(() => {
  mockLedgerOpen = false;
  mockLedgerPath = "/ledgers/one";
  mockOpenGeneration = 0;
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.clearAllMocks();
});

describe("createLedgerCollection", () => {
  it("fills the list from fetch when the ledger opens", async () => {
    const fetch = vi.fn(async () => ["a", "b", "c"]);
    const collection = mount({ fetch });

    expect(collection.items).toEqual([]);

    mockLedgerOpen = true;
    flushSync();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(collection.items).toEqual(["a", "b", "c"]);
  });

  it("refetches when a second ledger is opened without closing the first", async () => {
    // The sidebar bug this file's lifecycle owns: `isOpen` stays true across a switch,
    // so a collection watching the flag serves the previous ledger's notes for as long
    // as the window is open.
    const byLedger: Record<string, string[]> = {
      "/ledgers/one": ["one's note"],
      "/ledgers/two": ["two's note"],
    };
    const fetch = vi.fn(async () => byLedger[mockLedgerPath]);
    const collection = mount({ fetch });

    mockLedgerOpen = true;
    flushSync();
    await flush();
    expect(collection.items).toEqual(["one's note"]);

    mockLedgerPath = "/ledgers/two";
    flushSync();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(collection.items).toEqual(["two's note"]);
  });

  // Until the new world's list lands, the old one's rows answered for it: a restored
  // tab found the left world's note under its own id and reported it unreadable.
  it("empties the list the moment another ledger opens, before its fetch lands", async () => {
    let release!: (rows: string[]) => void;
    const fetch = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["one's note"])
      .mockImplementationOnce(() => new Promise((r) => (release = r)));
    const collection = mount({ fetch });

    mockLedgerOpen = true;
    flushSync();
    await flush();
    expect(collection.items).toEqual(["one's note"]);

    mockLedgerPath = "/ledgers/two";
    mockOpenGeneration++;
    flushSync();
    expect(collection.items).toEqual([]);

    release(["two's note"]);
    await flush();
    expect(collection.items).toEqual(["two's note"]);
  });

  it("refetches when the open ledger is opened again at the same path", async () => {
    // Re-exploring the Example World from inside itself: the sandbox is reset and
    // reopened at the path it already had, so neither the flag nor the path moves —
    // but the rows the list holds are gone from the ledger.
    let rows = ["captured while exploring"];
    const fetch = vi.fn(async () => rows);
    const collection = mount({ fetch });

    mockLedgerOpen = true;
    mockOpenGeneration++;
    flushSync();
    await flush();
    expect(collection.items).toEqual(["captured while exploring"]);

    rows = [];
    mockOpenGeneration++;
    flushSync();
    await flush();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(collection.items).toEqual([]);
  });

  it("ignores a slower fetch from the ledger that was left", async () => {
    // Two reads in flight at once is what a switch causes, and the outgoing ledger's is
    // the one likelier to be slow — it was asked first, and it can be answered last.
    const resolvers: ((v: string[]) => void)[] = [];
    const fetch = vi.fn(() => new Promise<string[]>((resolve) => resolvers.push(resolve)));
    const collection = mount({ fetch });

    mockLedgerOpen = true;
    flushSync();
    mockLedgerPath = "/ledgers/two";
    flushSync();
    expect(resolvers).toHaveLength(2);

    // The new ledger answers first, the old one afterwards.
    resolvers[1](["two's note"]);
    await flush();
    resolvers[0](["one's note"]);
    await flush();

    expect(collection.items).toEqual(["two's note"]);
  });

  it("empties the list when the ledger closes", async () => {
    const fetch = vi.fn(async () => ["a", "b"]);
    const collection = mount({ fetch });

    mockLedgerOpen = true;
    flushSync();
    await flush();
    expect(collection.items).toEqual(["a", "b"]);

    mockLedgerOpen = false;
    flushSync();
    expect(collection.items).toEqual([]);
  });

  it("sets error when fetch fails and stops loading", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("boom");
    });
    const collection = mount<string>({ fetch });

    mockLedgerOpen = true;
    flushSync();
    await flush();

    expect(collection.error).toContain("boom");
    expect(collection.isLoading).toBe(false);
    expect(collection.items).toEqual([]);
  });

  it("clears a prior error when re-opening resolves", async () => {
    let shouldFail = true;
    const fetch = vi.fn(async () => {
      if (shouldFail) throw new Error("boom");
      return ["ok"];
    });
    const collection = mount<string>({ fetch });

    mockLedgerOpen = true;
    flushSync();
    await flush();
    expect(collection.error).toContain("boom");

    mockLedgerOpen = false;
    flushSync();

    shouldFail = false;
    mockLedgerOpen = true;
    flushSync();
    await flush();

    expect(collection.error).toBeNull();
    expect(collection.items).toEqual(["ok"]);
  });

  it("keeps count in sync with the list length", async () => {
    const fetch = vi.fn(async () => [1, 2, 3, 4]);
    const collection = mount({ fetch });

    expect(collection.count).toBe(0);

    mockLedgerOpen = true;
    flushSync();
    await flush();
    expect(collection.count).toBe(4);

    mockLedgerOpen = false;
    flushSync();
    expect(collection.count).toBe(0);
  });

  it("runs the onClose hook when the ledger closes", async () => {
    const onClose = vi.fn();
    const collection = mount({ fetch: async () => ["a"], onClose });

    mockLedgerOpen = true;
    flushSync();
    await flush();
    onClose.mockClear();

    mockLedgerOpen = false;
    flushSync();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(collection.items).toEqual([]);
  });

  it("setError surfaces an error from a layered method, cleared by the next load", async () => {
    const fetch = vi.fn(async () => ["x"]);
    const collection = mount({ fetch });

    mockLedgerOpen = true;
    flushSync();
    await flush();

    collection.setError("read failed");
    expect(collection.error).toBe("read failed");

    await collection.load();
    expect(collection.error).toBeNull();
  });

  it("load() refetches on demand while the ledger is open", async () => {
    const fetch = vi.fn(async () => ["x"]);
    const collection = mount({ fetch });

    mockLedgerOpen = true;
    flushSync();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);

    await collection.load();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(collection.items).toEqual(["x"]);
  });
});
