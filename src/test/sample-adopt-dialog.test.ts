import { render, cleanup, act, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import LedgerSelector from "../lib/components/sidebar/LedgerSelector.svelte";
import AdoptDialog from "../lib/components/AdoptDialog.svelte";
import { dialogs } from "../lib/stores/overlay.svelte";
import * as toasts from "../lib/toast";
import { ledger } from "../lib/stores/ledger.svelte";

const SAMPLE_PATH = "/app-data/sample-world";
const ADOPT_PARENT = "/Users/gm/Worlds";
const ADOPT_NAME = "Ashfen Chronicles";
const ADOPT_PATH = `${ADOPT_PARENT}/${ADOPT_NAME}`;

function mockSampleInvoke() {
  vi.mocked(invoke).mockImplementation(async (cmd: string, rawArgs?: unknown) => {
    const args = rawArgs as Record<string, unknown> | undefined;
    if (cmd === "explore_sample_ledger") return SAMPLE_PATH;
    if (cmd === "open_ledger")
      return {
        path: (args as { path?: string })?.path ?? SAMPLE_PATH,
        note_count: 10,
        scene_count: 0,
        map_count: 1,
        failed_imports: [],
        unlinked_pins: [],
      };
    if (cmd === "adopt_sample_ledger") return ADOPT_PATH;
    if (cmd === "add_recent_ledger") return null;
    if (cmd === "close_ledger") return null;
    return null;
  });
}

vi.mocked(dialogOpen).mockResolvedValue(ADOPT_PARENT);

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("adopt dialog", () => {
  beforeEach(async () => {
    await ledger.closeLedger();
    vi.mocked(invoke).mockReset();
    mockSampleInvoke();
    await ledger.exploreSample();
    await flush();
  });

  afterEach(async () => {
    cleanup();
    dialogs.adoptOpen = false;
    await ledger.closeLedger();
    vi.mocked(invoke).mockResolvedValue(null);
  });

  /** The dialog open, as the shell mounts it. */
  async function openDialog() {
    const view = render(AdoptDialog, { props: { open: true } });
    await flush();
    return view;
  }

  async function fill(view: Awaited<ReturnType<typeof openDialog>>, name = ADOPT_NAME) {
    await fireEvent.input(view.getByPlaceholderText("Name your world"), { target: { value: name } });
    vi.mocked(dialogOpen).mockResolvedValueOnce(ADOPT_PARENT);
    await fireEvent.click(view.getByTestId("new-ledger-location"));
    await flush();
  }

  it("'Make this world mine' in the sidebar opens the shell's dialog", async () => {
    const { getByTestId } = render(LedgerSelector);
    await flush();
    // It sits in the world menu, with the GM's recent worlds (2026-10 design review).
    await fireEvent.click(getByTestId("sample-world-marker"));
    await flush();
    await fireEvent.click(getByTestId("make-mine-btn"));
    expect(dialogs.adoptOpen).toBe(true);
  });

  it("starts with an empty name", async () => {
    const view = await openDialog();
    expect((view.getByPlaceholderText("Name your world") as HTMLInputElement).value).toBe("");
  });

  it("keeps Make it mine pressable, and says what is missing beside each field", async () => {
    const view = await openDialog();
    const confirm = view.getByTestId("adopt-confirm-btn");
    expect(confirm).not.toBeDisabled();

    await fireEvent.click(confirm);
    expect(view.getByText("Give it a name.")).toBeTruthy();
    expect(view.getByText("Choose where to save it.")).toBeTruthy();
    expect(view.getByPlaceholderText("Name your world")).toHaveAttribute("aria-invalid", "true");
    expect(vi.mocked(invoke).mock.calls.map(([c]) => c)).not.toContain("adopt_sample_ledger");
  });

  it("follows the typing once shown — a fixed name loses its message", async () => {
    const view = await openDialog();
    await fireEvent.click(view.getByTestId("adopt-confirm-btn"));
    const input = view.getByPlaceholderText("Name your world");

    await fireEvent.input(input, { target: { value: "Ash/fen" } });
    expect(view.getByText(/can't contain/)).toBeTruthy();
    await fireEvent.input(input, { target: { value: "Ashfen Vale" } });
    expect(view.queryByText(/can't contain/)).toBeNull();
    expect(view.queryByText("Give it a name.")).toBeNull();
  });

  it("says where the world will live once there is a name and a folder", async () => {
    const view = await openDialog();
    await fill(view);
    expect(view.getByTestId("new-ledger-destination").textContent).toContain(
      "Saved as …/Worlds/Ashfen Chronicles",
    );
  });

  it("adopts into the chosen folder and names the world in a toast", async () => {
    const success = vi.spyOn(toasts, "toastSuccess");
    const view = await openDialog();
    await fill(view);
    await fireEvent.click(view.getByTestId("adopt-confirm-btn"));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("adopt_sample_ledger", {
        parent: ADOPT_PARENT,
        name: ADOPT_NAME,
      }),
    );
    await waitFor(() => expect(ledger.isSample).toBe(false));
    expect(success.mock.calls[0][0]).toBe("“Ashfen Chronicles” is yours. It's saved in …/gm/Worlds.");
    success.mockRestore();
  });

  it("refuses a folder that already exists, under the name, and leaves the dialog open", async () => {
    const view = await openDialog();
    await fill(view);
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "adopt_sample_ledger") throw "LEDGER_EXISTS: '/Users/gm/Worlds/Ashfen Chronicles' already exists";
      return null;
    });

    await fireEvent.click(view.getByTestId("adopt-confirm-btn"));
    await waitFor(() =>
      expect(view.getByText(/already a folder called “Ashfen Chronicles” there/)).toBeTruthy(),
    );
    expect(view.getByTestId("adopt-dialog")).toBeTruthy();
    expect(ledger.isSample).toBe(true);

    // A different name is a different question.
    await fireEvent.input(view.getByPlaceholderText("Name your world"), {
      target: { value: "Ashfen Chronicles 2" },
    });
    expect(view.queryByText(/already a folder/)).toBeNull();
  });

  it("puts any other failure in words, not the raw error", async () => {
    const view = await openDialog();
    await fill(view);
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "adopt_sample_ledger") throw "Failed to copy \"grimoire.db\": (os error 32)";
      return null;
    });

    await fireEvent.click(view.getByTestId("adopt-confirm-btn"));
    await waitFor(() =>
      expect(view.getByTestId("adopt-error").textContent).toContain(
        "Couldn't copy the world there. Try another folder.",
      ),
    );
    expect(view.getByTestId("adopt-error").textContent).not.toContain("os error");
    expect(ledger.isSample).toBe(true);
  });
});
