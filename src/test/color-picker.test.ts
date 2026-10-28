// The colour picker reports twice: `oninput` as the GM moves, `onchange` once when a
// colour settles. Callers save on `onchange`, so these pin down when it fires.
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import ColorPicker from "../lib/components/ColorPicker.svelte";

afterEach(() => vi.useRealTimers());

describe("ColorPicker", () => {
  it("saves a typed hex once, normalised, on Enter", async () => {
    const onchange = vi.fn();
    const { getByLabelText } = render(ColorPicker, { props: { value: null, onchange } });
    const field = getByLabelText("Hex colour");
    await fireEvent.input(field, { target: { value: "ABC" } });
    expect(onchange).not.toHaveBeenCalled();
    await fireEvent.keyDown(field, { key: "Enter" });
    expect(onchange).toHaveBeenCalledExactlyOnceWith("#aabbcc");
  });

  it("ignores a hex that isn't one, and says so", async () => {
    const onchange = vi.fn();
    const { getByLabelText } = render(ColorPicker, { props: { value: "#c2483d", onchange } });
    const field = getByLabelText("Hex colour");
    await fireEvent.input(field, { target: { value: "#zz" } });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    await fireEvent.keyDown(field, { key: "Enter" });
    expect(onchange).not.toHaveBeenCalled();
  });

  it("Default is marked when nothing is chosen, and pressing it again writes nothing", async () => {
    const onchange = vi.fn();
    const { container } = render(ColorPicker, { props: { value: null, onchange } });
    const btn = container.querySelector("[data-color-default]") as HTMLElement;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    await fireEvent.click(btn);
    expect(onchange).not.toHaveBeenCalled();
  });

  it("Default clears a chosen colour", async () => {
    const onchange = vi.fn();
    const { container } = render(ColorPicker, { props: { value: "#3a7fa8", onchange } });
    await fireEvent.click(container.querySelector("[data-color-default]") as HTMLElement);
    expect(onchange).toHaveBeenCalledWith(null);
  });

  it("arrow keys move live and save once they settle", async () => {
    vi.useFakeTimers();
    const oninput = vi.fn();
    const onchange = vi.fn();
    const { getByLabelText } = render(ColorPicker, {
      props: { value: "#808080", oninput, onchange },
    });
    const area = getByLabelText("Saturation and brightness");
    await fireEvent.keyDown(area, { key: "ArrowUp" });
    await fireEvent.keyDown(area, { key: "ArrowUp" });
    expect(oninput).toHaveBeenCalledTimes(2);
    expect(onchange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onchange).toHaveBeenCalledTimes(1);
  });
});

describe("ColorPicker — a default that is a colour", () => {
  // An annotation always has a colour; Default puts back the one it was born with.
  it("Default chooses the default colour, and is marked when it is the value", async () => {
    const onchange = vi.fn();
    const { container, rerender } = render(ColorPicker, {
      props: { value: "#3a7fa8", defaultValue: "#f0ece8", onchange },
    });
    const btn = () => container.querySelector("[data-color-default]") as HTMLElement;
    expect(btn().getAttribute("aria-pressed")).toBe("false");
    await fireEvent.click(btn());
    expect(onchange).toHaveBeenCalledWith("#f0ece8");

    await rerender({ value: "#F0ECE8", defaultValue: "#f0ece8", onchange });
    expect(btn().getAttribute("aria-pressed")).toBe("true");
  });

  it("reads an older rgb() value", () => {
    const { getByLabelText } = render(ColorPicker, {
      props: { value: "rgb(184, 154, 94)", onchange: vi.fn() },
    });
    expect((getByLabelText("Hex colour") as HTMLInputElement).value).toBe("#b89a5e");
  });
});

// With nothing chosen, the hex field shows what the swatch shows (2026-10 design review).
describe("ColorPicker with nothing chosen", () => {
  it("names what it follows where the swatch is empty, rather than a hex it isn't wearing", () => {
    const { getByLabelText } = render(ColorPicker, { props: { value: null, onchange: vi.fn() } });
    expect((getByLabelText("Hex colour") as HTMLInputElement).placeholder).toBe("Default");
  });

  it("shows the colour it wears instead where there is one", () => {
    const { getByLabelText } = render(ColorPicker, {
      props: { value: null, noneSwatch: "#5b9ec9", defaultLabel: "Automatic", onchange: vi.fn() },
    });
    expect((getByLabelText("Hex colour") as HTMLInputElement).placeholder).toBe("#5b9ec9");
  });
});
