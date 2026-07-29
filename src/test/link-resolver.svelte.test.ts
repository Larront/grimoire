import { describe, it, expect, vi, beforeEach } from "vitest";

// The Link Resolver is a ledger-level service over two collaborators: the notes
// store (path match) and resolve_note_target (alias lookup). Mock both — the notes
// store so we control the path set, the api so we control the alias answer and can
// count calls (the cache's whole job is to not ask twice).
const resolveNoteTarget = vi.fn();
const silentResolveNoteTarget = vi.fn();

vi.mock("../lib/api", () => ({
  api: {
    resolveNoteTarget: (...a: unknown[]) => resolveNoteTarget(...a),
    silent: {
      resolveNoteTarget: (...a: unknown[]) => silentResolveNoteTarget(...a),
    },
  },
}));

interface FakeNote {
  id: number;
  path: string;
  title: string;
}

let noteList: FakeNote[] = [];

vi.mock("../lib/stores/notes.svelte", () => ({
  notes: {
    get notes() {
      return noteList;
    },
  },
}));

import { linkResolver } from "../lib/stores/link-resolver.svelte";

function note(id: number, path: string, title = path): FakeNote {
  return { id, path, title };
}

beforeEach(() => {
  vi.clearAllMocks();
  // A fresh list identity is how the resolver learns its cache is stale, so this
  // also resets the cache between tests.
  noteList = [];
  silentResolveNoteTarget.mockResolvedValue(null);
  resolveNoteTarget.mockResolvedValue(null);
});

// ─── isKnown — the cached synchronous read, for drawing ───────────────────────

describe("linkResolver.isKnown", () => {
  it("defaults an unprimed target to known, so a real link never flashes as a stub", () => {
    expect(linkResolver.isKnown("Places/Blackreach.md")).toBe(true);
  });

  it("asks nothing — it is a pure read of the last known answer", () => {
    linkResolver.isKnown("Places/Blackreach.md");
    expect(silentResolveNoteTarget).not.toHaveBeenCalled();
    expect(resolveNoteTarget).not.toHaveBeenCalled();
  });

  it("settles to broken once a prime finds neither a path nor an alias", async () => {
    await linkResolver.prime(["Nowhere"]);
    expect(linkResolver.isKnown("Nowhere")).toBe(false);
  });
});

// ─── prime — warming the cache the drawing read consults ──────────────────────

describe("linkResolver.prime", () => {
  it("a path match is known without asking the backend", async () => {
    noteList = [note(1, "Places/Blackreach.md")];
    await linkResolver.prime(["Places/Blackreach.md"]);
    expect(linkResolver.isKnown("Places/Blackreach.md")).toBe(true);
    expect(silentResolveNoteTarget).not.toHaveBeenCalled();
  });

  it("no path match but an alias hit is known", async () => {
    silentResolveNoteTarget.mockResolvedValue(note(7, "Places/Blackreach.md", "The Deep City"));
    await linkResolver.prime(["The Deep City"]);
    expect(silentResolveNoteTarget).toHaveBeenCalledWith("The Deep City");
    expect(linkResolver.isKnown("The Deep City")).toBe(true);
  });

  it("asks once per target, however many times it is primed", async () => {
    await linkResolver.prime(["Nowhere"]);
    await linkResolver.prime(["Nowhere"]);
    expect(silentResolveNoteTarget).toHaveBeenCalledTimes(1);
  });

  it("a backend failure leaves the target at its default rather than marking it broken", async () => {
    silentResolveNoteTarget.mockRejectedValue(new Error("no ledger open"));
    await linkResolver.prime(["Nowhere"]);
    expect(linkResolver.isKnown("Nowhere")).toBe(true);
  });

  it("resolution ignores a #heading fragment — one answer serves every fragment of a target", async () => {
    noteList = [note(1, "The Severance")];
    await linkResolver.prime(["The Severance#The Night of Silence"]);
    expect(silentResolveNoteTarget).not.toHaveBeenCalled();
    expect(linkResolver.isKnown("The Severance#Aftermath")).toBe(true);
  });

  it("creating the missing note invalidates the cache, so the link becomes live", async () => {
    await linkResolver.prime(["Blackreach"]);
    expect(linkResolver.isKnown("Blackreach")).toBe(false);

    // What notes.load() does after a create: a new list identity.
    noteList = [note(1, "Blackreach")];
    await linkResolver.prime(["Blackreach"]);
    expect(linkResolver.isKnown("Blackreach")).toBe(true);
  });

  it("an in-flight prime from before a notes change does not write its stale answer", async () => {
    // Hold the alias lookup open so the notes list can change mid-flight.
    let release: (v: unknown) => void = () => {};
    silentResolveNoteTarget.mockReturnValue(new Promise((r) => (release = r)));
    const stale = linkResolver.prime(["Blackreach"]);

    noteList = [note(1, "Blackreach")];
    silentResolveNoteTarget.mockResolvedValue(null);
    await linkResolver.prime(["Blackreach"]); // path match → known

    release(null); // the old lookup finally answers "broken"
    await stale;

    expect(linkResolver.isKnown("Blackreach")).toBe(true);
  });
});

