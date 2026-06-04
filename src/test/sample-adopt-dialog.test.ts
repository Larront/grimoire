import { render, cleanup, act, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import LedgerSelector from "../lib/components/sidebar/LedgerSelector.svelte";
import { ledger } from "../lib/stores/ledger.svelte";

const SAMPLE_PATH = "/app-data/sample-world";
const ADOPT_PARENT = "/Users/gm/Worlds";
const ADOPT_NAME = "Ashfen Chronicles";
const ADOPT_PATH = `${ADOPT_PARENT}/${ADOPT_NAME}`;

function mockSampleInvoke() {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "explore_sample_ledger") return SAMPLE_PATH;
    if (cmd === "open_ledger")
      return { path: (args as { path?: string })?.path ?? SAMPLE_PATH, note_count: 10, scene_count: 0, map_count: 1, failed_imports: [] };
    if (cmd === "adopt_sample_ledger") return ADOPT_PATH;
    if (cmd === "add_recent_ledger") return null;
    if (cmd === "close_ledger") return null;
    return null;
  });
}

vi.mocked(dialogOpen).mockResolvedValue(ADOPT_PARENT);

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

describe("adopt dialog — LedgerSelector", () => {
  beforeEach(async () => {
    await ledger.closeLedger();
    vi.mocked(invoke).mockReset();
    mockSampleInvoke();
    await ledger.exploreSample();
    await flush();
  });

  afterEach(async () => {
    cleanup();
    await ledger.closeLedger();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("clicking 'Make this world mine' shows the adopt dialog", async () => {
    const { getByTestId } = render(LedgerSelector);
    await flush();

    fireEvent.click(getByTestId("make-mine-btn"));
    await flush();

    expect(getByTestId("adopt-dialog")).toBeTruthy();
  });

  it("adopt dialog name field starts empty", async () => {
    const { getByTestId, getByPlaceholderText } = render(LedgerSelector);
    await flush();

    fireEvent.click(getByTestId("make-mine-btn"));
    await flush();

    const input = getByPlaceholderText("My World");
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("adopt dialog shows error when name is empty on confirm", async () => {
    const { getByTestId, getByText } = render(LedgerSelector);
    await flush();

    fireEvent.click(getByTestId("make-mine-btn"));
    await flush();

    fireEvent.click(getByTestId("adopt-confirm-btn"));
    await flush();

    expect(getByText("Please enter a ledger name.")).toBeTruthy();
  });

  it("adopt dialog rejects invalid characters in name", async () => {
    const { getByTestId, getByPlaceholderText, getByText } = render(LedgerSelector);
    await flush();

    fireEvent.click(getByTestId("make-mine-btn"));
    await flush();

    fireEvent.input(getByPlaceholderText("My World"), { target: { value: "bad/name" } });
    fireEvent.click(getByTestId("adopt-confirm-btn"));
    await flush();

    expect(getByText(/invalid characters/)).toBeTruthy();
  });

  it("adopt dialog requires a location", async () => {
    const { getByTestId, getByPlaceholderText, getByText } = render(LedgerSelector);
    await flush();

    fireEvent.click(getByTestId("make-mine-btn"));
    await flush();

    fireEvent.input(getByPlaceholderText("My World"), { target: { value: ADOPT_NAME } });
    fireEvent.click(getByTestId("adopt-confirm-btn"));
    await flush();

    expect(getByText("Please choose a storage location.")).toBeTruthy();
  });

  it("confirming valid name + location calls adopt_sample_ledger", async () => {
    vi.mocked(dialogOpen).mockResolvedValueOnce(ADOPT_PARENT);
    const { getByTestId, getByPlaceholderText } = render(LedgerSelector);
    await flush();

    fireEvent.click(getByTestId("make-mine-btn"));
    await flush();

    fireEvent.input(getByPlaceholderText("My World"), { target: { value: ADOPT_NAME } });
    fireEvent.click(getByTestId("adopt-choose-location-btn"));
    await flush();

    fireEvent.click(getByTestId("adopt-confirm-btn"));
    await flush();
    await flush();

    const calls = vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);
    expect(calls).toContain("adopt_sample_ledger");
  });

  it("after adopting, isSample is false", async () => {
    vi.mocked(dialogOpen).mockResolvedValueOnce(ADOPT_PARENT);
    const { getByTestId, getByPlaceholderText } = render(LedgerSelector);
    await flush();

    fireEvent.click(getByTestId("make-mine-btn"));
    await flush();

    fireEvent.input(getByPlaceholderText("My World"), { target: { value: ADOPT_NAME } });
    fireEvent.click(getByTestId("adopt-choose-location-btn"));
    await flush();

    fireEvent.click(getByTestId("adopt-confirm-btn"));
    await flush();
    await flush();

    expect(ledger.isSample).toBe(false);
  });

  it("a failed adopt keeps the dialog open and shows the error", async () => {
    vi.mocked(dialogOpen).mockResolvedValueOnce(ADOPT_PARENT);
    const { getByTestId, getByPlaceholderText } = render(LedgerSelector);
    await flush();

    fireEvent.click(getByTestId("make-mine-btn"));
    await flush();

    fireEvent.input(getByPlaceholderText("My World"), { target: { value: ADOPT_NAME } });
    fireEvent.click(getByTestId("adopt-choose-location-btn"));
    await flush();

    // Make the backend adopt fail
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "adopt_sample_ledger") throw "No sample sandbox found to adopt";
      return null;
    });

    fireEvent.click(getByTestId("adopt-confirm-btn"));
    await flush();
    await flush();

    expect(getByTestId("adopt-dialog")).toBeTruthy();
    expect(getByTestId("adopt-error").textContent).toContain("No sample sandbox found");
    expect(ledger.isSample).toBe(true);
  });
});
