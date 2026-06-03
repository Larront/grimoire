import { render, cleanup, act, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import HomePage from "../routes/+page.svelte";
import SearchPalette from "../lib/components/SearchPalette.svelte";
import { ledger } from "../lib/stores/ledger.svelte";
import { tabs } from "../lib/stores/tabs.svelte";

const SAMPLE_PATH = "/app-data/sample-world";

const RECENT_LEDGER = {
  path: "/worlds/my-campaign",
  name: "My Campaign",
  note_count: 5,
  scene_count: 0,
  map_count: 0,
  last_opened: new Date().toISOString(),
};

function mockSampleInvoke(recents: (typeof RECENT_LEDGER)[] = []) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "get_recent_ledgers") return recents;
    if (cmd === "explore_sample_ledger") return SAMPLE_PATH;
    if (cmd === "open_ledger")
      return { path: SAMPLE_PATH, note_count: 3, scene_count: 0, map_count: 0, failed_imports: [] };
    if (cmd === "get_notes") return [];
    return null;
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function openPaletteAndSearch(query: string) {
  const { getByPlaceholderText } = render(SearchPalette);
  await fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  await flush();
  await fireEvent.input(getByPlaceholderText("Type a command or search..."), {
    target: { value: query },
  });
  await flush();
}

// ── Returning Splash — replay link ───────────────────────────────────────────

describe("sample replay — returning Splash", () => {
  beforeEach(() => {
    mockSampleInvoke([RECENT_LEDGER]);
  });

  afterEach(async () => {
    cleanup();
    await ledger.closeLedger();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("renders the quiet replay link when recents are non-empty", async () => {
    const { getByTestId } = render(HomePage);
    await flush();
    expect(getByTestId("splash-explore-sample")).toBeTruthy();
  });

  it("replay link invokes exploreSample when clicked", async () => {
    const { getByTestId } = render(HomePage);
    await flush();

    await fireEvent.click(getByTestId("splash-explore-sample"));
    await flush();

    const calls = vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);
    expect(calls).toContain("explore_sample_ledger");
  });
});

// ── Command Palette — Explore example world ──────────────────────────────────

describe("sample replay — command palette", () => {
  beforeEach(() => {
    mockSampleInvoke();
  });

  afterEach(async () => {
    cleanup();
    tabs.closeAll("left");
    tabs.closeAll("right");
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("lists an 'Explore example world' command when searching", async () => {
    await openPaletteAndSearch("explore");
    expect(
      document.body.querySelector('[data-testid="cmd-explore-sample"]'),
    ).toBeTruthy();
  });

  it("'Explore example world' command calls exploreSample", async () => {
    await openPaletteAndSearch("explore");

    const btn = document.body.querySelector(
      '[data-testid="cmd-explore-sample"]',
    ) as HTMLElement;
    expect(btn).toBeTruthy();
    await fireEvent.click(btn);
    await flush();

    const calls = vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);
    expect(calls).toContain("explore_sample_ledger");
  });
});