// ─── resolve — the authoritative asynchronous check, for acting ───────────────

describe("linkResolver.resolve", () => {
  it("a path match returns the note from the live list, no backend round-trip", async () => {
    noteList = [note(3, "Places/Blackreach.md", "Blackreach")];
    await expect(linkResolver.resolve("Places/Blackreach.md")).resolves.toEqual({
      id: 3,
      path: "Places/Blackreach.md",
      title: "Blackreach",
    });
    expect(resolveNoteTarget).not.toHaveBeenCalled();
  });

  it("an alias hit returns the resolved note", async () => {
    const target = note(7, "Places/Blackreach.md", "Blackreach");
    resolveNoteTarget.mockResolvedValue(target);
    await expect(linkResolver.resolve("The Deep City")).resolves.toEqual(target);
    expect(resolveNoteTarget).toHaveBeenCalledWith("The Deep City");
  });

  it("does not trust the cache — a primed-known target is still checked before acting", async () => {
    silentResolveNoteTarget.mockResolvedValue(note(7, "Places/Blackreach.md"));
    await linkResolver.prime(["The Deep City"]);
    expect(linkResolver.isKnown("The Deep City")).toBe(true);

    // The note is gone by the time the GM clicks: the fresh check says so, and it
    // is the fresh check that decides whether to create a file.
    resolveNoteTarget.mockResolvedValue(null);
    await expect(linkResolver.resolve("The Deep City")).resolves.toBeNull();
    expect(resolveNoteTarget).toHaveBeenCalledWith("The Deep City");
  });

  it("strips a #heading fragment before checking", async () => {
    resolveNoteTarget.mockResolvedValue(null);
    await linkResolver.resolve("The Severance#Aftermath");
    expect(resolveNoteTarget).toHaveBeenCalledWith("The Severance");
  });

  it("rethrows so the acting caller can abort — a failed check never reads as 'missing'", async () => {
    resolveNoteTarget.mockRejectedValue(new Error("no ledger open"));
    await expect(linkResolver.resolve("Blackreach")).rejects.toThrow();
  });

  it("silent mode routes through api.silent for background lookups (hover preview)", async () => {
    silentResolveNoteTarget.mockResolvedValue(null);
    await linkResolver.resolve("Blackreach", { silent: true });
    expect(silentResolveNoteTarget).toHaveBeenCalledWith("Blackreach");
    expect(resolveNoteTarget).not.toHaveBeenCalled();
  });

  it("its answer feeds the cache, so the next paint draws the fresh truth", async () => {
    resolveNoteTarget.mockResolvedValue(null);
    await linkResolver.resolve("Nowhere");
    expect(linkResolver.isKnown("Nowhere")).toBe(false);
  });
});
