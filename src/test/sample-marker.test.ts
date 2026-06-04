import { render, cleanup, act, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import LedgerSelector from "../lib/components/sidebar/LedgerSelector.svelte";
import SampleBanner from "../lib/components/SampleBanner.svelte";
import SampleEffects from "../lib/components/SampleEffects.svelte";
import { ledger } from "../lib/stores/ledger.svelte";
import { appPrefs } from "../lib/stores/app-prefs.svelte";
import { tabs } from "../lib/stores/tabs.svelte";

const SAMPLE_PATH = "/app-data/sample-world";
const SAMPLE_TABS_KEY = `grimoire:tabs:${SAMPLE_PATH}`;

const START_HERE_NOTE = {
  id: 1,
  path: "Start Here.md",
  title: "Start Here",
  icon: null,
  cover_image: null,
  parent_path: null,
  archived: false,
  modified_at: "2026-01-01T00:00:00Z",
};

function mockSampleInvoke(noteList = [START_HERE_NOTE]) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "explore_sample_ledger") return SAMPLE_PATH;
    if (cmd === "open_ledger")
      return { path: SAMPLE_PATH, note_count: noteList.length, scene_count: 0, map_count: 0, failed_imports: [] };
    if (cmd === "get_notes") return noteList;
    if (cmd === "close_ledger") return null;
    return null;
  });
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

// ── LedgerSelector sample treatment ─────────────────────────────────────────

describe("sample marker — LedgerSelector", () => {
  beforeEach(async () => {
    await ledger.closeLedger();
    vi.mocked(invoke).mockReset();
    localStorage.removeItem(SAMPLE_TABS_KEY);
  });

  afterEach(async () => {
    cleanup();
    await ledger.closeLedger();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("shows example world treatment when isSample", async () => {
    mockSampleInvoke();
    await ledger.exploreSample();
    await flush();

    const { getByTestId } = render(LedgerSelector);
    await flush();

    expect(getByTestId("sample-world-marker")).toBeTruthy();
  });

  it("shows 'Make this world mine' button when isSample", async () => {
    mockSampleInvoke();
    await ledger.exploreSample();
    await flush();

    const { getByTestId } = render(LedgerSelector);
    await flush();

    expect(getByTestId("make-mine-btn")).toBeTruthy();
  });

  it("does not show sample treatment when !isSample", async () => {
    // ledger is closed — not a sample
    const { queryByTestId } = render(LedgerSelector);
    await flush();

    expect(queryByTestId("sample-world-marker")).toBeNull();
    expect(queryByTestId("make-mine-btn")).toBeNull();
  });
});

// ── SampleBanner show/dismiss ────────────────────────────────────────────────

describe("sample banner", () => {
  beforeEach(async () => {
    await ledger.closeLedger();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(null);
    appPrefs.setSampleBannerDismissed(false);
    localStorage.removeItem(SAMPLE_TABS_KEY);
  });

  afterEach(async () => {
    cleanup();
    await ledger.closeLedger();
    appPrefs.setSampleBannerDismissed(false);
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("shows banner on first sample open", async () => {
    mockSampleInvoke();
    await ledger.exploreSample();
    await flush();

    const { getByTestId } = render(SampleBanner);
    await flush();

    expect(getByTestId("sample-banner")).toBeTruthy();
  });

  it("does not show banner after dismissal", async () => {
    appPrefs.setSampleBannerDismissed(true);
    mockSampleInvoke();
    await ledger.exploreSample();
    await flush();

    const { queryByTestId } = render(SampleBanner);
    await flush();

    expect(queryByTestId("sample-banner")).toBeNull();
  });

  it("dismissing the banner persists the dismissal", async () => {
    mockSampleInvoke();
    await ledger.exploreSample();
    await flush();

    const { getByLabelText } = render(SampleBanner);
    await flush();

    fireEvent.click(getByLabelText("Dismiss banner"));
    await flush();

    expect(appPrefs.sampleBannerDismissed).toBe(true);

    // Dismissal is persisted through the Rust-side app prefs, not webview storage
    const saveCall = vi
      .mocked(invoke)
      .mock.calls.findLast(([cmd]) => cmd === "save_app_prefs");
    expect(saveCall).toBeDefined();
    expect(
      (saveCall![1] as { prefs: { sampleBannerDismissed: boolean } }).prefs
        .sampleBannerDismissed,
    ).toBe(true);
  });

  it("does not show banner when ledger is not a sample", async () => {
    // ledger is closed — isSample is false
    const { queryByTestId } = render(SampleBanner);
    await flush();

    expect(queryByTestId("sample-banner")).toBeNull();
  });
});

// ── SampleEffects: auto-open Start Here ──────────────────────────────────────

describe("SampleEffects — auto-open Start Here", () => {
  beforeEach(async () => {
    await ledger.closeLedger();
    vi.mocked(invoke).mockReset();
    localStorage.removeItem(SAMPLE_TABS_KEY);
  });

  afterEach(async () => {
    cleanup();
    await ledger.closeLedger();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("opens the Start Here tab after exploreSample and notes load", async () => {
    mockSampleInvoke([START_HERE_NOTE]);

    render(SampleEffects);
    await ledger.exploreSample();
    await flush();
    await flush();

    expect(tabs.left.tabs.some((t) => t.title === "Start Here" && t.type === "note")).toBe(true);
  });

  it("clears pendingStartHere after opening the tab", async () => {
    mockSampleInvoke([START_HERE_NOTE]);

    render(SampleEffects);
    await ledger.exploreSample();
    await flush();
    await flush();

    expect(ledger.pendingStartHere).toBe(false);
  });
});
