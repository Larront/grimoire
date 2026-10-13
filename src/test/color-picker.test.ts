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

  it("Default chooses nothing, and is marked when nothing is chosen", async () => {
    const onchange = vi.fn();
    const { container } = render(ColorPicker, { props: { value: null, onchange } });
    const btn = container.querySelector("[data-color-default]") as HTMLElement;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    await fireEvent.click(btn);
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
