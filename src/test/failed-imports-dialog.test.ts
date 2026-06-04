import { render, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { flushSync } from "svelte";

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

import { toast as sonner } from "svelte-sonner";
import FailedImportsDialog from "../lib/components/FailedImportsDialog.svelte";
import { ledger, failedImportsModal } from "../lib/stores/ledger.svelte";

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockResolvedValue(null);
  vi.mocked(sonner).mockClear();
  (sonner.error as ReturnType<typeof vi.fn>).mockClear();
  failedImportsModal.open = false;
  failedImportsModal.failures = [];
});

const sampleFailures = [
  { path: "notes/foo.md", reason: "Permission denied" },
  { path: "data/bar.md", reason: "Broken symlink" },
];

// ── Dialog rendering ──────────────────────────────────────────────

describe("FailedImportsDialog — content", () => {
  it("renders each failure path and reason when open", async () => {
    const { findByText } = render(FailedImportsDialog, {
      open: true,
      failures: sampleFailures,
    });

    expect(await findByText("notes/foo.md")).toBeTruthy();
    expect(await findByText("Permission denied")).toBeTruthy();
    expect(await findByText("data/bar.md")).toBeTruthy();
    expect(await findByText("Broken symlink")).toBeTruthy();
  });

  it("shows the correct count in the description", async () => {
    const { findByText } = render(FailedImportsDialog, {
      open: true,
      failures: sampleFailures,
    });

    expect(await findByText(/2 files could not be imported/i)).toBeTruthy();
  });

  it("singular 'file' for one failure", async () => {
    const { findByText } = render(FailedImportsDialog, {
      open: true,
      failures: [sampleFailures[0]],
    });

    expect(await findByText(/1 file could not be imported/i)).toBeTruthy();
  });
});

// ── Toast integration ─────────────────────────────────────────────

describe("failed imports — toast triggered by open_ledger", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("shows no toast when open_ledger returns zero failures", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "open_ledger") {
        return {
          path: "/vault",
          note_count: 1,
          scene_count: 0,
          map_count: 0,
          failed_imports: [],
        };
      }
      return null;
    });

    await ledger.openLedger("/vault");
    expect(vi.mocked(sonner)).not.toHaveBeenCalled();
  });

  it("shows toast with correct count when open_ledger returns failures", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "open_ledger") {
        return {
          path: "/vault",
          note_count: 3,
          scene_count: 0,
          map_count: 0,
          failed_imports: sampleFailures,
        };
      }
      return null;
    });

    await ledger.openLedger("/vault");
    expect(vi.mocked(sonner)).toHaveBeenCalledWith(
      "Couldn't import 2 files",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Show details" }),
      }),
    );
  });

  it("toast onClick sets failedImportsModal.open to true", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "open_ledger") {
        return {
          path: "/vault",
          note_count: 1,
          scene_count: 0,
          map_count: 0,
          failed_imports: [sampleFailures[0]],
        };
      }
      return null;
    });

    await ledger.openLedger("/vault");
    expect(failedImportsModal.open).toBe(false);

    const opts = vi.mocked(sonner).mock.calls[0][1] as unknown as {
      action: { onClick: () => void };
    };
    flushSync(() => opts.action.onClick());
    expect(failedImportsModal.open).toBe(true);
  });

  it("sets failedImportsModal.failures to the returned failures", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "open_ledger") {
        return {
          path: "/vault",
          note_count: 1,
          scene_count: 0,
          map_count: 0,
          failed_imports: sampleFailures,
        };
      }
      return null;
    });

    await ledger.openLedger("/vault");
    expect(failedImportsModal.failures).toEqual(sampleFailures);
  });
});
