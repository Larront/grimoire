import { render, fireEvent, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import PinDetailPanel from "$lib/components/map/PinDetailPanel.svelte";

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

function setupInvokeMock(cats = categories) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "get_pin_categories_for_map") return Promise.resolve(cats);
    if (cmd === "get_pin_tags") return Promise.resolve([]);
    if (cmd === "list_all_tags") return Promise.resolve([]);
    return Promise.resolve(null);
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("PinDetailPanel – Pin Category", () => {
  beforeEach(() => {
    setupInvokeMock();
  });

  it("renders a Pin Category section", async () => {
    const { container } = render(PinDetailPanel, {
      props: { pin: basePin, onUpdate: vi.fn() },
    });
    await flush();
    expect(container.querySelector('[data-slot="pin-category-section"]')).toBeTruthy();
  });

  it("shows an 'Uncategorized' option in the select", async () => {
    const { container } = render(PinDetailPanel, {
      props: { pin: basePin, onUpdate: vi.fn() },
    });
    await flush();
    const select = container.querySelector(
      '[data-slot="pin-category-select"]',
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    const opts = Array.from(select.options).map((o) => o.text);
    expect(opts).toContain("Uncategorized");
  });

  it("populates the select with categories from get_pin_categories_for_map", async () => {
    const { container } = render(PinDetailPanel, {
      props: { pin: basePin, onUpdate: vi.fn() },
    });
    await flush();
    const select = container.querySelector(
      '[data-slot="pin-category-select"]',
    ) as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.text);
    expect(opts).toContain("Town");
    expect(opts).toContain("Global");
  });

  it("shows the current category_id as selected", async () => {
    const { container } = render(PinDetailPanel, {
      props: { pin: { ...basePin, category_id: 1 }, onUpdate: vi.fn() },
    });
    await flush();
    const select = container.querySelector(
      '[data-slot="pin-category-select"]',
    ) as HTMLSelectElement;
    expect(select.value).toBe("1");
  });

  it("calls onUpdate with new category_id when a category is selected", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(PinDetailPanel, {
      props: { pin: basePin, onUpdate },
    });
    await flush();
    const select = container.querySelector(
      '[data-slot="pin-category-select"]',
    ) as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "1" } });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ category_id: 1 }),
    );
  });

  it("calls onUpdate with category_id: null when Uncategorized is selected", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(PinDetailPanel, {
      props: { pin: { ...basePin, category_id: 1 }, onUpdate },
    });
    await flush();
    const select = container.querySelector(
      '[data-slot="pin-category-select"]',
    ) as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "" } });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ category_id: null }),
    );
  });
});
