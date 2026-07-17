import { render, cleanup, act, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "svelte-sonner";
import AppShell from "../lib/components/AppShell.svelte";
import { tabs } from "../lib/stores/tabs.svelte";

// Same style as the Conflict-Banner suite: mock svelte-sonner so we can inspect
// the toast the listener raises, and capture the frontend event listeners so the
// test can emit note:external-move-links-stale the way the backend watcher would.
vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
  Toaster: vi.fn(),
}));

vi.mock("$lib/components/editor/Editor.svelte", async () => ({
  default: (await import("./mocks/MockEditor.svelte")).default,
}));

const { listeners } = vi.hoisted(() => ({
  listeners: {} as Record<string, ((e: { payload: unknown }) => void)[]>,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    (listeners[name] ??= []).push(cb);
    return () => {
      listeners[name] = (listeners[name] ?? []).filter((f) => f !== cb);
    };
  }),
}));

async function emit(name: string, payload: unknown) {
  await act(async () => {
    (listeners[name] ?? []).forEach((cb) => cb({ payload }));
  });
}

/** The last two-button toast raised (action + cancel), as the listener built it. */
function lastActionToast() {
  const calls = vi.mocked(toast).mock.calls;
  const last = calls[calls.length - 1];
  return {
    message: last?.[0] as string,
    opts: last?.[1] as {
      duration?: number;
      action?: { label: string; onClick: () => void };
      cancel?: { label: string; onClick: () => void };
    },
  };
}

beforeEach(() => {
  for (const k of Object.keys(listeners)) delete listeners[k];
  vi.mocked(toast).mockClear();
  vi.mocked(invoke).mockClear();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "get_notes") return [];
    if (cmd === "apply_backlink_rewrite") return 2;
    if (cmd === "list_all_tags") return [];
    return null;
  });
});

afterEach(() => {
  cleanup();
  tabs.closeAll("left");
  tabs.closeAll("right");
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.mocked(invoke).mockResolvedValue(null);
});

async function mount() {
  const utils = render(AppShell);
  // Let AppSidebar's onMount register its watcher listeners.
  await waitFor(() => expect(listeners["note:external-move-links-stale"]).toBeTruthy());
  return utils;
}

describe("External-move backlink prompt (issue #135)", () => {
  it("shows a persistent Update / Leave as-is toast when an external move leaves backlinks stale", async () => {
    await mount();

    await emit("note:external-move-links-stale", {
      from: "People/Aldric.md",
      to: "People/Aldric the Bold.md",
      count: 2,
    });

    const { message, opts } = lastActionToast();
    // Copy names the note (its stem) and the count, not the raw path.
    expect(message).toBe("'Aldric' moved externally. Update 2 backlinks?");
    // Persistent: it must not auto-dismiss.
    expect(opts.duration).toBe(Infinity);
    expect(opts.action?.label).toBe("Update");
    expect(opts.cancel?.label).toBe("Leave as-is");
  });

  it("singularises the copy for a single backlink", async () => {
    await mount();
    await emit("note:external-move-links-stale", {
      from: "Aldric.md",
      to: "Renamed.md",
      count: 1,
    });
    expect(lastActionToast().message).toBe("'Aldric' moved externally. Update 1 backlink?");
  });

  it("'Update' invokes apply_backlink_rewrite with the from/to paths", async () => {
    await mount();
    await emit("note:external-move-links-stale", {
      from: "People/Aldric.md",
      to: "People/Aldric the Bold.md",
      count: 2,
    });

    await act(async () => lastActionToast().opts.action?.onClick());

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("apply_backlink_rewrite", {
        fromPath: "People/Aldric.md",
        toPath: "People/Aldric the Bold.md",
      }),
    );
  });

  it("'Leave as-is' makes no backend call", async () => {
    await mount();
    await emit("note:external-move-links-stale", {
      from: "People/Aldric.md",
      to: "People/Aldric the Bold.md",
      count: 2,
    });

    await act(async () => lastActionToast().opts.cancel?.onClick());

    expect(invoke).not.toHaveBeenCalledWith(
      "apply_backlink_rewrite",
      expect.anything(),
    );
  });
});
