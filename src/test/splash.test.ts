// The Splash (2026-10 design review): two columns, the GM's last world as the
// subject with Continue focused, the example world continued rather than wiped, and
// each failure said once. Driven over a mocked `invoke`, as the other Splash tests are.
import { render, cleanup, act, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import HomePage from "../routes/+page.svelte";
import { ledger } from "../lib/stores/ledger.svelte";
import { lastOpened, worldContents } from "../lib/components/splash/splash";

const SANDBOX = "/app-data/sample-world";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const DAY = 864e5;

const world = (name: string, path: string, opened: string, missing = false) => ({
  path,
  name,
  note_count: 5,
  scene_count: 1,
  map_count: 0,
  last_opened: opened,
  missing,
});

function mockInvoke(recents: unknown[], { sandbox = null as string | null } = {}) {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
    if (cmd === "get_recent_ledgers") return recents;
    if (cmd === "existing_sample_ledger") return sandbox;
    if (cmd === "explore_sample_ledger") return SANDBOX;
    if (cmd === "open_ledger")
      return {
        path: args?.path ?? SANDBOX,
        note_count: 3,
        scene_count: 0,
        map_count: 0,
        failed_imports: [],
        unlinked_pins: [],
      };
    return null;
  });
}

async function flush() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd);

beforeEach(async () => {
  await ledger.closeLedger();
  vi.mocked(invoke).mockClear();
});

afterEach(async () => {
  cleanup();
  await ledger.closeLedger();
  vi.mocked(invoke).mockResolvedValue(null);
});

describe("Splash — a returning GM", () => {
  it("leads with the last world, Continue focused, the others listed beneath", async () => {
    mockInvoke([
      world("Gods Ascendant", "/w/gods", ago(60 * DAY)),
      world("Ironhold", "/w/iron", ago(DAY), true),
      world("No Room For A Wallflower", "/w/wallflower", ago(7 * DAY)),
    ]);
    const { getByRole, getByText } = render(HomePage);
    await flush();

    // The most recent world whose folder can be found — the backend lists by recency.
    const hero = getByRole("heading", { level: 2, name: "Gods Ascendant" });
    expect(hero).toBeTruthy();
    expect(getByText("Other worlds")).toBeTruthy();
    expect(document.activeElement?.textContent?.trim()).toBe("Continue");
  });

  it("Continue opens that world", async () => {
    mockInvoke([world("Gods Ascendant", "/w/gods", ago(DAY))]);
    const { getByRole } = render(HomePage);
    await flush();

    await fireEvent.click(getByRole("button", { name: "Continue" }));
    await flush();

    expect(calls("open_ledger")[0][1]).toMatchObject({ path: "/w/gods" });
  });

  it("says a failed open once — the toast — with no line repeating it under the page", async () => {
    mockInvoke([world("Gods Ascendant", "/w/gods", ago(DAY))]);
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_recent_ledgers") return [world("Gods Ascendant", "/w/gods", ago(DAY))];
      if (cmd === "open_ledger") throw "ERR_DB_LOCKED: busy";
      return null;
    });
    const { getByRole } = render(HomePage);
    await flush();

    await fireEvent.click(getByRole("button", { name: "Continue" }));
    await flush();

    expect(document.querySelector("main [role='alert']")).toBeNull();
  });

  it("gives focus back to New world when the create form is cancelled", async () => {
    mockInvoke([world("Gods Ascendant", "/w/gods", ago(DAY))]);
    const { getByRole } = render(HomePage);
    await flush();

    await fireEvent.click(getByRole("button", { name: "New world" }));
    await flush();
    const name = document.activeElement as HTMLInputElement;
    expect(name.placeholder).toBe("Name your world");

    await fireEvent.keyDown(name, { key: "Escape" });
    await flush();

    expect(document.activeElement?.textContent?.trim()).toBe("New world");
  });
});

describe("Splash — the example world", () => {
  it("is the invitation the first time, and Explore makes a fresh copy", async () => {
    mockInvoke([]);
    const { getByRole } = render(HomePage);
    await flush();

    expect(getByRole("heading", { name: "The Ashfen Vale" })).toBeTruthy();
    const explore = getByRole("button", { name: "Explore it" });
    expect(document.activeElement).toBe(explore);

    await fireEvent.click(explore);
    await flush();
    expect(calls("explore_sample_ledger")).toHaveLength(1);
  });

  it("continues an earlier exploration as it was left, without wiping it", async () => {
    mockInvoke([], { sandbox: SANDBOX });
    const { getByRole } = render(HomePage);
    await flush();

    await fireEvent.click(getByRole("button", { name: "Continue exploring" }));
    await flush();

    expect(calls("explore_sample_ledger")).toHaveLength(0);
    expect(calls("open_ledger")[0][1]).toMatchObject({ path: SANDBOX });
    expect(ledger.isSample).toBe(true);
  });

  it("starts it over only when asked", async () => {
    mockInvoke([], { sandbox: SANDBOX });
    const { getByRole } = render(HomePage);
    await flush();

    await fireEvent.click(getByRole("button", { name: "Start it over" }));
    await flush();

    expect(calls("explore_sample_ledger")).toHaveLength(1);
  });
});

describe("Splash — words", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  const at = (ms: number) => new Date(now - ms).toISOString();

  it("says when a world was last opened in words", () => {
    expect(lastOpened(at(20_000), now)).toBe("just now");
    expect(lastOpened(at(5 * 6e4), now)).toBe("5 minutes ago");
    expect(lastOpened(at(3 * 36e5), now)).toBe("3 hours ago");
    expect(lastOpened(at(DAY), now)).toBe("yesterday");
    expect(lastOpened(at(7 * DAY), now)).toBe("a week ago");
    expect(lastOpened(at(60 * DAY), now)).toBe("2 months ago");
    expect(lastOpened(at(400 * DAY), now)).toBe("over a year ago");
  });

  it("says what is in a world, and when nothing is", () => {
    expect(worldContents({ ...world("A", "/a", at(0)), note_count: 1, scene_count: 2, map_count: 1 })).toBe(
      "1 note · 2 scenes · 1 map",
    );
    expect(worldContents({ ...world("A", "/a", at(0)), note_count: 0, scene_count: 0, map_count: 0 })).toBe(
      "Nothing in it yet",
    );
  });
});
