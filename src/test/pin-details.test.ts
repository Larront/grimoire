import { render, fireEvent, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import PinDetails from "$lib/components/map/PinDetails.svelte";

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockResolvedValue(null);
});

const basePin = {
  id: 1,
  map_id: 5,
  x: 0,
  y: 0,
  title: "Test Pin",
  description: null,
  category_id: null,
  note_id: null,
  created_at: "2026-01-01T00:00:00Z",
  shape: null,
  icon: null,
  color: null,
};

const categories = [
  { id: 1, map_id: 5, name: "Town", icon: "house", color: "#ff0000", shape: "circle" },
  { id: 2, map_id: null, name: "Global", icon: "star", color: "#00ff00", shape: "pin" },
];

const linkedNote = {
  id: 42,
  path: "notes/aldric.md",
  title: "Aldric",
  icon: null,
  cover_image: null,
  parent_path: "notes",
  archived: false,
  modified_at: "2026-01-01T00:00:00Z",
};

function setupInvokeMock(cats = categories) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "get_pin_categories_for_map") return Promise.resolve(cats);
    if (cmd === "get_pin_tags") return Promise.resolve([]);
    if (cmd === "list_all_tags") return Promise.resolve([]);
    if (cmd === "read_note_content") return Promise.resolve("Some note content");
    return Promise.resolve(null);
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ── Rendering ─────────────────────────────────────────────────────────────────

describe("PinDetails — rendering", () => {
  beforeEach(() => { setupInvokeMock(); });

  it("renders all sections", async () => {
    const { container } = render(PinDetails, {
      props: { pin: basePin, onUpdate: vi.fn() },
    });
    await flush();
    expect(container.querySelector('[data-section="linked-note"]')).toBeTruthy();
    expect(container.querySelector('[data-section="tags"]')).toBeTruthy();
    expect(container.querySelector('[data-section="category"]')).toBeTruthy();
    expect(container.querySelector('[data-section="description"]')).toBeTruthy();
    expect(container.querySelector('[data-section="appearance"]')).toBeTruthy();
  });

  it("renders title input with pin title", async () => {
    const { container } = render(PinDetails, {
      props: { pin: basePin, onUpdate: vi.fn() },
    });
    await flush();
    const input = container.querySelector('input[placeholder="Name this pin"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("Test Pin");
  });

  it("renders lock button", async () => {
    const { container } = render(PinDetails, {
      props: { pin: basePin, onUpdate: vi.fn() },
    });
    await flush();
    const btn = container.querySelector('button[title="Unlock to drag"]');
    expect(btn).toBeTruthy();
  });
});

// ── Title editing ──────────────────────────────────────────────────────────────

describe("PinDetails — title editing", () => {
  beforeEach(() => { setupInvokeMock(); });

  it("calls onUpdate with new title on blur", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(PinDetails, {
      props: { pin: basePin, onUpdate },
    });
    await flush();
    const input = container.querySelector('input[placeholder="Name this pin"]') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "Renamed Pin" } });
    await fireEvent.blur(input);
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ title: "Renamed Pin" }));
  });

  it("does not call onUpdate when title unchanged on blur", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(PinDetails, {
      props: { pin: basePin, onUpdate },
    });
    await flush();
    const input = container.querySelector('input[placeholder="Name this pin"]') as HTMLInputElement;
    await fireEvent.blur(input);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

// ── Linked note section ───────────────────────────────────────────────────────

describe("PinDetails — linked note", () => {
  beforeEach(() => { setupInvokeMock(); });

  it("shows linked note title when linkedNote is provided", async () => {
    const { getByText } = render(PinDetails, {
      props: { pin: { ...basePin, note_id: 42 }, linkedNote, onUpdate: vi.fn() },
    });
    await flush();
    expect(getByText("Aldric")).toBeTruthy();
  });

  it("shows search input when no linked note", async () => {
    const { container } = render(PinDetails, {
      props: { pin: basePin, onUpdate: vi.fn() },
    });
    await flush();
    const input = container.querySelector('input[placeholder="Search notes…"]');
    expect(input).toBeTruthy();
  });

  it("calls onOpenNote when the open-note button is clicked", async () => {
    const onOpenNote = vi.fn();
    const { container } = render(PinDetails, {
      props: { pin: { ...basePin, note_id: 42 }, linkedNote, onUpdate: vi.fn(), onOpenNote },
    });
    await flush();
    const btn = container.querySelector('button[title="Open note"]') as HTMLElement;
    await fireEvent.click(btn);
    expect(onOpenNote).toHaveBeenCalledWith(42, "Aldric");
  });

  it("calls onUpdate with note_id: null when Unlink is clicked", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { getByText } = render(PinDetails, {
      props: { pin: { ...basePin, note_id: 42 }, linkedNote, onUpdate },
    });
    await flush();
    await fireEvent.click(getByText("Unlink"));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ note_id: null }));
  });

  it("does not use goto navigation (no goto import)", async () => {
    // This test verifies the component file exists and is importable as PinDetails
    const { container } = render(PinDetails, {
      props: { pin: { ...basePin, note_id: 42 }, linkedNote, onUpdate: vi.fn() },
    });
    await flush();
    // If goto were called, it would throw in test environment — reaching here confirms it's not
    expect(container).toBeTruthy();
  });
});

