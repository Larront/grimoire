import { render, cleanup, act, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import HomePage from "../routes/+page.svelte";
import SearchPalette from "../lib/components/SearchPalette.svelte";
import { ledger } from "../lib/stores/ledger.svelte";
import { tabs } from "../lib/stores/tabs.svelte";

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function openPalette() {
  await fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  await flush();
}

// ── Returning Splash — replay link ───────────────────────────────────────────

describe("sample replay — returning Splash", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_recent_ledgers")
        return [
          {
            path: "/worlds/my-campaign",
            name: "My Campaign",
            note_count: 5,
            scene_count: 0,
            map_count: 0,
            last_opened: new Date().toISOString(),
          },
        ];
      return null;
    });
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
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_recent_ledgers")
        return [
          {
            path: "/worlds/my-campaign",
            name: "My Campaign",
            note_count: 5,
            scene_count: 0,
            map_count: 0,
            last_opened: new Date().toISOString(),
          },
        ];
      if (cmd === "explore_sample_ledger") return "/app-data/sample-world";
      if (cmd === "open_ledger")
        return {
          path: "/app-data/sample-world",
          note_count: 3,
          scene_count: 0,
          map_count: 0,
          failed_imports: [],
        };
      if (cmd === "get_notes") return [];
      return null;
    });

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
  afterEach(async () => {
    cleanup();
    tabs.closeAll("left");
    tabs.closeAll("right");
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("lists an 'Explore example world' command when searching", async () => {
    const { getByPlaceholderText } = render(SearchPalette);
    await openPalette();
    await fireEvent.input(getByPlaceholderText("Type a command or search..."), {
      target: { value: "explore" },
    });
    await flush();
    expect(
      document.body.querySelector('[data-testid="cmd-explore-sample"]'),
    ).toBeTruthy();
  });

  it("'Explore example world' command calls exploreSample", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "explore_sample_ledger") return "/app-data/sample-world";
      if (cmd === "open_ledger")
        return {
          path: "/app-data/sample-world",
          note_count: 3,
          scene_count: 0,
          map_count: 0,
          failed_imports: [],
        };
      if (cmd === "get_notes") return [];
      return null;
    });

    const { getByPlaceholderText } = render(SearchPalette);
    await openPalette();
    await fireEvent.input(getByPlaceholderText("Type a command or search..."), {
      target: { value: "explore" },
    });
    await flush();

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
