// Tests for the rename field's containment (#161).
//
// A rename field always lives inside a row that means something else: a
// file-tree folder that expands on Space, a scene card that opens on Space. The
// bug was that typing a space into the field expanded the row instead of adding
// a space to the name. These tests hold the field's claim that keys and clicks
// aimed at it stop at it — exercised through a fixture row rather than the real
// file tree, because the guarantee belongs to the primitive, not to one caller.
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach } from "vitest";
import RenameInRowFixture from "./fixtures/RenameInRowFixture.svelte";

afterEach(cleanup);

function renderRow(name = "Old Name") {
  const result = render(RenameInRowFixture, { props: { name } });
  const input = result.container.querySelector("input[data-mode='edit']") as HTMLInputElement;
  return { ...result, input };
}

describe("a rename field inside an activatable row", () => {
  it("keeps a typed space from activating the row", async () => {
    const { component, input } = renderRow();

    await fireEvent.keyDown(input, { key: " " });

    expect(component.activations()).toBe(0);
  });

  it("lets the space reach the input, so a two-word name can be typed", async () => {
    const { input } = renderRow("Old");

    const event = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    // The row's handler is what used to call preventDefault on the way past.
    expect(event.defaultPrevented).toBe(false);
  });

  it("saves on Enter without also activating the row", async () => {
    const { component, input } = renderRow();

    await fireEvent.input(input, { target: { value: "New Name" } });
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(component.saved()).toEqual(["New Name"]);
    expect(component.activations()).toBe(0);
  });

  it("cancels on Escape without also activating the row", async () => {
    const { component, input } = renderRow();

    await fireEvent.keyDown(input, { key: "Escape" });

    expect(component.mode()).toBe("view");
    expect(component.activations()).toBe(0);
  });

  it("keeps a caret-placing click from activating the row", async () => {
    const { component, input } = renderRow();

    await fireEvent.click(input);

    expect(component.activations()).toBe(0);
  });

  it("still activates the row for keys and clicks aimed at the row itself", async () => {
    const { component, getByTestId } = renderRow();
    const row = getByTestId("row");

    await fireEvent.keyDown(row, { key: " " });
    await fireEvent.click(row);

    expect(component.activations()).toBe(2);
  });
});
