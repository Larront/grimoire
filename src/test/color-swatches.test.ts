import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import ColorSwatches from "$lib/components/ColorSwatches.svelte";

afterEach(() => { cleanup(); });

const PRESETS = ["#ff0000", "#00ff00", "#0000ff"];

describe("ColorSwatches", () => {
  it("renders data-slot='color-swatches'", () => {
    const { container } = render(ColorSwatches, {
      props: { presets: PRESETS, onchange: vi.fn() },
    });
    expect(container.querySelector('[data-slot="color-swatches"]')).toBeTruthy();
  });

  it("renders one button per preset color", () => {
    const { container } = render(ColorSwatches, {
      props: { presets: PRESETS, onchange: vi.fn() },
    });
    const buttons = container.querySelectorAll('button[type="button"]');
    expect(buttons.length).toBe(PRESETS.length);
  });

  it("calls onchange with the color when a preset swatch is clicked", async () => {
    const onchange = vi.fn();
    const { container } = render(ColorSwatches, {
      props: { presets: PRESETS, onchange },
    });
    const firstBtn = container.querySelector('button[type="button"]') as HTMLElement;
    await fireEvent.click(firstBtn);
    expect(onchange).toHaveBeenCalledWith("#ff0000");
  });

  it("highlights the currently selected preset", () => {
    const { container } = render(ColorSwatches, {
      props: { value: "#00ff00", presets: PRESETS, onchange: vi.fn() },
    });
    const buttons = Array.from(container.querySelectorAll('button[type="button"]'));
    const selected = buttons[1]; // "#00ff00" is index 1
    expect(selected.className).toContain("border-accent");
  });

  it("renders a custom color input (type=color inside label)", () => {
    const { container } = render(ColorSwatches, {
      props: { presets: PRESETS, onchange: vi.fn() },
    });
    const colorInput = container.querySelector('input[type="color"]');
    expect(colorInput).toBeTruthy();
  });

  it("calls onchange with custom color when color input changes", async () => {
    const onchange = vi.fn();
    const { container } = render(ColorSwatches, {
      props: { presets: PRESETS, onchange },
    });
    const colorInput = container.querySelector('input[type="color"]') as HTMLInputElement;
    await fireEvent.change(colorInput, { target: { value: "#abcdef" } });
    expect(onchange).toHaveBeenCalledWith("#abcdef");
  });

  it("marks custom color label as selected when value is not in presets", () => {
    const { container } = render(ColorSwatches, {
      props: { value: "#abcdef", presets: PRESETS, onchange: vi.fn() },
    });
    const label = container.querySelector("label") as HTMLElement;
    expect(label.className).toContain("border-accent");
  });
});