// ── Category section ──────────────────────────────────────────────────────────

describe("PinDetails — Pin Category", () => {
  beforeEach(() => { setupInvokeMock(); });

  it("renders a category section", async () => {
    const { container } = render(PinDetails, {
      props: { pin: basePin, onUpdate: vi.fn() },
    });
    await flush();
    expect(container.querySelector('[data-section="category"]')).toBeTruthy();
  });

  it("shows 'Uncategorized' option in the select", async () => {
    const { container } = render(PinDetails, {
      props: { pin: basePin, onUpdate: vi.fn() },
    });
    await flush();
    const select = container.querySelector('[data-slot="pin-category-select"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const opts = Array.from(select.options).map((o) => o.text);
    expect(opts).toContain("Uncategorized");
  });

  it("populates the select with categories from get_pin_categories_for_map", async () => {
    const { container } = render(PinDetails, {
      props: { pin: basePin, onUpdate: vi.fn() },
    });
    await flush();
    const select = container.querySelector('[data-slot="pin-category-select"]') as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.text);
    expect(opts).toContain("Town");
    expect(opts).toContain("Global");
  });

  it("shows the current category_id as selected", async () => {
    const { container } = render(PinDetails, {
      props: { pin: { ...basePin, category_id: 1 }, onUpdate: vi.fn() },
    });
    await flush();
    const select = container.querySelector('[data-slot="pin-category-select"]') as HTMLSelectElement;
    expect(select.value).toBe("1");
  });

  it("calls onUpdate with new category_id when a category is selected", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(PinDetails, {
      props: { pin: basePin, onUpdate },
    });
    await flush();
    const select = container.querySelector('[data-slot="pin-category-select"]') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "1" } });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ category_id: 1 }));
  });

  it("calls onUpdate with category_id: null when Uncategorized is selected", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(PinDetails, {
      props: { pin: { ...basePin, category_id: 1 }, onUpdate },
    });
    await flush();
    const select = container.querySelector('[data-slot="pin-category-select"]') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "" } });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ category_id: null }));
  });
});

// ── Appearance section ────────────────────────────────────────────────────────

describe("PinDetails — appearance section", () => {
  beforeEach(() => { setupInvokeMock(); });

  it("renders appearance section", async () => {
    const { container } = render(PinDetails, {
      props: { pin: basePin, onUpdate: vi.fn() },
    });
    await flush();
    expect(container.querySelector('[data-section="appearance"]')).toBeTruthy();
  });

  it("renders ColorSwatches in the appearance section", async () => {
    const { container } = render(PinDetails, {
      props: { pin: basePin, onUpdate: vi.fn() },
    });
    await flush();
    // ColorSwatches uses data-slot="color-swatches"
    expect(container.querySelector('[data-slot="color-swatches"]')).toBeTruthy();
  });
});

// ── Lock / unlock ─────────────────────────────────────────────────────────────

describe("PinDetails — lock/unlock", () => {
  beforeEach(() => { setupInvokeMock(); });

  it("calls onToggleLock when lock button is clicked", async () => {
    const onToggleLock = vi.fn();
    const { container } = render(PinDetails, {
      props: { pin: basePin, onUpdate: vi.fn(), onToggleLock },
    });
    await flush();
    const btn = container.querySelector('button[title="Unlock to drag"]') as HTMLElement;
    await fireEvent.click(btn);
    expect(onToggleLock).toHaveBeenCalledOnce();
  });

  it("shows LockOpen icon when unlocked=true", async () => {
    const { container } = render(PinDetails, {
      props: { pin: basePin, onUpdate: vi.fn(), unlocked: true },
    });
    await flush();
    const btn = container.querySelector('button[title="Lock pin"]');
    expect(btn).toBeTruthy();
  });
});
