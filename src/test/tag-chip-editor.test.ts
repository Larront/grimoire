import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import TagChipEditor from "$lib/components/TagChipEditor.svelte";

afterEach(() => cleanup());

function typeInto(input: HTMLInputElement, value: string) {
  input.value = value;
  return fireEvent.input(input);
}

describe("TagChipEditor", () => {
  it("renders existing tags as chips in insertion order", () => {
    const { container } = render(TagChipEditor, {
      props: { tags: ["npc", "allied"] },
    });
    const chips = container.querySelectorAll('[data-slot="tag-chip"]');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain("npc");
    expect(chips[1].textContent).toContain("allied");
  });

  it("adds a tag on Enter when input passes the allowlist", async () => {
    const onchange = vi.fn();
    const { container } = render(TagChipEditor, {
      props: { tags: [], onchange },
    });
    const input = container.querySelector(
      '[data-slot="tag-chip-input"]',
    ) as HTMLInputElement;
    await typeInto(input, "npc");
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(onchange).toHaveBeenCalledWith(["npc"]);
    const chips = container.querySelectorAll('[data-slot="tag-chip"]');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain("npc");
  });

  it("rejects whitespace and disallowed characters at the input boundary", async () => {
    const onchange = vi.fn();
    const { container } = render(TagChipEditor, {
      props: { tags: [], onchange },
    });
    const input = container.querySelector(
      '[data-slot="tag-chip-input"]',
    ) as HTMLInputElement;
    const evt = await fireEvent.keyDown(input, { key: " " });
    expect(evt).toBe(false); // preventDefault returned false-y
    const evt2 = await fireEvent.keyDown(input, { key: "!" });
    expect(evt2).toBe(false);
    // Enter on a draft containing spaces (set programmatically) is silently dropped
    await typeInto(input, "bad tag");
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onchange).not.toHaveBeenCalled();
    expect(
      container.querySelectorAll('[data-slot="tag-chip"]').length,
    ).toBe(0);
  });

  it("preserves original case for display but treats duplicates case-insensitively", async () => {
    const onchange = vi.fn();
    const { container } = render(TagChipEditor, {
      props: { tags: ["NPC"], onchange },
    });
    const input = container.querySelector(
      '[data-slot="tag-chip-input"]',
    ) as HTMLInputElement;
    await typeInto(input, "npc");
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onchange).not.toHaveBeenCalled();
    const chips = container.querySelectorAll('[data-slot="tag-chip"]');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain("NPC");
  });

  it("removes the last chip on Backspace in empty input", async () => {
    const onchange = vi.fn();
    const { container } = render(TagChipEditor, {
      props: { tags: ["npc", "allied"], onchange },
    });
    const input = container.querySelector(
      '[data-slot="tag-chip-input"]',
    ) as HTMLInputElement;
    await fireEvent.keyDown(input, { key: "Backspace" });
    expect(onchange).toHaveBeenCalledWith(["npc"]);
    const chips = container.querySelectorAll('[data-slot="tag-chip"]');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain("npc");
  });

  it("removes a chip when its X button is clicked", async () => {
    const onchange = vi.fn();
    const { container } = render(TagChipEditor, {
      props: { tags: ["npc", "allied"], onchange },
    });
    const removes = container.querySelectorAll(
      '[data-slot="tag-chip-remove"]',
    );
    expect(removes.length).toBe(2);
    await fireEvent.click(removes[0]);
    expect(onchange).toHaveBeenCalledWith(["allied"]);
    const chips = container.querySelectorAll('[data-slot="tag-chip"]');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain("allied");
  });

  it("Backspace does nothing when input has content", async () => {
    const onchange = vi.fn();
    const { container } = render(TagChipEditor, {
      props: { tags: ["npc"], onchange },
    });
    const input = container.querySelector(
      '[data-slot="tag-chip-input"]',
    ) as HTMLInputElement;
    await typeInto(input, "ally");
    await fireEvent.keyDown(input, { key: "Backspace" });
    expect(onchange).not.toHaveBeenCalled();
    expect(
      container.querySelectorAll('[data-slot="tag-chip"]').length,
    ).toBe(1);
  });

  it("accepts hyphen, underscore, slash, and digits in tag values", async () => {
    const onchange = vi.fn();
    const { container } = render(TagChipEditor, {
      props: { tags: [], onchange },
    });
    const input = container.querySelector(
      '[data-slot="tag-chip-input"]',
    ) as HTMLInputElement;
    await typeInto(input, "loc/town-01_inn");
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onchange).toHaveBeenCalledWith(["loc/town-01_inn"]);
  });
});
