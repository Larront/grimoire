// The "Repair links" tool (2026-10 design review; ADR-0014's escape hatch for the
// bulk path). A reorganisation outside Grimoire leaves links written as paths pointing
// at where a note used to be; the backend finds the note by its name, and the GM
// chooses which links to point at it. Nothing is rewritten unasked.
import { render, cleanup, act, waitFor, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "../lib/components/AppShell.svelte";
import ChoiceGroup from "../lib/components/ui/choice-group/choice-group.svelte";
import { needsAttention } from "../lib/stores/needs-attention.svelte";
import { linkRepairs } from "../lib/stores/link-repairs.svelte";
import { tabs } from "../lib/stores/tabs.svelte";
import type { LinkRepair } from "../lib/bindings.gen";

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

const note = (id: number, path: string) => ({
  id,
  path,
  title: path.split("/").pop()!.replace(/\.md$/, ""),
});

/** Thornhaven moved to Locations; the Old Mill has two notes of its name now. */
const PLAN: LinkRepair[] = [
  {
    target: "Places/Old Mill",
    candidates: [note(5, "Locations/Old Mill.md"), note(6, "Archive/Old Mill.md")],
    sources: [note(3, "Harbor.md")],
  },
  {
    target: "Places/Thornhaven",
    candidates: [note(1, "Locations/Thornhaven.md")],
    sources: [note(2, "Mira.md"), note(3, "Harbor.md")],
  },
];

let plan: LinkRepair[] = PLAN;

beforeEach(() => {
  for (const k of Object.keys(listeners)) delete listeners[k];
  plan = PLAN;
  vi.mocked(invoke).mockClear();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "get_notes") return [];
    if (cmd === "list_all_tags") return [];
    if (cmd === "plan_link_repairs") return plan;
    if (cmd === "apply_link_repairs") return 2;
    return null;
  });
});

afterEach(() => {
  cleanup();
  linkRepairs.clear();
  tabs.closeAll("left");
  tabs.closeAll("right");
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.mocked(invoke).mockResolvedValue(null);
});

async function mount() {
  const utils = render(AppShell);
  await waitFor(() => expect(listeners["notes:arrived"]).toBeTruthy());
  return utils;
}

const dialog = () => document.querySelector<HTMLElement>('[data-testid="link-repair-dialog"]');
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-testid="link-repair-row"]')];
const updateButton = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="link-repair-update"]')!;

describe("after notes arrive at new places", () => {
  it("lists the links it can heal in the world's needs-attention place", async () => {
    await mount();
    await emit("notes:arrived", null);

    await waitFor(() => expect(needsAttention.items.map((i) => i.kind)).toContain("repairs"));
    const item = needsAttention.items.find((i) => i.kind === "repairs")!;
    expect(item.label).toBe("3 links point to where a note used to be");
    expect(item.action.label).toBe("Review links");
    expect(dialog(), "listed, not raised").toBeNull();
  });

  it("says nothing when no link can be healed", async () => {
    plan = [];
    await mount();
    await emit("notes:arrived", null);
    await waitFor(() =>
      expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "plan_link_repairs")).toBe(true),
    );
    expect(needsAttention.items.some((i) => i.kind === "repairs")).toBe(false);
  });

  it("rewrites nothing on its own", async () => {
    await mount();
    await emit("notes:arrived", null);
    await waitFor(() => expect(linkRepairs.noticed).toBe(true));
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "apply_link_repairs")).toBe(false);
  });

  it("goes when the GM leaves them", async () => {
    await mount();
    await emit("notes:arrived", null);
    await waitFor(() => expect(linkRepairs.noticed).toBe(true));
    needsAttention.items.find((i) => i.kind === "repairs")!.dismiss!.run();
    expect(needsAttention.items.some((i) => i.kind === "repairs")).toBe(false);
  });
});

describe("the repair list", () => {
  async function review() {
    await mount();
    await act(() => linkRepairs.review());
    await waitFor(() => expect(rows()).toHaveLength(2));
  }

  it("shows each broken link, the note it would point at, and where it is held", async () => {
    await review();
    const thornhaven = rows()[1];
    expect(thornhaven.textContent).toContain("Places/Thornhaven");
    expect(thornhaven.textContent).toContain("Locations/Thornhaven");
    expect(thornhaven.textContent).not.toContain(".md");
    expect(thornhaven.textContent).toContain("In Mira and Harbor");
  });

  it("ticks a link with one note of its name, and waits for a choice where there are two", async () => {
    await review();
    const [mill, thornhaven] = rows().map((r) => r.querySelector<HTMLInputElement>("input")!);
    expect(thornhaven.checked).toBe(true);
    expect(mill.checked).toBe(false);
    expect(mill.disabled, "nothing to tick until a note is chosen").toBe(true);
    expect(updateButton().textContent).toContain("Update 2 links");
  });

  it("updates only the ticked links, to the notes chosen", async () => {
    await review();
    const mill = rows()[0];
    await fireEvent.click(
      [...mill.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) =>
        r.textContent?.includes("Archive/Old Mill"),
      )!,
    );
    expect(updateButton().textContent).toContain("Update 3 links");

    await fireEvent.click(updateButton());

    const call = vi.mocked(invoke).mock.calls.find(([c]) => c === "apply_link_repairs");
    expect(call?.[1]).toEqual({
      choices: [
        { target: "Places/Old Mill", note_id: 6 },
        { target: "Places/Thornhaven", note_id: 1 },
      ],
    });
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it("leaves a link the GM unticks", async () => {
    await review();
    await fireEvent.click(rows()[1].querySelector("input")!);
    expect(updateButton().disabled, "nothing left to update").toBe(true);
  });

  it("says so when there is nothing to repair", async () => {
    plan = [];
    await mount();
    await act(() => linkRepairs.review());
    await waitFor(() => expect(dialog()?.textContent).toContain("No links need repairing"));
    expect(updateButton()).toBeNull();
  });
});

describe("a choice group with nothing chosen", () => {
  it("can still be reached by Tab", () => {
    const { getAllByRole } = render(ChoiceGroup, {
      props: {
        label: "Which note",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
        value: "",
        onChange: () => {},
      },
    });
    expect(getAllByRole("radio").map((r) => r.tabIndex)).toEqual([0, -1]);
  });
});
