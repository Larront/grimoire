import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import AliasChipEditor from "$lib/components/AliasChipEditor.svelte";

afterEach(() => cleanup());

function typeInto(input: HTMLInputElement, value: string) {
  input.value = value;
  return fireEvent.input(input);
}

describe("AliasChipEditor", () => {
  it("renders existing aliases as chips in insertion order", () => {
    const { container } = render(AliasChipEditor, {
      props: { aliases: ["Captain Ash", "The Dragon Slayer"] },
    });
    const chips = container.querySelectorAll('[data-slot="alias-chip"]');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain("Captain Ash");
    expect(chips[1].textContent).toContain("The Dragon Slayer");
  });

  it("adds an alias on Enter", async () => {
    const onchange = vi.fn();
    const { container } = render(AliasChipEditor, {
      props: { aliases: [], onchange },
    });
    const input = container.querySelector(
      '[data-slot="alias-chip-input"]',
    ) as HTMLInputElement;
    await typeInto(input, "Captain Ash");
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(onchange).toHaveBeenCalledWith(["Captain Ash"]);
    const chips = container.querySelectorAll('[data-slot="alias-chip"]');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain("Captain Ash");
  });

  it("adds an alias on comma key", async () => {
    const onchange = vi.fn();
    const { container } = render(AliasChipEditor, {
      props: { aliases: [], onchange },
    });
    const input = container.querySelector(
      '[data-slot="alias-chip-input"]',
    ) as HTMLInputElement;
    await typeInto(input, "Captain Ash");
    await fireEvent.keyDown(input, { key: "," });

    expect(onchange).toHaveBeenCalledWith(["Captain Ash"]);
    const chips = container.querySelectorAll('[data-slot="alias-chip"]');
    expect(chips.length).toBe(1);
  });

  it("does not add an empty alias on Enter", async () => {
    const onchange = vi.fn();
    const { container } = render(AliasChipEditor, {
      props: { aliases: [], onchange },
    });
    const input = container.querySelector(
      '[data-slot="alias-chip-input"]',
    ) as HTMLInputElement;
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onchange).not.toHaveBeenCalled();
    expect(
      container.querySelectorAll('[data-slot="alias-chip"]').length,
    ).toBe(0);
  });

  it("does not add a whitespace-only alias", async () => {
    const onchange = vi.fn();
    const { container } = render(AliasChipEditor, {
      props: { aliases: [], onchange },
    });
    const input = container.querySelector(
      '[data-slot="alias-chip-input"]',
    ) as HTMLInputElement;
    await typeInto(input, "   ");
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onchange).not.toHaveBeenCalled();
  });

  it("trims leading and trailing whitespace before adding", async () => {
    const onchange = vi.fn();
    const { container } = render(AliasChipEditor, {
      props: { aliases: [], onchange },
    });
    const input = container.querySelector(
      '[data-slot="alias-chip-input"]',
    ) as HTMLInputElement;
    await typeInto(input, "  Captain Ash  ");
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onchange).toHaveBeenCalledWith(["Captain Ash"]);
  });

  it("deduplicates case-insensitively (does not add if already present)", async () => {
    const onchange = vi.fn();
    const { container } = render(AliasChipEditor, {
      props: { aliases: ["Captain Ash"], onchange },
    });
    const input = container.querySelector(
      '[data-slot="alias-chip-input"]',
    ) as HTMLInputElement;
    await typeInto(input, "captain ash");
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onchange).not.toHaveBeenCalled();
    expect(
      container.querySelectorAll('[data-slot="alias-chip"]').length,
    ).toBe(1);
  });

  it("removes the last chip on Backspace in empty input", async () => {
    const onchange = vi.fn();
    const { container } = render(AliasChipEditor, {
      props: { aliases: ["Captain Ash", "The Hero"], onchange },
    });
    const input = container.querySelector(
      '[data-slot="alias-chip-input"]',
    ) as HTMLInputElement;
    await fireEvent.keyDown(input, { key: "Backspace" });
    expect(onchange).toHaveBeenCalledWith(["Captain Ash"]);
    expect(
      container.querySelectorAll('[data-slot="alias-chip"]').length,
    ).toBe(1);
    expect(
      container.querySelector('[data-slot="alias-chip"]')!.textContent,
    ).toContain("Captain Ash");
  });

  it("Backspace does nothing when input has content", async () => {
    const onchange = vi.fn();
    const { container } = render(AliasChipEditor, {
      props: { aliases: ["Captain Ash"], onchange },
    });
    const input = container.querySelector(
      '[data-slot="alias-chip-input"]',
    ) as HTMLInputElement;
    await typeInto(input, "something");
    await fireEvent.keyDown(input, { key: "Backspace" });
    expect(onchange).not.toHaveBeenCalled();
    expect(
      container.querySelectorAll('[data-slot="alias-chip"]').length,
    ).toBe(1);
  });

  it("removes a chip when its X button is clicked", async () => {
    const onchange = vi.fn();
    const { container } = render(AliasChipEditor, {
      props: { aliases: ["Captain Ash", "The Hero"], onchange },
    });
    const removes = container.querySelectorAll('[data-slot="alias-chip-remove"]');
    expect(removes.length).toBe(2);
    await fireEvent.click(removes[0]);
    expect(onchange).toHaveBeenCalledWith(["The Hero"]);
    expect(
      container.querySelectorAll('[data-slot="alias-chip"]').length,
    ).toBe(1);
    expect(
      container.querySelector('[data-slot="alias-chip"]')!.textContent,
    ).toContain("The Hero");
  });

  it("allows spaces and special characters in aliases", async () => {
    const onchange = vi.fn();
    const { container } = render(AliasChipEditor, {
      props: { aliases: [], onchange },
    });
    const input = container.querySelector(
      '[data-slot="alias-chip-input"]',
    ) as HTMLInputElement;
    await typeInto(input, "The Dark Lord (Vol. III)");
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onchange).toHaveBeenCalledWith(["The Dark Lord (Vol. III)"]);
  });

  it("clears input after committing an alias", async () => {
    const { container } = render(AliasChipEditor, {
      props: { aliases: [] },
    });
    const input = container.querySelector(
      '[data-slot="alias-chip-input"]',
    ) as HTMLInputElement;
    await typeInto(input, "Captain Ash");
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("");
  });
});
